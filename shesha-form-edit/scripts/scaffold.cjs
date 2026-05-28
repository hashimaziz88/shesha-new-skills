#!/usr/bin/env node
/**
 * scaffold.js — one-shot Shesha form scaffolder.
 *
 * Pipeline: auth → resolve module → resolve entity → fetch metadata → render template
 *           → id-remap → splice fields → autofix → validate → push → verify.
 *
 * Usage:
 *   node scaffold.js \
 *     --template=details|table|create \
 *     --entity=<EntityClassName>           # short name, e.g. Person
 *     --module=<ModuleName>                # exact name, e.g. Shesha
 *     [--name=<form-name>]                 # default: <entity-kebab>-<template>
 *     [--label=<human label>]              # default: derived
 *     [--include=prop1,prop2,...]          # only emit these metadata properties
 *     [--exclude=prop1,prop2,...]          # skip these
 *     [--max-fields=N]                     # cap auto-picked fields (default 8 details/create, 6 table)
 *     [--base-url=http://localhost:21021]
 *     [--username=admin --password=123qwe]
 *     [--model-type=Fully.Qualified.Class] # skip EntityConfig lookup
 *     [--module-id=<guid>]                 # skip Module/GetAll lookup
 *     [--push]                             # default: dry-run, prints rendered markup to stdout
 *     [--out=<path>]                       # also write rendered markup to disk
 *     [--no-verify]                        # skip post-push re-fetch / diff
 *     [--strict]                           # treat validate.cjs warnings as errors
 *     [--debug]                            # verbose HTTP logging
 *
 * Exit codes:
 *   0 success (form scaffolded; pushed if --push)
 *   1 generic failure (bad input, auth fail, validation fail, push fail)
 *   2 bad invocation (missing required flags, unknown template)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const componentsIndex = require('./components-index.cjs');
const enrich = require('./enrich.cjs');
const layoutPolish = require('./layout-polish.cjs');
const styler = require('./styler.cjs');
const pluralize = require('./pluralize.cjs');

// ---------------- CLI parsing ----------------

function parseArgs(argv) {
  const out = { _: [], push: false, verify: true, strict: false, debug: false };
  for (const a of argv) {
    if (a === '--push') out.push = true;
    else if (a === '--no-verify') out.verify = false;
    else if (a === '--strict') out.strict = true;
    else if (a === '--debug') out.debug = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 36).join('\n').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

function die(msg, code = 1) { console.error(`scaffold: ${msg}`); process.exit(code); }
function info(msg) { console.error(`scaffold: ${msg}`); }
function dbg(msg) { if (args.debug) console.error(`scaffold[debug]: ${msg}`); }

// ---- template registry ----
// entityBound: requires Metadata fetch + field/column extraction.
// dataLoader: default formSettings.dataLoaderType (overridable per-seed).
const TEMPLATES = {
  details:              { entityBound: true,  fieldsSlot: '__SLOT_FIELDS__',         polish: true,  keyInfoBar: true  },
  table:                { entityBound: true,  fieldsSlot: null,                      polish: false, keyInfoBar: false },
  create:               { entityBound: true,  fieldsSlot: '__SLOT_FIELDS__',         polish: true,  keyInfoBar: false },
  wizard:               { entityBound: true,  fieldsSlot: '__SLOT_FIELDS__',         polish: true,  keyInfoBar: false, sectionsBecomeSteps: true },
  'approval-flow':      { entityBound: true,  fieldsSlot: '__SLOT_FIELDS__',         polish: true,  keyInfoBar: true  },
  'audit-trail':        { entityBound: true,  fieldsSlot: null,                      polish: false, keyInfoBar: false },
  'citizen-profile':    { entityBound: true,  fieldsSlot: '__SLOT_FIELDS__',         polish: true,  keyInfoBar: true  },
  'document-submission':{ entityBound: true,  fieldsSlot: null,                      polish: false, keyInfoBar: false },
  'dashboard-departmental': { entityBound: false, fieldsSlot: null, polish: false, keyInfoBar: false },
  'reports-printable':  { entityBound: false, fieldsSlot: null, polish: false, keyInfoBar: false },
};

// When --plan-file is provided, the plan owns template / entity / module choices.
// Skip the strict CLI-arg validation in that mode; loadPlan() runs its own checks.
const isPlanMode = !!args['plan-file'];

const template = args.template || (isPlanMode ? null : null);
if (!isPlanMode) {
  if (!template || !TEMPLATES[template]) {
    die(`--template is required and must be one of: ${Object.keys(TEMPLATES).join(', ')}`, 2);
  }
}
const TPL = template ? TEMPLATES[template] : null;

if (!isPlanMode) {
  if (TPL.entityBound) {
    if (!args.entity && !args['model-type']) die('--entity or --model-type is required for this template', 2);
  }
  if (!args.module && !args['module-id']) die('--module or --module-id is required', 2);
}

const baseUrl = (args['base-url'] || 'http://localhost:21021').replace(/\/+$/, '');
const username = args.username || 'admin';
const password = args.password || '123qwe';

const entityShort = args.entity || (args['model-type'] || '').split('.').pop() || 'Item';
const entityKebab = kebab(entityShort);
const entityPretty = pretty(entityShort);
const entityPrettyPlural = pluralize(entityPretty);
const FORM_NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Plan mode defers all of these to loadPlan(). In legacy mode they're computed from CLI args.
const formName = isPlanMode ? null : (args.name || (TPL.entityBound ? `${entityKebab}-${template}` : template));
const formLabel = isPlanMode ? null : (args.label || `${entityPretty} - ${cap(template)}`);
const maxFields = parseInt(args['max-fields'] || (template === 'table' ? '6' : '8'), 10);

if (formName && !FORM_NAME_REGEX.test(formName)) {
  die(`form name "${formName}" does not match ${FORM_NAME_REGEX}`, 2);
}

// ---------------- helpers ----------------

function kebab(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase();
}
function pretty(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function camel(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

// Resolve a template seed across the templates/{primary,examples} layout.
// Search order: primary/, examples/, then bare templates/ (legacy fallback).
function resolveSeedPath(name) {
  const base = path.join(__dirname, '..', 'assets', 'templates');
  for (const sub of ['primary', 'examples', '']) {
    const candidate = path.join(base, sub, `${name}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function newGuid() {
  // 22-char base62-ish, matches the IDs seen in real Shesha forms
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 22);
}

function req(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'Accept': 'application/json', ...headers },
      rejectUnauthorized: false,
    };
    if (body) {
      if (Buffer.isBuffer(body)) {
        opts.headers['Content-Length'] = body.length;
      } else if (typeof body === 'string') {
        body = Buffer.from(body, 'utf8');
        opts.headers['Content-Length'] = body.length;
      }
    }
    dbg(`${method} ${url}`);
    const r = lib.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        dbg(`-> ${res.statusCode} (${raw.length}b)`);
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { /* keep raw */ }
        resolve({ status: res.statusCode, raw, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function abpErr(resp) {
  if (resp.body && resp.body.success === false && resp.body.error) {
    return `${resp.body.error.message || ''}${resp.body.error.details ? ' — ' + resp.body.error.details : ''}`.trim() || 'ABP error';
  }
  if (resp.status >= 400) return `HTTP ${resp.status}: ${resp.raw.slice(0, 200)}`;
  return null;
}

// ---------------- pipeline ----------------

async function authenticate() {
  info(`authenticating ${username}@${baseUrl}`);
  const r = await req('POST', `${baseUrl}/api/TokenAuth/Authenticate`,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ userNameOrEmailAddress: username, password }));
  const e = abpErr(r);
  if (e) die(`auth failed: ${e}`);
  const tok = (r.body && r.body.result && r.body.result.accessToken) || (r.body && r.body.accessToken);
  if (!tok) die(`auth response had no accessToken: ${r.raw.slice(0, 300)}`);
  return tok;
}

async function resolveModule(token, name, providedId) {
  if (providedId) return { id: providedId, name: name || '?', isEnabled: true, isEditable: true };
  info(`resolving module "${name}"`);
  // Namespace varies by build — try Shesha first, fall back to app
  let r = await req('GET', `${baseUrl}/api/services/Shesha/Module/GetAll?MaxResultCount=500`,
    { Authorization: `Bearer ${token}` });
  if (r.status === 404) {
    r = await req('GET', `${baseUrl}/api/services/app/Module/GetAll?MaxResultCount=500`,
      { Authorization: `Bearer ${token}` });
  }
  const e = abpErr(r);
  if (e) die(`Module/GetAll failed: ${e}`);
  const items = (r.body && r.body.result && r.body.result.items) || [];
  const m = items.find(x => x.name === name);
  if (!m) die(`module "${name}" not found. Available: ${items.map(x => x.name).join(', ').slice(0, 400)}`);
  if (!m.isEnabled) die(`module "${name}" is disabled (isEnabled=false). Enable it before scaffolding.`);
  if (!m.isEditable) die(`module "${name}" is read-only (isEditable=false). Cannot create forms there.`);
  return m;
}

// Cached map of bare className (lowercased) -> fullClassName, populated after the first
// EntityConfig/GetAll call. Used by propToComponent to resolve entityPicker.entityType from
// the bare names that Metadata/GetProperties returns.
let _entityConfigCache = null;
function resolveEntityFullName(bareName) {
  if (!_entityConfigCache || !bareName) return null;
  return _entityConfigCache.get(String(bareName).toLowerCase()) || null;
}

async function loadEntityConfigCache(token) {
  if (_entityConfigCache) return _entityConfigCache;
  let r = await req('GET', `${baseUrl}/api/services/app/EntityConfig/GetAll?MaxResultCount=2000`,
    { Authorization: `Bearer ${token}` });
  if (r.status === 404) {
    r = await req('GET', `${baseUrl}/api/services/Shesha/EntityConfig/GetAll?MaxResultCount=2000`,
      { Authorization: `Bearer ${token}` });
  }
  const e = abpErr(r);
  if (e) { info(`(entityConfig cache: ${e} — entityPicker resolution will fall back to bare names)`); return new Map(); }
  const items = (r.body && r.body.result && r.body.result.items) || [];
  const map = new Map();
  for (const it of items) {
    if (it.className && it.fullClassName) {
      map.set(it.className.toLowerCase(), it.fullClassName);
    }
  }
  _entityConfigCache = map;
  info(`entityConfig cache: ${map.size} entities`);
  return map;
}

async function resolveEntity(token, shortName, providedFullName) {
  // Always populate the cache so propToComponent can resolve entityPicker.entityType for FK fields.
  await loadEntityConfigCache(token);
  if (providedFullName) return { className: providedFullName.split('.').pop(), fullClassName: providedFullName };
  info(`resolving entity "${shortName}"`);
  const target = shortName.toLowerCase();
  const full = _entityConfigCache.get(target);
  if (full) return { className: shortName, fullClassName: full };
  // Cache miss — fall back to a one-shot GetAll for backwards compat + the "closest match" hint
  let r = await req('GET', `${baseUrl}/api/services/app/EntityConfig/GetAll?MaxResultCount=2000`,
    { Authorization: `Bearer ${token}` });
  if (r.status === 404) {
    r = await req('GET', `${baseUrl}/api/services/Shesha/EntityConfig/GetAll?MaxResultCount=2000`,
      { Authorization: `Bearer ${token}` });
  }
  const e = abpErr(r);
  if (e) die(`EntityConfig/GetAll failed: ${e}`);
  const items = (r.body && r.body.result && r.body.result.items) || [];
  const match = items.find(x => (x.className || '').toLowerCase() === target);
  if (!match) {
    const close = items.filter(x => (x.className || '').toLowerCase().includes(target.slice(0, 4)))
      .slice(0, 8).map(x => x.fullClassName || x.className).join(', ');
    die(`entity "${shortName}" not found in EntityConfig. Closest: ${close || '(none)'} — pass --model-type=<Fully.Qualified.Name> to skip lookup.`);
  }
  return match;
}

async function fetchMetadata(token, fullClassName) {
  info(`fetching metadata for ${fullClassName}`);
  // Use GetProperties (returns flat array) — Metadata/Get on newer builds requires
  // {entityType, module, name} which we don't always have, and only returns container info.
  const tryPaths = [
    `/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(fullClassName)}`,
    `/api/services/Shesha/Metadata/GetProperties?container=${encodeURIComponent(fullClassName)}`,
  ];
  for (const p of tryPaths) {
    const r = await req('GET', baseUrl + p, { Authorization: `Bearer ${token}` });
    if (r.status === 404) continue;
    const e = abpErr(r);
    if (e) die(`Metadata/GetProperties failed: ${e}`);
    const result = (r.body && r.body.result) || [];
    // GetProperties returns a flat array of properties — normalize to the same shape as Metadata/Get.
    if (Array.isArray(result)) return { entityFullName: fullClassName, properties: result };
    return result;
  }
  die(`Metadata endpoint returned 404 on both namespaces for ${fullClassName}`);
}

// Map a metadata property -> a Shesha component fragment.
// Note: propToComponent emits the BASE shape; enrich.js adds polish heuristics
// (icons, placeholders, validation regex, autoSize, etc.) after.
function propToComponent(prop, parentId, moduleName) {
  const rawName = prop.path || prop.name;
  const name = camel(rawName);
  const base = {
    id: newGuid(),
    propertyName: name,
    componentName: name,
    label: prop.label || pretty(rawName),
    parentId,
    editMode: 'editable',
    validate: prop.required ? { required: true } : {},
  };
  const dt = String(prop.dataType || '').toLowerCase();
  // reference-list-typed property
  if (prop.referenceListName) {
    // Backend stores names as "<Module>.<RefListName>". The binding requires the
    // SHORT name (without the module prefix); runtime adds the prefix when resolving.
    // Stripping mirrors the convention reflist.cjs uses on its summary output.
    const refListModule = prop.referenceListModule || moduleName || 'Shesha';
    let refListName = prop.referenceListName;
    const prefix = refListModule + '.';
    if (refListName.startsWith(prefix)) refListName = refListName.slice(prefix.length);
    return {
      ...base,
      type: 'dropdown',
      dataSourceType: 'referenceList',
      referenceListId: { name: refListName, module: refListModule },
    };
  }
  // entity reference — entityType may come back as bare className; resolve to fully-qualified name if we can.
  if (prop.entityType) {
    return {
      ...base,
      type: 'entityPicker',
      entityType: resolveEntityFullName(prop.entityType) || prop.entityType,
      mode: 'single',
      displayProperty: '_displayName',
    };
  }
  if (dt === 'boolean' || dt === 'bool') {
    return { ...base, type: 'checkbox' };
  }
  if (dt === 'number' || dt === 'int' || dt === 'integer' || dt === 'decimal' || dt === 'float' || dt === 'double' || dt === 'long') {
    return { ...base, type: 'numberField' };
  }
  if (dt === 'date' || dt === 'datetime' || dt === 'date-time') {
    return { ...base, type: 'dateField', dateFormat: 'DD/MM/YYYY' };
  }
  if (dt === 'multiline-string' || dt === 'text') {
    return { ...base, type: 'textArea', rows: 3 };
  }
  // default: textField
  return { ...base, type: 'textField' };
}

function _normalizeNameSet(csv) {
  if (!csv) return null;
  return new Set(csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}
function _matchName(prop, set) {
  const name = (prop.path || prop.name || '').toLowerCase();
  return set.has(name);
}

function pickFields(metadata, include, exclude, max, parentId, moduleName) {
  if (!metadata || !Array.isArray(metadata.properties)) {
    info('  (no metadata properties; emitting empty field list)');
    return [];
  }
  const inc = _normalizeNameSet(include);
  const exc = _normalizeNameSet(exclude) || new Set();
  const candidates = metadata.properties.filter(p => {
    if (p.suppress === true || p.isFrameworkRelated === true) return false;
    if (inc && !_matchName(p, inc)) return false;
    if (_matchName(p, exc)) return false;
    return true;
  });
  // Preserve user's order when --include is given (matched case-insensitively)
  const ordered = inc
    ? [...inc].map(n => candidates.find(p => (p.path || p.name || '').toLowerCase() === n)).filter(Boolean)
    : candidates;
  const picked = ordered.slice(0, max);
  info(`  picked ${picked.length} field(s): ${picked.map(p => p.path || p.name).join(', ') || '(none)'}`);
  return picked.map(p => {
    const base = propToComponent(p, parentId, moduleName);
    // Apply UX heuristics (email icons, date formats, currency prefixes, textArea for long text...)
    // enrich expects propertyName-style keys, so feed it the camel form.
    const enriched = enrich({ ...p, name: camel(p.path || p.name) }, base);
    return enriched;
  });
}

function pickColumns(metadata, include, exclude, max) {
  if (!metadata || !Array.isArray(metadata.properties)) return [];
  const inc = _normalizeNameSet(include);
  const exc = _normalizeNameSet(exclude) || new Set();
  const candidates = metadata.properties.filter(p => {
    if (p.suppress === true || p.isFrameworkRelated === true) return false;
    if (inc && !_matchName(p, inc)) return false;
    if (_matchName(p, exc)) return false;
    return true;
  });
  const ordered = inc
    ? [...inc].map(n => candidates.find(p => (p.path || p.name || '').toLowerCase() === n)).filter(Boolean)
    : candidates;
  const picked = ordered.slice(0, max);
  info(`  picked ${picked.length} column(s): ${picked.map(p => p.path || p.name).join(', ') || '(none)'}`);
  return picked.map(p => ({
    id: newGuid(),
    columnType: 'data',
    propertyName: camel(p.path || p.name),
    caption: p.label || pretty(p.path || p.name),
    isVisible: true,
    sortable: true,
    minWidth: 120,
  }));
}

// ---------------- template rendering ----------------

function renderSubstitutions(seed, ctx) {
  const json = JSON.stringify(seed);
  const sub = json
    .replace(/__MODULE__/g, ctx.module)
    .replace(/__ENTITY_PRETTY_PLURAL__/g, ctx.entityPrettyPlural)
    .replace(/__ENTITY_PRETTY__/g, ctx.entityPretty)
    .replace(/__ENTITY_KEBAB__/g, ctx.entityKebab)
    .replace(/__ENTITY__/g, ctx.entity)
    .replace(/__MODEL_TYPE__/g, ctx.modelType);
  const parsed = JSON.parse(sub);
  delete parsed._template;
  return parsed;
}

function idRemap(form) {
  // Walk the tree, build old->new id map, then rewrite parentId references.
  const map = new Map();
  function collectIds(node, parentNewId) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => collectIds(n, parentNewId)); return; }
    if (typeof node.id === 'string' && !map.has(node.id)) {
      map.set(node.id, newGuid());
    }
    // Recurse into known child arrays
    for (const k of ['components', 'tabs', 'columns', 'items']) {
      if (Array.isArray(node[k])) collectIds(node[k]);
    }
    if (node.header && Array.isArray(node.header.components)) collectIds(node.header.components);
    if (node.content && Array.isArray(node.content.components)) collectIds(node.content.components);
  }
  collectIds(form.components);

  function rewrite(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(rewrite); return; }
    if (typeof node.id === 'string' && map.has(node.id)) node.id = map.get(node.id);
    if (typeof node.parentId === 'string' && map.has(node.parentId)) node.parentId = map.get(node.parentId);
    for (const k of ['components', 'tabs', 'columns', 'items']) {
      if (Array.isArray(node[k])) rewrite(node[k]);
    }
    if (node.header && Array.isArray(node.header.components)) rewrite(node.header.components);
    if (node.content && Array.isArray(node.content.components)) rewrite(node.content.components);
  }
  rewrite(form.components);
}

function findSlot(node, propName) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findSlot(n, propName); if (r) return r; }
    return null;
  }
  if (node.propertyName === propName) return node;
  for (const k of ['components', 'tabs', 'columns']) {
    if (Array.isArray(node[k])) { const r = findSlot(node[k], propName); if (r) return r; }
  }
  if (node.header) { const r = findSlot(node.header, propName); if (r) return r; }
  if (node.content) { const r = findSlot(node.content, propName); if (r) return r; }
  return null;
}

// Populate the KeyInformationBar component already present in the template (type=KeyInformationBar,
// componentName=keyInformationBar in the sha-page-heading title area) with up to 3 columns,
// each a 200px-wide column with an uppercase label text + read-only value field.
// Falls back to splicing a custom bar above validationErrors for older templates that lack the placeholder.
function injectKeyInfoBar(form, items) {
  if (!items || !items.length) return;

  // Build the columns array in the KeyInformationBar native format
  const columns = items.slice(0, 3).map(item => {
    const colId = newGuid();
    const labelId = newGuid();
    const valueId = newGuid();
    let valueComponent;
    if (/^status$/i.test(item.propertyName)) {
      valueComponent = {
        id: valueId,
        type: 'refListStatus',
        propertyName: item.propertyName,
        componentName: 'keyInfo_' + item.propertyName,
        label: item.label || item.propertyName,
        editMode: 'readOnly',
        hideLabel: true,
        showIcon: true
      };
    } else {
      valueComponent = {
        id: valueId,
        type: 'textField',
        propertyName: item.propertyName,
        componentName: 'keyInfo_' + item.propertyName,
        label: item.label || item.propertyName,
        editMode: 'readOnly',
        hideLabel: true,
        hideBorder: true
      };
    }
    return {
      id: colId,
      width: 200,
      flexDirection: 'column',
      textAlign: 'center',
      components: [
        {
          id: labelId,
          type: 'text',
          propertyName: 'keyInfoLabel_' + item.propertyName,
          componentName: 'keyInfoLabel_' + item.propertyName,
          label: (item.label || item.propertyName).toUpperCase(),
          hideLabel: true,
          contentDisplay: 'content',
          textType: 'span',
          content: (item.label || item.propertyName).toUpperCase()
        },
        valueComponent
      ]
    };
  });

  // Preferred: find the KeyInformationBar placeholder already in the template heading
  let bar = null;
  function findBar(node) {
    if (!node || typeof node !== 'object' || bar) return;
    if (Array.isArray(node)) { node.forEach(findBar); return; }
    if (node.type === 'KeyInformationBar' && node.componentName === 'keyInformationBar') { bar = node; return; }
    if (Array.isArray(node.components)) node.components.forEach(findBar);
    if (node.content && Array.isArray(node.content.components)) node.content.components.forEach(findBar);
    if (Array.isArray(node.tabs)) node.tabs.forEach(t => findBar(t.components));
  }
  findBar(form.components);

  if (bar) {
    bar.columns = columns;
    return;
  }

  // Fallback: splice a legacy bar above validationErrors (for templates without the placeholder)
  let target = null, targetIndex = -1;
  function walkForValidation(node) {
    if (!node || typeof node !== 'object' || target) return;
    if (Array.isArray(node)) { node.forEach(walkForValidation); return; }
    if (Array.isArray(node.components)) {
      const idx = node.components.findIndex(c => c && c.type === 'validationErrors');
      if (idx >= 0) { target = node; targetIndex = idx; return; }
      node.components.forEach(walkForValidation);
    }
    if (Array.isArray(node.tabs)) node.tabs.forEach(walkForValidation);
  }
  walkForValidation(form.components);
  if (!target) return;

  const barId = newGuid();
  const legacyCols = columns.map(col => ({
    id: col.id,
    type: 'container',
    propertyName: 'keyInfoCol_' + col.components[1].propertyName,
    componentName: 'keyInfoCol_' + col.components[1].propertyName,
    parentId: barId,
    label: ' ',
    hideLabel: true,
    direction: 'vertical',
    components: col.components
  }));
  target.components.splice(targetIndex, 0, {
    id: barId,
    type: 'keyInformationBar',
    propertyName: 'keyInfoBar',
    componentName: 'keyInfoBar',
    parentId: target.id || 'root',
    label: ' ',
    hideLabel: true,
    components: legacyCols
  });
}

// Build a child-table tab from a plan.childTables[] entry. Mirrors the framework's
// organisation-detail-view-example pattern: dataContext (Entity, paging, mustache filter
// scoping to {{data.id}} via the FK property) > container (quickSearch + pager) > datatable.
//
//   { title, entityType, fkProperty, columns[], inlineEdit?, defaultPageSize? }
//
// inlineEdit:true prepends a crud-operations column for per-row edit/delete.
function buildChildTableTab(childTable, parentTabsId) {
  const tabId = newGuid();
  const ctxId = newGuid();
  const innerId = newGuid();
  const tableId = newGuid();
  const quickSearchId = newGuid();
  const pagerId = newGuid();

  if (!childTable.entityType) throw new Error(`childTable "${childTable.title || '?'}" missing entityType`);
  if (!childTable.fkProperty) throw new Error(`childTable "${childTable.title || '?'}" missing fkProperty (the FK on the child entity that points at the parent)`);

  const permanentFilter = {
    and: [{
      '==': [
        { var: childTable.fkProperty },
        { evaluate: [{ expression: '{{data.id}}', required: true, type: 'mustache' }] },
      ],
    }],
  };

  const items = [];
  if (childTable.inlineEdit) {
    items.push({
      id: newGuid(),
      columnType: 'crud-operations',
      caption: '',
      isVisible: true,
      sortOrder: -1,
      itemType: 'item',
    });
  }
  for (let i = 0; i < (childTable.columns || []).length; i++) {
    const c = childTable.columns[i];
    items.push({
      id: newGuid(),
      columnType: 'data',
      itemType: 'item',
      isVisible: true,
      sortOrder: i,
      allowSorting: true,
      minWidth: 140,
      ...c,
    });
  }

  return {
    id: tabId,
    key: kebab(childTable.title || childTable.entityType.split('.').pop()),
    title: childTable.title || childTable.entityType.split('.').pop(),
    components: [
      {
        id: ctxId,
        type: 'dataContext',
        propertyName: 'childTableContext',
        componentName: 'childTableContext_' + (childTable.fkProperty || 'x'),
        parentId: tabId,
        label: ' ',
        hideLabel: true,
        editMode: 'inherited',
        sourceType: 'Entity',
        entityType: childTable.entityType,
        dataFetchingMode: 'paging',
        defaultPageSize: childTable.defaultPageSize || 5,
        sortMode: 'standard',
        permanentFilter,
        components: [
          {
            id: innerId,
            type: 'container',
            propertyName: 'childTableContainer',
            componentName: 'childTableContainer',
            parentId: ctxId,
            label: ' ',
            hideLabel: true,
            direction: 'horizontal',
            justifyContent: 'space-between',
            alignItems: 'center',
            components: [
              {
                id: quickSearchId,
                type: 'datatable.quickSearch',
                propertyName: 'childTableQuickSearch',
                componentName: 'childTableQuickSearch',
                parentId: innerId,
                label: ' ',
                hideLabel: true,
                actionOwner: 'childTableContext_' + (childTable.fkProperty || 'x'),
              },
              {
                id: pagerId,
                type: 'datatable.pager',
                propertyName: 'childTablePager',
                componentName: 'childTablePager',
                parentId: innerId,
                label: ' ',
                hideLabel: true,
                actionOwner: 'childTableContext_' + (childTable.fkProperty || 'x'),
              },
            ],
          },
          {
            id: tableId,
            type: 'datatable',
            propertyName: 'childTable',
            componentName: 'childTable_' + (childTable.fkProperty || 'x'),
            parentId: ctxId,
            label: ' ',
            hideLabel: true,
            rowDividers: true,
            hoverHighlight: true,
            freezeHeaders: false,
            canEditInline: childTable.inlineEdit ? 'yes' : 'no',
            canAddInline: childTable.inlineEdit ? 'yes' : 'no',
            canDeleteInline: childTable.inlineEdit ? 'yes' : 'no',
            noDataIcon: 'InboxOutlined',
            noDataText: `No ${(childTable.title || 'records').toLowerCase()} yet`,
            items,
          },
        ],
      },
    ],
  };
}

// Convert a flat list of [sectionSeparator, fields..., sectionSeparator, fields...]
// into a list of wizard step objects { id, key, title, components, subTitle? }.
function sectionsToWizardSteps(items, parentId) {
  const steps = [];
  let current = null;
  for (const node of items) {
    if (node.type === 'sectionSeparator') {
      if (current) steps.push(current);
      const id = newGuid();
      current = {
        id,
        key: 'step' + (steps.length + 1),
        title: node.label || `Step ${steps.length + 1}`,
        components: []
      };
    } else {
      if (!current) {
        // No section heading at the top — synthesize a single step
        current = {
          id: newGuid(),
          key: 'step1',
          title: 'Details',
          components: []
        };
      }
      node.parentId = current.id;
      current.components.push(node);
    }
  }
  if (current) steps.push(current);
  if (!steps.length) {
    // No fields at all — give the wizard a single empty step so it renders
    steps.push({ id: newGuid(), key: 'step1', title: 'Start', components: [] });
  }
  return steps;
}

// Remove a node (by id) from the tree, including its child slots.
function removeNode(root, id) {
  function rm(arr) {
    if (!Array.isArray(arr)) return false;
    const i = arr.findIndex(n => n && n.id === id);
    if (i >= 0) { arr.splice(i, 1); return true; }
    for (const n of arr) {
      if (n && typeof n === 'object') {
        for (const k of ['components','tabs','columns','items']) if (rm(n[k])) return true;
        if (n.header && rm(n.header.components)) return true;
        if (n.content && rm(n.content.components)) return true;
      }
    }
    return false;
  }
  rm(root);
}

// Find first node anywhere in the tree whose propertyName matches.
function findByPropertyName(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findByPropertyName(n, name); if (r) return r; }
    return null;
  }
  if (node.propertyName === name) return node;
  for (const k of ['components', 'tabs', 'columns', 'items', 'steps']) {
    if (Array.isArray(node[k])) { const r = findByPropertyName(node[k], name); if (r) return r; }
  }
  if (node.header) { const r = findByPropertyName(node.header, name); if (r) return r; }
  if (node.content) { const r = findByPropertyName(node.content, name); if (r) return r; }
  return null;
}

function findByType(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findByType(n, type); if (r) return r; }
    return null;
  }
  if (node.type === type) return node;
  for (const k of ['components', 'tabs', 'columns', 'items']) {
    if (Array.isArray(node[k])) { const r = findByType(node[k], type); if (r) return r; }
  }
  return null;
}

// ---------------- autofix + validate ----------------

function runScript(script, jsonPath, extra = []) {
  const r = spawnSync('node', [path.join(__dirname, script), jsonPath, ...extra], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---------------- ConfigurationStudio (v0.45+ folder API) ----------------
// TreeNodeType: 1 = module, 2 = item (form/etc), 3 = folder.

async function detectFolderSupport(token) {
  const r = await req('GET', `${baseUrl}/api/services/app/ConfigurationStudio/GetModules`,
    { Authorization: `Bearer ${token}` });
  if (r.status === 200) return true;
  if (r.status === 404) return false;
  // Other errors: don't crash the whole scaffold for a probe — just disable folders.
  dbg(`folder probe non-404/200: HTTP ${r.status}`);
  return false;
}

async function getFlatTree(token) {
  const r = await req('GET', `${baseUrl}/api/services/app/ConfigurationStudio/GetFlatTree`,
    { Authorization: `Bearer ${token}` });
  const e = abpErr(r);
  if (e) die(`ConfigurationStudio/GetFlatTree failed: ${e}`);
  return (r.body && r.body.result) || [];
}

async function createFolder(token, moduleId, parentFolderId, name) {
  info(`  creating folder "${name}"${parentFolderId ? ' under ' + parentFolderId : ' at module root'}`);
  const body = JSON.stringify({ moduleId, folderId: parentFolderId || null, name, prevItemId: null });
  const r = await req('POST', `${baseUrl}/api/services/app/ConfigurationStudio/CreateFolder`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
  const e = abpErr(r);
  if (e) die(`CreateFolder("${name}") failed: ${e}`);
  return (r.body && r.body.result && r.body.result.id) || null;
}

async function moveItemToFolder(token, formId, folderId) {
  info(`  moving form ${formId} -> folder ${folderId}`);
  const body = JSON.stringify({ nodeType: 2, nodeId: formId, folderId });
  const r = await req('POST', `${baseUrl}/api/services/app/ConfigurationStudio/MoveNodeToFolder`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
  const e = abpErr(r);
  if (e) die(`MoveNodeToFolder failed: ${e}`);
}

// Resolve a slash-separated folder path to a folder id, creating any missing
// segments. Path is relative to the module root.
//
//   ensureFolderPath(token, moduleId, "Forms/Person")
//     -> ensures Forms exists, ensures Person exists under Forms, returns Person's id.
async function ensureFolderPath(token, moduleId, folderPath) {
  const segments = String(folderPath).split('/').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return null;

  const tree = await getFlatTree(token);
  // Filter to nodes in this module
  const inModule = tree.filter(n => n.moduleId === moduleId);
  // Index folders by parentId+name for cheap lookups
  const folderByKey = new Map();
  for (const n of inModule) {
    if (n.nodeType === 3) folderByKey.set(`${n.parentId}|${n.name.toLowerCase()}`, n.id);
  }

  let parentId = moduleId; // root-level folders have parentId = moduleId
  for (const seg of segments) {
    const key = `${parentId}|${seg.toLowerCase()}`;
    let id = folderByKey.get(key);
    if (!id) {
      id = await createFolder(token, moduleId, parentId === moduleId ? null : parentId, seg);
      folderByKey.set(key, id);
    } else {
      dbg(`  folder "${seg}" already exists (id=${id})`);
    }
    parentId = id;
  }
  return parentId;
}

// Choose the default folder path when --folder is not given.
// Convention: <EntityPretty>  (e.g. "Person") — groups all forms for an entity
// together. For non-entity templates (dashboard / reports), use the template kind
// pretty-cased (e.g. "Dashboards", "Reports").
function defaultFolderPath(template, entityPretty) {
  if (!TEMPLATES[template].entityBound) {
    if (template === 'dashboard-departmental') return 'Dashboards';
    if (template === 'reports-printable') return 'Reports';
    return 'Forms';
  }
  return entityPretty || 'Forms';
}

// ---------------- push ----------------

async function pushCreate(token, moduleId, name, label, modelType) {
  info(`POST FormConfiguration/Create name=${name}`);
  const body = JSON.stringify({ moduleId, name, label, modelType: modelType || null });
  const r = await req('POST', `${baseUrl}/api/services/Shesha/FormConfiguration/Create`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
  const e = abpErr(r);
  if (e) die(`Create failed: ${e}`);
  const id = r.body && r.body.result && (r.body.result.id || r.body.result);
  if (!id) die(`Create returned no id: ${r.raw.slice(0, 300)}`);
  return id;
}

async function pushUpdateMarkup(token, formId, markupTree) {
  info(`PUT FormConfiguration/UpdateMarkup id=${formId}`);
  const body = JSON.stringify({ id: formId, markup: JSON.stringify(markupTree) });
  const r = await req('PUT', `${baseUrl}/api/services/Shesha/FormConfiguration/UpdateMarkup`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body);
  const e = abpErr(r);
  if (e) die(`UpdateMarkup failed: ${e}`);
}

async function verify(token, formId) {
  info(`verify GetJson id=${formId}`);
  const r = await req('GET', `${baseUrl}/api/services/Shesha/FormConfiguration/GetJson?id=${formId}`,
    { Authorization: `Bearer ${token}` });
  if (r.status !== 200) die(`verify GetJson failed: HTTP ${r.status}: ${r.raw.slice(0, 200)}`);
  // GetJson returns the raw markup
  try {
    const back = JSON.parse(r.raw);
    info(`  server returned ${Array.isArray(back.components) ? back.components.length : '?'} top-level component(s)`);
    return back;
  } catch (_) {
    info(`  server returned non-JSON markup (${r.raw.length}b) — likely the file-download wrapper`);
    return null;
  }
}

// ---------------- plan file (AI-authored field/column lists) ----------------

// When --plan-file=<path> is provided, the caller (the planning AI) supplies an
// explicit JSON spec for the form, and scaffold.js skips heuristic field generation.
// The plan owns all per-field decisions (textArea vs textField, refListId shape,
// entityType, validation, etc.). scaffold.js still runs id-remap + autofix +
// validate + style + push + fold + verify.
function loadPlan() {
  if (!args['plan-file']) return null;
  const p = args['plan-file'];
  if (!fs.existsSync(p)) die(`plan file not found: ${p}`, 2);
  let plan;
  try { plan = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch (e) { die(`plan file is not valid JSON: ${e.message}`, 2); }
  for (const k of ['template', 'name', 'moduleName']) {
    if (!plan[k]) die(`plan file missing required field: ${k}`, 2);
  }
  if (!TEMPLATES[plan.template]) die(`plan.template "${plan.template}" is not a known template`, 2);
  if (TEMPLATES[plan.template].entityBound && !plan.modelType) {
    die(`plan.template "${plan.template}" is entity-bound; plan.modelType is required`, 2);
  }
  info(`plan loaded: template=${plan.template} name=${plan.name} fields=${(plan.fields||[]).length} columns=${(plan.columns||[]).length}`);
  return plan;
}

// ---------------- main ----------------

(async () => {
  try {
    info(`components-index source: ${componentsIndex.sourceDir}`);
  } catch (e) {
    info(`components-index not available (${e.message}) — proceeding without index`);
  }

  const plan = loadPlan();

  // Plan, when present, owns the form's name/label/module/template — CLI args are ignored.
  const effFormName  = plan ? plan.name  : formName;
  const effFormLabel = plan ? (plan.label || plan.name) : formLabel;
  if (!FORM_NAME_REGEX.test(effFormName)) {
    die(`plan.name "${effFormName}" does not match ${FORM_NAME_REGEX}`, 2);
  }

  const token = await authenticate();
  const module = await resolveModule(token, plan ? plan.moduleName : args.module, args['module-id']);

  let modelType = (plan && plan.modelType) || args['model-type'] || '';
  let metadata = null;
  if (plan) {
    // Plan-driven: cache EntityConfig for autofix's resolution but skip metadata + entity resolve.
    await loadEntityConfigCache(token);
    info(`plan-driven mode — skipping metadata fetch + heuristic field generation`);
  } else if (TPL.entityBound) {
    const entity = await resolveEntity(token, args.entity || entityShort, args['model-type']);
    modelType = entity.fullClassName || args['model-type'];
    if (!modelType) die('could not resolve fully-qualified entity name (--model-type not provided)');
    metadata = await fetchMetadata(token, modelType);
  } else if (args.entity || args['model-type']) {
    // Non-entity template but caller passed an entity — resolve it for placeholder substitution
    // (so embedded datatables / TODO references get the right modelType), but skip metadata fetch.
    try {
      const entity = await resolveEntity(token, args.entity || entityShort, args['model-type']);
      modelType = entity.fullClassName || args['model-type'];
      info(`non-entity template (${template}) but --entity provided — using ${modelType} for placeholder substitution only`);
    } catch (_) {
      info(`non-entity template (${template}) — couldn't resolve --entity, leaving modelType empty`);
    }
  } else {
    info(`non-entity template (${template}) — skipping metadata fetch`);
  }

  const effectiveTemplate = plan ? plan.template : template;
  const effectiveTPL = TEMPLATES[effectiveTemplate];
  const seedPath = resolveSeedPath(effectiveTemplate);
  if (!seedPath) die(`template seed not found: assets/templates/{primary,examples}/${effectiveTemplate}.json`);
  info(`seed: ${path.relative(path.join(__dirname, '..'), seedPath)}`);
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  // Plan can override entity-shaped placeholders for non-entity templates or
  // when the AI wants different display copy than the entity name.
  const renderCtx = plan ? {
    module: module.name,
    entity: (plan.entity || (modelType.split('.').pop() || 'Item')),
    entityKebab: kebab(plan.entity || (modelType.split('.').pop() || 'Item')),
    entityPretty: plan.entityPretty || pretty(plan.entity || (modelType.split('.').pop() || 'Item')),
    entityPrettyPlural: plan.entityPrettyPlural || pluralize(plan.entityPretty || pretty(plan.entity || (modelType.split('.').pop() || 'Item'))),
    modelType: modelType || '',
  } : {
    module: module.name,
    entity: entityShort,
    entityKebab,
    entityPretty,
    entityPrettyPlural,
    modelType,
  };
  const rendered = renderSubstitutions(seed, renderCtx);
  idRemap(rendered);

  // Splice fields / columns
  if (plan) {
    // ---- Plan-driven splice (AI-authored) ----
    if (effectiveTPL.fieldsSlot) {
      const slot = findSlot(rendered.components, effectiveTPL.fieldsSlot);
      if (!slot) die(`template ${effectiveTemplate}: ${effectiveTPL.fieldsSlot} slot not found after render`);
      const planFields = (plan.fields || []).map(f => ({
        id: newGuid(),
        parentId: slot.id,
        editMode: 'editable',
        validate: {},
        ...f,
      }));
      info(`  plan: splicing ${planFields.length} field(s) verbatim from plan.fields`);
      if (effectiveTPL.sectionsBecomeSteps && plan.steps) {
        // Plan may declare wizard steps explicitly. Format: [{ title, fieldRefs: [propertyName, ...] }]
        const byName = new Map(planFields.map(f => [f.propertyName, f]));
        const steps = plan.steps.map((s, i) => ({
          id: newGuid(),
          key: s.key || 'step' + (i + 1),
          title: s.title || ('Step ' + (i + 1)),
          subTitle: s.subTitle,
          components: (s.fieldRefs || []).map(n => byName.get(n)).filter(Boolean),
        }));
        const wiz = findByType(rendered.components, 'wizard');
        if (!wiz) die('wizard template: no wizard component found after render');
        wiz.steps = steps;
        removeNode(rendered.components, slot.id);
      } else {
        slot.components = planFields;
        slot.propertyName = 'fieldsContainer';
      }
    }
    if (effectiveTemplate === 'table' && plan.columns) {
      const table = findByType(rendered.components, 'datatable');
      if (!table) die('table template: datatable not found after render');
      const cols = plan.columns.map(c => ({
        id: newGuid(),
        columnType: 'data',
        isVisible: true,
        sortable: true,
        minWidth: 120,
        ...c,
      }));
      table.items = [...(table.items || []), ...cols];
      info(`  plan: appended ${cols.length} column(s) from plan.columns`);
    }
    // Child tables (details template) — prepend one tab per childTable, keep Notes tab last
    if (plan.childTables && plan.childTables.length) {
      const childTabsHost = findByPropertyName(rendered.components, 'childTablesTabs');
      if (!childTabsHost) {
        info(`  plan.childTables ignored — template ${effectiveTemplate} does not expose a childTablesTabs slot`);
      } else {
        const existingTabs = childTabsHost.tabs || [];
        const notesIdx = existingTabs.findIndex(t => (t.key || '').toLowerCase() === 'notes');
        const newTabs = plan.childTables.map(ct => buildChildTableTab(ct, childTabsHost.id));
        if (notesIdx >= 0) {
          // Prepend new tabs before Notes
          childTabsHost.tabs = [...existingTabs.slice(0, notesIdx), ...newTabs, ...existingTabs.slice(notesIdx)];
        } else {
          childTabsHost.tabs = [...newTabs, ...existingTabs];
        }
        childTabsHost.defaultActiveKey = newTabs[0].key;
        info(`  plan: added ${newTabs.length} child-table tab(s): ${newTabs.map(t => t.title).join(', ')}`);
      }
    }
  } else if (TPL.fieldsSlot) {
    // ---- Legacy heuristic splice ----
    const slot = findSlot(rendered.components, TPL.fieldsSlot);
    if (!slot) die(`template ${template}.json: ${TPL.fieldsSlot} slot not found after render`);
    const fields = pickFields(metadata, args.include, args.exclude, maxFields, slot.id, module.name);

    if (TPL.polish) {
      info(`  organising layout (sections + 2-col pairing)`);
      const { sections, keyInfoItems } = layoutPolish.organize(fields, {
        newGuid,
        parentId: slot.id,
        withKeyInfoBar: TPL.keyInfoBar,
        withSections: fields.length >= 3,
      });

      if (TPL.sectionsBecomeSteps) {
        info(`  converting ${sections.filter(s => s.type === 'sectionSeparator').length} section(s) into wizard steps`);
        const steps = sectionsToWizardSteps(sections, slot.id);
        const wiz = findByType(rendered.components, 'wizard');
        if (!wiz) die('wizard template: no wizard component found after render');
        wiz.steps = steps;
        removeNode(rendered.components, slot.id);
      } else {
        slot.components = sections;
        slot.propertyName = 'fieldsContainer';
      }

      if (TPL.keyInfoBar && keyInfoItems.length) {
        injectKeyInfoBar(rendered, keyInfoItems);
        info(`  injected KeyInformationBar with ${keyInfoItems.length} item(s): ${keyInfoItems.map(i => i.propertyName).join(', ')}`);
      }
    } else {
      slot.components = fields;
      slot.propertyName = 'fieldsContainer';
    }
  } else if (template === 'table') {
    const table = findByType(rendered.components, 'datatable');
    if (!table) die('template table.json: datatable not found after render');
    const dataCols = pickColumns(metadata, args.include, args.exclude, maxFields);
    table.items = [...(table.items || []), ...dataCols];
  }

  // Apply design tokens — single restyle pass over the whole tree
  info('applying design tokens (styler.js)');
  const tokens = styler.loadTokens(args['tokens-file']);
  styler.style(rendered, tokens);

  // Write intermediate file for autofix + validate
  const tmpDir = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const stagePath = path.join(tmpDir, `shesha-form-${effFormName}-${Date.now()}.json`);
  fs.writeFileSync(stagePath, JSON.stringify(rendered, null, 2));
  info(`staged at ${stagePath}`);

  // Autofix
  info('running autofix.cjs');
  const fix = runScript('autofix.cjs', stagePath, ['--inplace']);
  if (fix.code !== 0) { process.stderr.write(fix.stderr); die(`autofix failed (exit ${fix.code})`); }
  process.stderr.write(fix.stderr);

  // Validate
  info('running validate.cjs');
  const valArgs = ['--name', effFormName];
  if (args.strict) valArgs.push('--strict');
  const val = runScript('validate.cjs', stagePath, valArgs);
  process.stderr.write(val.stderr);
  if (val.code !== 0) {
    die(`validate.cjs reported errors (exit ${val.code}). Inspect ${stagePath} and re-run.`);
  }

  // Re-read autofixed/validated tree
  const finalMarkup = JSON.parse(fs.readFileSync(stagePath, 'utf8'));

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(finalMarkup, null, 2));
    info(`wrote rendered markup to ${args.out}`);
  }

  if (!args.push) {
    info('dry-run (no --push). Rendered markup:');
    process.stdout.write(JSON.stringify(finalMarkup, null, 2) + '\n');
    info('To push: re-run with --push');
    process.exit(0);
  }

  // Push: Create then UpdateMarkup
  const formId = await pushCreate(token, module.id, effFormName, effFormLabel, modelType);
  await pushUpdateMarkup(token, formId, finalMarkup);
  info(`created form id=${formId}`);

  // Foldering (v0.45+). Mandatory if the ConfigurationStudio endpoints exist; opt out via --no-folder.
  if (args['no-folder']) {
    info('foldering: skipped (--no-folder)');
  } else {
    const folderSupported = await detectFolderSupport(token);
    if (!folderSupported) {
      info('foldering: ConfigurationStudio API not available (pre-v0.45 Shesha) — skipping');
    } else {
      const folderPath = (plan && plan.folder) || args.folder || defaultFolderPath(effectiveTemplate, renderCtx.entityPretty);
      info(`foldering: target path = "${folderPath}" (module="${module.name}")`);
      const folderId = await ensureFolderPath(token, module.id, folderPath);
      if (folderId) {
        await moveItemToFolder(token, formId, folderId);
        info(`  ✓ form filed under ${module.name}/${folderPath}`);
      }
    }
  }

  if (args.verify) {
    await verify(token, formId);
  }

  // Final summary
  const route = (finalMarkup.formSettings && finalMarkup.formSettings.access === 5)
    ? `/no-auth/${module.name}/${effFormName}`
    : `/dynamic/${module.name}/${effFormName}`;
  info(`DONE. Form id=${formId} name=${effFormName} module=${module.name}`);
  info(`Route: ${route}`);
  process.exit(0);
})().catch(err => {
  console.error('scaffold: unexpected error:', err.stack || err.message || err);
  process.exit(1);
});
