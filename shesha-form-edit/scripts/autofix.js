#!/usr/bin/env node
/**
 * autofix.js — applies the MCP transformer's deterministic fixes to a form JSON.
 *
 * Idempotent. Run AFTER editing, BEFORE invoking clean-form-config.
 *
 * Fixes applied:
 *   1. Global-deref dedupe in all _code strings: form.form.X → form.X, data.data.X → data.X, globalState.globalState.X → globalState.X
 *   2. stylingBox stringification: if stylingBox is an object, JSON.stringify it
 *   3. Per-breakpoint styling sanitisation: fill non-null defaults for border/background/font/dimensions/shadow under desktop/tablet/mobile
 *   4. DataTableContext actionOwner resolution: replace actionOwner === <context.componentName> with <context.id> recursively (including nested onSuccess/onFail)
 *   5. required → validate.required normalisation
 *
 * Usage:
 *   node autofix.js <input.json> [--out <output.json>] [--inplace]
 *   cat form.json | node autofix.js - > form-fixed.json
 *
 * Reads from file or stdin (-); writes to file (--out / --inplace) or stdout.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.error('Usage: node autofix.js <input.json|-> [--out <output.json>] [--inplace]');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const input = args[0];
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
const inplace = args.includes('--inplace');

function readInput() {
  if (input === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(input, 'utf8');
}

let raw = readInput().replace(/^﻿/, '');
// Unwrap ABP envelope or stringified markup if present.
let tree;
try {
  tree = JSON.parse(raw);
} catch (e) {
  console.error('autofix: input is not valid JSON:', e.message);
  process.exit(2);
}
if (tree && typeof tree === 'object' && tree.result && tree.result.markup && typeof tree.result.markup === 'string') {
  tree = JSON.parse(tree.result.markup);
}
if (tree && typeof tree === 'object' && tree.markup && typeof tree.markup === 'string') {
  tree = JSON.parse(tree.markup);
}

// ----- 1. Global-deref dedupe (form.form.X → form.X) -----
const DOUBLED = /\b(form|data|globalState)\.\1\./g;
function fixDoubledGlobals(s) {
  return typeof s === 'string' ? s.replace(DOUBLED, '$1.') : s;
}

// ----- 2. stylingBox stringify -----
function fixStylingBox(node) {
  if (node && typeof node.stylingBox === 'object' && node.stylingBox !== null) {
    node.stylingBox = JSON.stringify(node.stylingBox);
  }
}

// ----- 3. Styling sanitisation -----
const STYLE_DEFAULTS = {
  border: { hideBorder: false, radiusType: 'all', borderType: 'all',
    border: { all: { width: '1px', style: 'solid', color: '#d9d9d9' } },
    radius: { all: 8 } },
  background: { type: 'color', color: '#ffffff',
    repeat: 'no-repeat', size: 'cover', position: 'center' },
  font: { color: '#000', type: 'Arial', align: 'left', size: 14, weight: '400' },
  dimensions: { height: '32px', width: '100%',
    minHeight: '0px', minWidth: '0px', maxWidth: '100%', maxHeight: '100%' },
  shadow: { offsetX: 0, offsetY: 0, color: '#000000',
    blurRadius: 0, spreadRadius: 0 }
};
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function sanitiseBreakpoint(bp) {
  if (!bp || typeof bp !== 'object') return;
  for (const key of Object.keys(STYLE_DEFAULTS)) {
    if (key in bp && bp[key] === null) bp[key] = deepClone(STYLE_DEFAULTS[key]);
  }
}
function sanitiseStyling(node) {
  for (const bpKey of ['desktop', 'tablet', 'mobile']) {
    if (node[bpKey]) sanitiseBreakpoint(node[bpKey]);
  }
}

// ----- 4. ActionOwner context resolution -----
// Walks the tree once collecting dataTableContext nodes (componentName → id).
// Then walks again rewriting actionOwner inside any actionConfiguration / onSuccess / onFail
// where it matches a context's componentName.
function collectContextMap(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectContextMap(n, out)); return; }
  if (node.type === 'datatableContext' && node.componentName && node.id) {
    out[node.componentName] = node.id;
  }
  for (const k of Object.keys(node)) {
    if (typeof node[k] === 'object') collectContextMap(node[k], out);
  }
}
function resolveActionOwner(node, contextMap) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => resolveActionOwner(n, contextMap)); return; }
  if (node.actionOwner && contextMap[node.actionOwner]) {
    node.actionOwner = contextMap[node.actionOwner];
  }
  for (const k of Object.keys(node)) {
    if (typeof node[k] === 'object') resolveActionOwner(node[k], contextMap);
  }
}

// ----- 5a. v8 radio: mirror values → items when items missing -----
function mirrorRadioItems(node) {
  if (node && node.type === 'radio' && Array.isArray(node.values) && !Array.isArray(node.items)) {
    node.items = node.values.map(v => ({ label: v.label, value: v.value }));
  }
}

// ----- 5b. v8 input breakpoint blocks: when desktop/tablet/mobile exists but is empty,
//        populate with input-styling defaults so the component renders. -----
const INPUT_STYLING_DEFAULTS = {
  stylingBox: '{}',
  border: { hideBorder: false, radiusType: 'all', borderType: 'all',
    border: { all: { width: '1px', style: 'solid', color: '#d9d9d9' }, top: {}, bottom: {}, left: {}, right: {} },
    radius: { all: 8 } },
  background: { type: 'color', color: '#fff', repeat: 'no-repeat', size: 'auto', position: 'center',
    gradient: { direction: 'to right', colors: {} }, url: '', storedFile: { id: null }, uploadFile: null },
  font: { color: '#000', type: 'Segoe UI', align: 'left', size: 14, weight: '400' },
  dimensions: { width: '100%', height: 'auto', minHeight: '32px', maxHeight: 'auto', minWidth: '0px', maxWidth: 'auto' },
  shadow: { offsetX: 0, offsetY: 0, color: '#000', blurRadius: 0, spreadRadius: 0 },
  enableStyleOnReadonly: false
};
const INPUT_TYPES = new Set(['textField','textArea','numberField','dateField','timePicker','dropdown','radio','checkboxGroup','autocomplete','entityPicker','colorPicker']);
function fillEmptyInputBreakpoints(node) {
  if (!node || !INPUT_TYPES.has(node.type)) return;
  for (const bp of ['desktop','tablet','mobile']) {
    if (node[bp] && typeof node[bp] === 'object' && Object.keys(node[bp]).length === 0) {
      node[bp] = JSON.parse(JSON.stringify(INPUT_STYLING_DEFAULTS));
    }
  }
}

// ----- 5. required → validate.required normalisation -----
// Only apply on objects that look like form components — i.e. they have a `type`.
// (Otherwise `validate: { required: true }` would itself trigger normalisation,
// creating `validate.validate.required` recursively.)
function normaliseRequired(node) {
  if (node && typeof node.type === 'string' && node.required === true) {
    node.validate = node.validate && typeof node.validate === 'object' ? node.validate : {};
    if (node.validate.required === undefined) node.validate.required = true;
    delete node.required;
  }
}

// ----- Recursive walker (cycle-safe) -----
const visited = new WeakSet();
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (visited.has(node)) return;
  visited.add(node);
  if (Array.isArray(node)) { node.forEach(walk); return; }

  // Fix _code in this node and script-key strings
  for (const k of Object.keys(node)) {
    if (k === '_code' && typeof node[k] === 'string') node[k] = fixDoubledGlobals(node[k]);
    if (typeof node[k] === 'string' && /^[a-z][a-zA-Z]*$/.test(k) &&
        (k === 'expression' || k.startsWith('on') || k === 'customVisibility' ||
         k === 'customEnabled' || k === 'getOptions' || k === 'validator' ||
         k === 'queryParams' || k === 'dynamicEndpoint')) {
      node[k] = fixDoubledGlobals(node[k]);
    }
  }
  fixStylingBox(node);
  sanitiseStyling(node);
  normaliseRequired(node);
  mirrorRadioItems(node);
  fillEmptyInputBreakpoints(node);

  for (const k of Object.keys(node)) {
    if (node[k] && typeof node[k] === 'object') walk(node[k]);
  }
}

walk(tree);

// actionOwner resolution requires a two-pass.
const contextMap = {};
collectContextMap(tree, contextMap);
if (Object.keys(contextMap).length) resolveActionOwner(tree, contextMap);

const output = JSON.stringify(tree, null, 2);

if (inplace) {
  if (input === '-') {
    console.error('autofix: --inplace requires a file input');
    process.exit(2);
  }
  fs.writeFileSync(input, output);
  console.error(`autofix: wrote ${input}`);
} else if (outPath) {
  fs.writeFileSync(outPath, output);
  console.error(`autofix: wrote ${outPath}`);
} else {
  process.stdout.write(output);
}
