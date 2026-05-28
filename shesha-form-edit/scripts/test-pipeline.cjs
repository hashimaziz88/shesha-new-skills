#!/usr/bin/env node
/**
 * test-pipeline.js — offline smoke test for enrich + layout-polish + styler.
 *
 * Mocks the metadata fetch with a representative Person-like entity, runs the
 * full render → enrich → polish → style pipeline, writes the output JSON.
 * Useful when you can't auth into a live backend.
 *
 * Usage:
 *   node test-pipeline.js [--template=details|table|create] [--out=path]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const enrich = require('./enrich.js');
const layoutPolish = require('./layout-polish.js');
const styler = require('./styler.js');
const pluralize = require('./pluralize.js');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));

const template = args.template || 'details';
const out = args.out || path.join(process.env.TEMP || '/tmp', `test-${template}.json`);

// ----- Mock metadata (a Person-shaped entity) -----
const mockProps = [
  { path: 'FirstName',     name: 'FirstName',     label: 'First Name',  dataType: 'string', required: true },
  { path: 'LastName',      name: 'LastName',      label: 'Last Name',   dataType: 'string', required: true },
  { path: 'EmailAddress1', name: 'EmailAddress1', label: 'Email',       dataType: 'string' },
  { path: 'MobileNumber',  name: 'MobileNumber',  label: 'Mobile',      dataType: 'string' },
  { path: 'DateOfBirth',   name: 'DateOfBirth',   label: 'Date of Birth', dataType: 'date' },
  { path: 'AddressLine1',  name: 'AddressLine1',  label: 'Address Line 1', dataType: 'string' },
  { path: 'City',          name: 'City',          label: 'City',        dataType: 'string' },
  { path: 'PostalCode',    name: 'PostalCode',    label: 'Postal Code', dataType: 'string' },
  { path: 'Country',       name: 'Country',       label: 'Country',     dataType: 'string' },
  { path: 'Description',   name: 'Description',   label: 'About',       dataType: 'string' },
  { path: 'Status',        name: 'Status',        label: 'Status',      dataType: 'string', referenceListName: 'PersonStatus', referenceListModule: 'Shesha' },
  { path: 'SalaryAmount',  name: 'SalaryAmount',  label: 'Salary',      dataType: 'decimal' }
];

// ----- ID factory + helpers (copied from scaffold.js's minimal surface) -----
function newGuid() { return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 22); }
function camel(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function pretty(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2'); }

// ----- propToComponent (mirror of scaffold.js) -----
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
  if (prop.referenceListName) {
    return { ...base, type: 'dropdown', dataSourceType: 'referenceList',
      referenceListId: { name: prop.referenceListName, module: prop.referenceListModule || moduleName || 'Shesha' } };
  }
  if (prop.entityType) {
    return { ...base, type: 'entityPicker', entityType: prop.entityType, mode: 'single', displayProperty: '_displayName' };
  }
  const dt = String(prop.dataType || '').toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return { ...base, type: 'checkbox' };
  if (['number','int','integer','decimal','float','double','long'].includes(dt)) return { ...base, type: 'numberField' };
  if (dt === 'date' || dt === 'datetime' || dt === 'date-time') return { ...base, type: 'dateField', dateFormat: 'DD/MM/YYYY' };
  if (dt === 'multiline-string' || dt === 'text') return { ...base, type: 'textArea', rows: 3 };
  return { ...base, type: 'textField' };
}

// ----- Render -----
function findSlot(node, propName) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findSlot(n, propName); if (r) return r; } return null; }
  if (node.propertyName === propName) return node;
  for (const k of ['components', 'tabs', 'columns']) {
    if (Array.isArray(node[k])) { const r = findSlot(node[k], propName); if (r) return r; }
  }
  if (node.header) { const r = findSlot(node.header, propName); if (r) return r; }
  if (node.content) { const r = findSlot(node.content, propName); if (r) return r; }
  return null;
}
function findByType(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findByType(n, type); if (r) return r; } return null; }
  if (node.type === type) return node;
  for (const k of ['components', 'tabs', 'columns', 'items']) {
    if (Array.isArray(node[k])) { const r = findByType(node[k], type); if (r) return r; }
  }
  return null;
}
function idRemap(form) {
  const map = new Map();
  function collect(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(collect);
    if (typeof n.id === 'string' && !map.has(n.id)) map.set(n.id, newGuid());
    for (const k of ['components','tabs','columns','items']) if (Array.isArray(n[k])) collect(n[k]);
    if (n.header && Array.isArray(n.header.components)) collect(n.header.components);
    if (n.content && Array.isArray(n.content.components)) collect(n.content.components);
  }
  function rewrite(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(rewrite);
    if (typeof n.id === 'string' && map.has(n.id)) n.id = map.get(n.id);
    if (typeof n.parentId === 'string' && map.has(n.parentId)) n.parentId = map.get(n.parentId);
    for (const k of ['components','tabs','columns','items']) if (Array.isArray(n[k])) rewrite(n[k]);
    if (n.header && Array.isArray(n.header.components)) rewrite(n.header.components);
    if (n.content && Array.isArray(n.content.components)) rewrite(n.content.components);
  }
  collect(form.components);
  rewrite(form.components);
}

// ----- Run -----
const ctx = {
  module: 'A.Test',
  entity: 'Person',
  entityKebab: 'person',
  entityPretty: 'Person',
  entityPrettyPlural: pluralize('Person'),
  modelType: 'Shesha.Domain.Person'
};

// Resolve template seed across primary/ / examples/ subfolders
const base = path.join(__dirname, '..', 'assets', 'templates');
let seedPath = null;
for (const sub of ['primary', 'examples', '']) {
  const candidate = path.join(base, sub, `${template}.json`);
  if (fs.existsSync(candidate)) { seedPath = candidate; break; }
}
if (!seedPath) { console.error(`template seed not found: ${template}`); process.exit(1); }
const seedRaw = fs.readFileSync(seedPath, 'utf8');
const sub = seedRaw
  .replace(/__MODULE__/g, ctx.module)
  .replace(/__ENTITY_PRETTY_PLURAL__/g, ctx.entityPrettyPlural)
  .replace(/__ENTITY_PRETTY__/g, ctx.entityPretty)
  .replace(/__ENTITY_KEBAB__/g, ctx.entityKebab)
  .replace(/__ENTITY__/g, ctx.entity)
  .replace(/__MODEL_TYPE__/g, ctx.modelType);
const rendered = JSON.parse(sub);
delete rendered._template;
idRemap(rendered);

if (template === 'details' || template === 'create') {
  const slot = findSlot(rendered.components, '__SLOT_FIELDS__');
  if (!slot) { console.error(`No __SLOT_FIELDS__ in ${template}`); process.exit(1); }
  const fields = mockProps.slice(0, 10).map(p => enrich({ ...p, name: camel(p.path || p.name) }, propToComponent(p, slot.id, ctx.module)));
  const { sections, keyInfoItems } = layoutPolish.organize(fields, {
    newGuid, parentId: slot.id, withKeyInfoBar: template === 'details', withSections: fields.length >= 3
  });
  slot.components = sections;
  slot.propertyName = 'fieldsContainer';
  console.error(`KeyInfoBar candidates: ${keyInfoItems.map(i => i.propertyName).join(', ') || '(none)'}`);
} else if (template === 'table') {
  const table = findByType(rendered.components, 'datatable');
  const cols = mockProps.slice(0, 6).map(p => ({
    id: newGuid(), columnType: 'data', propertyName: camel(p.path || p.name), caption: p.label, isVisible: true, sortable: true, minWidth: 120
  }));
  table.items = [...(table.items || []), ...cols];
}

const tokens = styler.loadTokens();
styler.style(rendered, tokens);

fs.writeFileSync(out, JSON.stringify(rendered, null, 2));
console.error(`Wrote ${out} (${(fs.statSync(out).size/1024).toFixed(1)} KB)`);

// Summary
function walk(n, fn) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) return n.forEach(x => walk(x, fn));
  fn(n);
  for (const k of ['components','tabs','columns','items']) if (Array.isArray(n[k])) walk(n[k], fn);
}
const counts = {};
walk(rendered.components, n => { if (n.type) counts[n.type] = (counts[n.type]||0) + 1; });
console.error('Components by type:');
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([t,c]) => console.error(`  ${t.padEnd(20)} ${c}`));
