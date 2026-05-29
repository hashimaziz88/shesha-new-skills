// Build a new entity's forms by transforming the canonical example seeds.
// This is the workflow the skill prescribes: copy example, swap entity-specific bits.
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(__dirname, '..', 'assets', 'examples');
const BASE_URL = 'http://localhost:21021';
const MODULE = 'A.Test';
const MODULE_ID = '4817b124-8749-4d04-a96d-8cc6a5f19097';

export async function auth() {
  const r = await fetch(`${BASE_URL}/api/TokenAuth/Authenticate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userNameOrEmailAddress: 'admin', password: '123qwe' })
  });
  return (await r.json()).result.accessToken;
}

// Replace template tokens {{GEN_KEY}} / {{NEW_KEY}} with stable fresh UUIDs.
// Each *occurrence* of a key token in the example is actually the SAME logical node id,
// but the examples reuse one token string for the single context id — so we map the
// token to ONE uuid per form. (The examples only have one dataContext, so this holds.)
function detokenize(markupStr) {
  const tokens = ['{{GEN_KEY}}', '{{NEW_KEY}}'];
  let out = markupStr;
  for (const t of tokens) {
    const uuid = randomUUID();
    out = out.split(t).join(uuid);
  }
  return out;
}

export function loadSeed(name) {
  return readFileSync(join(EXAMPLES, name), 'utf8');
}

// Generic swap: entity full type, short name, create-form name, and datatable columns.
export function transformTable(seedStr, { entityFull, createFormName, columns }) {
  let s = detokenize(seedStr);
  const m = JSON.parse(s);
  // swap entityType everywhere it equals the example employee type
  const EMP = 'A.Test.Domain.Domain.Payroll.Employee';
  s = JSON.stringify(m).split(EMP).join(entityFull);
  const tree = JSON.parse(s);

  // walk + fix: datatable items, Add-button formId
  walk(tree.components, c => {
    if (c.type === 'datatable') {
      c.items = columns.map((col, i) => ({
        id: randomUUID(), itemType: 'item', sortOrder: i,
        columnType: 'data', propertyName: col.prop, caption: col.caption,
        isVisible: true
      }));
    }
    if (c.type === 'buttonGroup' && Array.isArray(c.items)) {
      for (const it of c.items) {
        const args = it.actionConfiguration?.actionArguments;
        if (args?.formId?.name) { args.formId.name = createFormName; args.formId.module = MODULE; }
      }
    }
  });
  if (tree.formSettings) tree.formSettings.modelType = entityFull;
  return tree;
}

export function transformCreate(seedStr, { entityFull, fields }) {
  let s = detokenize(seedStr);
  const EMP = 'A.Test.Domain.Domain.Payroll.Employee';
  s = s.split(EMP).join(entityFull);
  const tree = JSON.parse(s);
  if (tree.formSettings) tree.formSettings.modelType = entityFull;

  // Find the columns(detailsPanel) and replace its field components with our fields,
  // copying the styling envelope from the first existing field of the matching type.
  const samples = {};
  walk(tree.components, c => {
    if (['textField','numberField','dateField','dropdown','autocomplete','textArea','checkbox'].includes(c.type) && !samples[c.type]) {
      samples[c.type] = c;
    }
  });

  function makeField(f) {
    const base = samples[f.type] ? JSON.parse(JSON.stringify(samples[f.type])) : { type: f.type };
    base.id = randomUUID();
    base.propertyName = f.prop;
    base.componentName = f.prop;
    base.name = f.prop;
    base.label = f.label;
    base.editMode = 'inherited';
    delete base.parentId;
    return base;
  }

  walk(tree.components, c => {
    if (c.type === 'columns' && c.propertyName === 'detailsPanel') {
      const cols = c.columns || [];
      // distribute fields across the 2 columns
      cols.forEach(col => col.components = []);
      fields.forEach((f, i) => {
        const target = cols[i % cols.length];
        target.components.push(makeField(f));
      });
    }
  });
  return tree;
}

function walk(nodes, cb) {
  if (!Array.isArray(nodes)) return;
  for (const c of nodes) {
    if (!c || typeof c !== 'object') continue;
    cb(c);
    if (c.components) walk(c.components, cb);
    if (c.columns) for (const col of c.columns) if (col?.components) walk(col.components, cb);
    if (c.tabs) for (const t of c.tabs) if (t?.components) walk(t.components, cb);
  }
}

// Re-stamp parentId across the whole tree so links are valid after edits.
export function stampTree(nodes, parentId) {
  return nodes.map(node => {
    if (!node?.type) return { ...node, components: stampTree(node.components || [], parentId) };
    const n = { ...node, parentId };
    if (n.components) n.components = stampTree(n.components, node.id);
    if (n.columns)    n.columns    = n.columns.map(col => ({ ...col, components: stampTree(col.components || [], node.id) }));
    if (n.tabs)       n.tabs       = n.tabs.map(t => ({ ...t, components: stampTree(t.components || [], node.id) }));
    return n;
  });
}

export async function getOrCreate(token, name, label, modelType) {
  const ex = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/GetByName?module=${MODULE}&name=${name}`,
    { headers: { Authorization: `Bearer ${token}` } });
  const ed = await ex.json();
  if (ed.result?.id) return ed.result.id;
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/Create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ moduleId: MODULE_ID, name, label, modelType })
  });
  const d = await r.json();
  if (!d.result?.id) throw new Error(`Create ${name}: ${JSON.stringify(d.error)}`);
  return d.result.id;
}

export async function push(token, id, markup) {
  // JSON safety check (Step 5.5)
  const str = JSON.stringify(markup);
  JSON.parse(str);
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/UpdateMarkup`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, markup: str })
  });
  const d = await r.json();
  if (!d.success) throw new Error(`push ${id}: ${JSON.stringify(d.error)}`);
}
