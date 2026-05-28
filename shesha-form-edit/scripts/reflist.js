#!/usr/bin/env node
/**
 * reflist.js — create / list Shesha reference lists.
 *
 * Two commands:
 *
 *   node reflist.js list --module=A.Test [--base-url=...] [--username=...] [--password=...]
 *     -> prints all reference lists in the module, each with item count.
 *
 *   node reflist.js create \
 *     --module=A.Test \
 *     --name=Priority \
 *     --items='Low:1,Medium:2,High:3,Critical:4' \
 *     [--label='Priority Level'] \
 *     [--description='...'] \
 *     [--folder=Lookups] \
 *     [--base-url=...] [--username=...] [--password=...]
 *     -> creates a reference list (or returns the existing one) and adds the items.
 *
 *   --items format: comma-separated `label:value` pairs. `value` is the numeric itemValue.
 *                   Use `'item with comma:1','other:2'` style? No — to keep parsing simple,
 *                   labels with commas are not supported; use --items-json='[{...}]' instead.
 *
 *   --items-json: alternative for complex cases. JSON array of
 *                 { item, itemValue, description?, orderIndex?, color?, icon?, shortAlias? }.
 *
 * Exit codes: 0 = ok, 1 = generic failure, 2 = bad invocation.
 *
 * Uses Shesha v0.45+ ConfigurationStudio API. Older builds: not supported.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------- CLI ----------------

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (args.help || args.h || !cmd) {
  printUsage();
  process.exit(cmd ? 0 : 2);
}

function printUsage() {
  console.error(`Usage:
  node reflist.js list --module=<Name> [auth flags]
  node reflist.js create --module=<Name> --name=<RefListName> --items=<Label:Value,Label:Value,...> [--label=<L>] [--description=<D>] [--folder=<Path>] [auth flags]

Auth flags (all optional, default in parens):
  --base-url=<url>        (http://localhost:21021)
  --username=<u>          (admin)
  --password=<p>          (123qwe)

--items format: comma-separated <label>:<numericValue> pairs.
  Example: --items='Low:1,Medium:2,High:3,Critical:4'

--items-json: alternative for items with commas or extra props (color, icon, etc).
  Example: --items-json='[{"item":"Low","itemValue":1,"color":"#16A34A"}]'
`);
}

const baseUrl = (args['base-url'] || 'http://localhost:21021').replace(/\/+$/, '');
const username = args.username || 'admin';
const password = args.password || '123qwe';

function die(m, code = 1) { console.error(`reflist: ${m}`); process.exit(code); }
function info(m) { console.error(`reflist: ${m}`); }

// ---------------- HTTP ----------------

function req(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { Accept: 'application/json', ...headers },
      rejectUnauthorized: false,
    };
    if (body) {
      if (typeof body === 'string') body = Buffer.from(body, 'utf8');
      opts.headers['Content-Length'] = body.length;
    }
    const r = lib.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, raw, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function abpErr(r) {
  if (r.body && r.body.success === false && r.body.error) {
    return `${r.body.error.message || ''}${r.body.error.details ? ' — ' + r.body.error.details : ''}`.trim() || 'ABP error';
  }
  if (r.status >= 400) return `HTTP ${r.status}: ${r.raw.slice(0, 200)}`;
  return null;
}

// ---------------- pipeline ----------------

async function auth() {
  const r = await req('POST', `${baseUrl}/api/TokenAuth/Authenticate`,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ userNameOrEmailAddress: username, password }));
  const e = abpErr(r); if (e) die(`auth: ${e}`);
  const tok = (r.body && r.body.result && r.body.result.accessToken) || (r.body && r.body.accessToken);
  if (!tok) die(`auth: no accessToken in response`);
  return tok;
}

async function resolveModule(token, name) {
  if (!name) die('--module is required', 2);
  // Try both namespaces
  for (const ns of ['Shesha', 'app']) {
    const r = await req('GET', `${baseUrl}/api/services/${ns}/Module/GetAll?MaxResultCount=500`,
      { Authorization: `Bearer ${token}` });
    if (r.status === 404) continue;
    const e = abpErr(r); if (e) die(`Module/GetAll: ${e}`);
    const items = (r.body && r.body.result && r.body.result.items) || [];
    const m = items.find(x => x.name === name);
    if (m) {
      if (!m.isEnabled || !m.isEditable) die(`module "${name}" is not enabled/editable`);
      return m;
    }
    return null;
  }
  die('Module/GetAll: 404 on both namespaces');
}

async function detectStudio(token) {
  const r = await req('GET', `${baseUrl}/api/services/app/ConfigurationStudio/GetModules`,
    { Authorization: `Bearer ${token}` });
  if (r.status !== 200) {
    die('ConfigurationStudio API not available — reflist.js requires Shesha v0.45+');
  }
}

async function listReflists(token, moduleName) {
  // Use the dynamic ReferenceList CRUD GetAll, filtered by module name
  const filter = JSON.stringify({ and: [{ '==': [{ var: 'module.name' }, moduleName] }] });
  const r = await req('GET', `${baseUrl}/api/dynamic/Shesha/ReferenceList/Crud/GetAll?MaxResultCount=500&Filter=${encodeURIComponent(filter)}`,
    { Authorization: `Bearer ${token}` });
  const e = abpErr(r); if (e) die(`ReferenceList GetAll: ${e}`);
  const items = (r.body && r.body.result && r.body.result.items) || [];
  return items;
}

async function getReflistFull(token, moduleName, fullName) {
  // ConfigurationStudio/GetItem returns the refList + its items array
  const url = `${baseUrl}/api/services/app/ConfigurationStudio/GetItem?module=${encodeURIComponent(moduleName)}&name=${encodeURIComponent(fullName)}&itemType=reference-list`;
  const r = await req('GET', url, { Authorization: `Bearer ${token}` });
  const e = abpErr(r); if (e) die(`GetItem (reference-list): ${e}`);
  return (r.body && r.body.result) || null;
}

async function findReflistByName(token, moduleName, refListName) {
  // ConfigurationStudio names refLists as `<Module>.<Name>`. Try both with and without prefix.
  const fullName = refListName.includes('.') ? refListName : `${moduleName}.${refListName}`;
  const filter = JSON.stringify({ and: [
    { '==': [{ var: 'module.name' }, moduleName] },
    { '==': [{ var: 'name' }, fullName] },
  ]});
  const r = await req('GET', `${baseUrl}/api/dynamic/Shesha/ReferenceList/Crud/GetAll?MaxResultCount=5&Filter=${encodeURIComponent(filter)}`,
    { Authorization: `Bearer ${token}` });
  const e = abpErr(r); if (e) die(`find ReferenceList: ${e}`);
  const items = (r.body && r.body.result && r.body.result.items) || [];
  return items[0] || null;
}

async function createReflist(token, mod, refListName, label, description) {
  const fullName = refListName.includes('.') ? refListName : `${mod.name}.${refListName}`;
  info(`creating reference list "${fullName}"`);
  const body = JSON.stringify({
    moduleId: mod.id,
    folderId: null,
    itemType: 'reference-list',
    discriminator: 'reference-list',
    name: fullName,
    prevItemId: null,
    label: label || null,
    description: description || null,
  });
  const r = await req('POST', `${baseUrl}/api/services/app/ConfigurationStudio/CreateItem`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
  const e = abpErr(r); if (e) die(`CreateItem (reference-list): ${e}`);
  const created = (r.body && r.body.result) || null;
  if (!created || !created.id) die(`CreateItem returned no id: ${r.raw.slice(0, 300)}`);
  return created.id;
}

async function addItems(token, refListId, items) {
  let added = 0;
  for (const it of items) {
    const body = JSON.stringify({
      item: it.item,
      itemValue: it.itemValue,
      description: it.description || '',
      orderIndex: it.orderIndex,
      color: it.color || '',
      icon: it.icon || '',
      shortAlias: it.shortAlias || '',
      referenceList: { id: refListId },
    });
    const r = await req('POST', `${baseUrl}/api/dynamic/Shesha/ReferenceListItem/Crud/Create`,
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
    const e = abpErr(r); if (e) die(`create item "${it.item}": ${e}`);
    added++;
  }
  return added;
}

function moveItemToFolder(token, refListId, folderId) {
  const body = JSON.stringify({ nodeType: 2, nodeId: refListId, folderId });
  return req('POST', `${baseUrl}/api/services/app/ConfigurationStudio/MoveNodeToFolder`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
}

async function ensureFolderPath(token, mod, folderPath) {
  const segments = folderPath.split('/').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const tree = await req('GET', `${baseUrl}/api/services/app/ConfigurationStudio/GetFlatTree`,
    { Authorization: `Bearer ${token}` });
  const items = (tree.body && tree.body.result) || [];
  const inModule = items.filter(n => n.moduleId === mod.id);
  const folderByKey = new Map();
  for (const n of inModule) if (n.nodeType === 3) folderByKey.set(`${n.parentId}|${n.name.toLowerCase()}`, n.id);

  let parentId = mod.id;
  for (const seg of segments) {
    const key = `${parentId}|${seg.toLowerCase()}`;
    let id = folderByKey.get(key);
    if (!id) {
      const body = JSON.stringify({ moduleId: mod.id, folderId: parentId === mod.id ? null : parentId, name: seg, prevItemId: null });
      const r = await req('POST', `${baseUrl}/api/services/app/ConfigurationStudio/CreateFolder`,
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
      const e = abpErr(r); if (e) die(`CreateFolder ("${seg}"): ${e}`);
      id = r.body.result.id;
      folderByKey.set(key, id);
    }
    parentId = id;
  }
  return parentId;
}

// ---------------- item parsing ----------------

function parseItems(itemsCsv, itemsJson) {
  if (itemsJson) {
    try {
      const arr = JSON.parse(itemsJson);
      if (!Array.isArray(arr)) throw new Error('not an array');
      return arr.map((it, i) => ({
        item: String(it.item || it.label || ''),
        itemValue: Number(it.itemValue !== undefined ? it.itemValue : it.value),
        description: it.description || '',
        orderIndex: it.orderIndex !== undefined ? it.orderIndex : i + 1,
        color: it.color || '',
        icon: it.icon || '',
        shortAlias: it.shortAlias || '',
      }));
    } catch (e) { die(`--items-json: invalid JSON (${e.message})`, 2); }
  }
  if (!itemsCsv) die('--items or --items-json is required for create', 2);
  return itemsCsv.split(',').map((pair, i) => {
    const [label, value] = pair.split(':').map(s => (s || '').trim());
    if (!label) die(`--items: empty label in pair "${pair}"`, 2);
    const v = value === undefined || value === '' ? i + 1 : Number(value);
    if (Number.isNaN(v)) die(`--items: non-numeric value in "${pair}"`, 2);
    return { item: label, itemValue: v, description: '', orderIndex: i + 1, color: '', icon: '', shortAlias: '' };
  });
}

// ---------------- main ----------------

(async () => {
  const token = await auth();
  await detectStudio(token);

  if (cmd === 'list') {
    const mod = await resolveModule(token, args.module);
    if (!mod) die(`module "${args.module}" not found`);
    const lists = await listReflists(token, mod.name);
    info(`${lists.length} reference list(s) in module "${mod.name}":`);
    for (const l of lists) {
      // We don't have item counts in this response — they require GetItem per refList.
      // Print id + name for the quick overview.
      console.log(`  ${l.name.padEnd(50)} ${l.id}`);
    }
    process.exit(0);
  }

  if (cmd === 'create') {
    const mod = await resolveModule(token, args.module);
    if (!mod) die(`module "${args.module}" not found`);
    if (!args.name) die('--name is required', 2);

    const items = parseItems(args.items, args['items-json']);
    info(`parsed ${items.length} item(s): ${items.map(i => i.item + '=' + i.itemValue).join(', ')}`);

    // Find-or-create
    let existing = await findReflistByName(token, mod.name, args.name);
    let refId;
    if (existing) {
      info(`reference list "${existing.name}" already exists (id=${existing.id}) — skipping create, items will be appended`);
      refId = existing.id;
    } else {
      refId = await createReflist(token, mod, args.name, args.label, args.description);
      info(`  created id=${refId}`);
    }

    if (items.length) {
      // Idempotent items: skip any whose `item` name matches an existing one (case-insensitive)
      const fullName = args.name.includes('.') ? args.name : `${mod.name}.${args.name}`;
      const full = await getReflistFull(token, mod.name, fullName);
      const existingNames = new Set((full && full.items || []).map(x => String(x.item || '').toLowerCase()));
      const toAdd = items.filter(it => !existingNames.has(it.item.toLowerCase()));
      const skipped = items.length - toAdd.length;
      if (skipped) info(`  ${skipped} item(s) already exist — skipping: ${items.filter(it => existingNames.has(it.item.toLowerCase())).map(i => i.item).join(', ')}`);
      if (toAdd.length) {
        const added = await addItems(token, refId, toAdd);
        info(`added ${added} new item(s)`);
      } else {
        info('no new items to add');
      }
    }

    if (args.folder) {
      info(`filing under module folder "${args.folder}"`);
      const folderId = await ensureFolderPath(token, mod, args.folder);
      await moveItemToFolder(token, refId, folderId);
      info(`  ✓ filed under ${mod.name}/${args.folder}`);
    }

    // Final summary — print the dropdown wiring snippet
    const fullName = args.name.includes('.') ? args.name : `${mod.name}.${args.name}`;
    console.log('');
    console.log('DONE. Bind a dropdown / radio / checkboxGroup to this reference list:');
    console.log(JSON.stringify({
      type: 'dropdown',
      dataSourceType: 'referenceList',
      referenceListId: { module: mod.name, name: args.name.replace(`${mod.name}.`, '') },
      mode: 'single',
      editMode: 'editable',
    }, null, 2));
    console.log('');
    console.log(`Or as a refListStatus (flat keys):`);
    console.log(JSON.stringify({
      type: 'refListStatus',
      module: mod.name,
      referenceListName: args.name.replace(`${mod.name}.`, ''),
      showIcon: true,
    }, null, 2));
    process.exit(0);
  }

  die(`unknown command "${cmd}". Try: list | create`, 2);
})().catch(err => { console.error('reflist: unexpected error:', err.stack || err.message); process.exit(1); });
