#!/usr/bin/env node
/**
 * validate.js — runs MCP-derived structural validators on a form JSON.
 *
 * Reports errors and warnings. Errors block push; warnings are surfaced to the user.
 * Run AFTER autofix.js, BEFORE invoking clean-form-config.
 *
 * For the broader "is every property valid for this component type" check, defer to
 * `shesha-developer:clean-form-config` (the canonical index is its assets/groups/*.json;
 * see scripts/components-index.js). This file only runs the high-leverage targeted checks
 * that catch real bugs.
 *
 * Checks performed:
 *   - Form-name regex (when --name <name> is provided)
 *   - Unique component ids in the tree
 *   - Every parentId resolves to an existing id (or "root")
 *   - Components have a `type`
 *   - Component-specific required props:
 *       entityPicker: entityType
 *       dropdown / radio / checkboxGroup with dataSourceType="referenceList": referenceListId { name, module }
 *       datatableContext with sourceType="Entity": entityType OR dataSourceEntity
 *       subForm: formId { name, module }, formSelectionMode, dataSource
 *       refListStatus: module + referenceListName (flat keys, NOT referenceListId)
 *   - IPropertySetting shape: when an object has _mode, it must be "value" or "code"; "value" needs _value, "code" needs _code
 *   - editMode === "editable" on every interactive node type
 *   - Dropdown values items shape ({ id, label, value }) when dataSourceType="values"
 *
 * Usage:
 *   node validate.js <input.json> [--name <form-name>] [--strict]
 *
 * Exit codes: 0 = no errors, 1 = errors, 2 = bad invocation.
 */

const fs = require('fs');

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.error('Usage: node validate.js <input.json|-> [--name <form-name>] [--strict]');
  process.exit(args.includes('--help') ? 0 : 2);
}

const input = args[0];
const nameIdx = args.indexOf('--name');
const proposedName = nameIdx >= 0 ? args[nameIdx + 1] : null;
const strict = args.includes('--strict');

const FORM_NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const INTERACTIVE_TYPES = new Set([
  'textField', 'textArea', 'numberField', 'dateField', 'timePicker',
  'dropdown', 'radio', 'checkbox', 'checkboxGroup', 'switch', 'rate',
  'slider', 'autocomplete', 'entityPicker', 'entitySelector', 'colorPicker',
  'richTextEditor', 'fileUpload', 'notes', 'address', 'button', 'link',
  'buttonGroupItem'
]);

const errors = [];
const warnings = [];

function err(msg)  { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

let raw;
try { raw = (input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8')).replace(/^﻿/, ''); }
catch (e) { console.error(`validate: cannot read input: ${e.message}`); process.exit(2); }

let tree;
try { tree = JSON.parse(raw); }
catch (e) { console.error(`validate: input is not valid JSON: ${e.message}`); process.exit(2); }
if (tree && tree.result && tree.result.markup && typeof tree.result.markup === 'string') tree = JSON.parse(tree.result.markup);
if (tree && typeof tree.markup === 'string') tree = JSON.parse(tree.markup);

// ----- Form-name regex -----
if (proposedName !== null) {
  if (!FORM_NAME_REGEX.test(proposedName)) {
    err(`Form name "${proposedName}" must be kebab-case matching ${FORM_NAME_REGEX} (lowercase, must start with letter, digits and hyphens allowed).`);
  }
}

// ----- Collect ids, validate parentId chain, run per-component checks -----
const ids = new Set();
const parentIdRefs = []; // { id, parentId }

function isObjFormId(v) {
  return v && typeof v === 'object' && typeof v.name === 'string' && typeof v.module === 'string';
}

// Keys whose values are action-config / binding blobs — never recurse into these for
// id collection. They contain template literals like { id: "{{data.id}}" } in payloads
// which are NOT component ids.
const SKIP_KEYS = new Set([
  'actionConfiguration', 'actionArguments', 'onSuccess', 'onFail', 'validate',
  'dataLoadersSettings', 'dataSubmittersSettings', 'doneButtonAction',
  'onBeforeDataLoad', 'onAfterDataLoad', 'onPrepareSubmitData', 'onBeforeSubmit',
  'onSubmitSuccess', 'onSubmitFailed', 'permanentFilter', 'queryParams',
]);

function walk(node, where) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, `${where}[${i}]`));
    return;
  }
  if (typeof node !== 'object') return;

  if ('_mode' in node && node._mode !== undefined) {
    if (node._mode !== 'value' && node._mode !== 'code') {
      warn(`IPropertySetting at ${where}: _mode "${node._mode}" should be "value" or "code".`);
    } else if (node._mode === 'value' && !('_value' in node)) {
      warn(`IPropertySetting at ${where}: _mode "value" missing _value.`);
    } else if (node._mode === 'code' && !('_code' in node)) {
      warn(`IPropertySetting at ${where}: _mode "code" missing _code.`);
    }
  }

  // Track ids on any tree node we walked into (we never enter action-config blobs).
  if (node.id && typeof node.id === 'string') {
    if (ids.has(node.id)) err(`Duplicate id "${node.id}" at ${where}.`);
    ids.add(node.id);
  }

  if (node.type && (node.id || node.parentId !== undefined)) {
    if (!node.id) err(`Component at ${where} (type=${node.type}) is missing id.`);
    if (node.parentId !== undefined && node.parentId !== null && node.parentId !== 'root') {
      parentIdRefs.push({ id: node.id, parentId: node.parentId, where });
    }

    // editMode check on interactive nodes
    if (INTERACTIVE_TYPES.has(node.type)) {
      if (node.editMode !== 'editable' && node.editMode !== 'readOnly' && node.editMode !== 'inherited') {
        warn(`${where} (type=${node.type}) missing editMode — interactive components should have editMode: "editable" (or "readOnly"/"inherited" by design).`);
      } else if (node.editMode === undefined) {
        warn(`${where} (type=${node.type}) missing editMode.`);
      }
    }

    switch (node.type) {
      case 'entityPicker':
      case 'autocomplete':
      case 'entitySelector':
        if (!node.entityType) err(`${where} (type=${node.type}) requires entityType.`);
        break;
      case 'dropdown':
      case 'radio':
      case 'checkboxGroup': {
        const dst = node.dataSourceType;
        if (dst === 'referenceList') {
          if (!isObjFormId(node.referenceListId)) {
            err(`${where} (type=${node.type}) referenceList datasource requires referenceListId as { name, module }.`);
          }
        } else if (dst === 'values') {
          if (Array.isArray(node.values)) {
            node.values.forEach((v, i) => {
              if (!v || typeof v !== 'object' || typeof v.id === 'undefined' || typeof v.label === 'undefined' || typeof v.value === 'undefined') {
                warn(`${where}.values[${i}] must have { id, label, value }.`);
              }
            });
          }
        }
        break;
      }
      case 'refListStatus':
        if (!node.module || !node.referenceListName) {
          err(`${where} (type=refListStatus) requires flat keys 'module' and 'referenceListName' (NOT referenceListId object).`);
        }
        if (node.referenceListId) {
          warn(`${where} (type=refListStatus) has referenceListId object — refListStatus uses flat module+referenceListName instead.`);
        }
        break;
      case 'datatableContext':
        if (node.sourceType === 'Entity') {
          if (!node.entityType && !node.dataSourceEntity) {
            err(`${where} (type=datatableContext) sourceType=Entity requires entityType or dataSourceEntity.`);
          }
        }
        if (!node.componentName) warn(`${where} (type=datatableContext) should have componentName for action references.`);
        break;
      case 'subForm':
        if (!isObjFormId(node.formId)) {
          err(`${where} (type=subForm) requires formId as { name, module }.`);
        }
        if (!node.formSelectionMode) warn(`${where} (type=subForm) should set formSelectionMode (typically "name").`);
        if (!node.dataSource) warn(`${where} (type=subForm) should set dataSource (typically "api").`);
        if (node.entityType && node.propertyName && !node.queryParams) {
          warn(`${where} (type=subForm) has entityType + propertyName but no queryParams — typically "    return { id: data.${node.propertyName}?.id };".`);
        }
        break;
      case 'card':
      case 'collapsiblePanel':
        if (Array.isArray(node.components) && node.components.length) {
          warn(`${where} (type=${node.type}) has components[] at root — children belong on header.components / content.components, not on this.components.`);
        }
        break;
    }
  }

  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    if (node[k] && typeof node[k] === 'object') {
      walk(node[k], `${where}.${k}`);
    }
  }
}

walk(tree, 'root');

for (const ref of parentIdRefs) {
  if (!ids.has(ref.parentId)) {
    err(`Component "${ref.id}" at ${ref.where} references missing parentId "${ref.parentId}".`);
  }
}

// ----- Report -----
function emit() {
  if (errors.length) {
    console.error(`\n❌ ${errors.length} error(s):`);
    errors.forEach(e => console.error('  - ' + e));
  }
  if (warnings.length) {
    console.error(`\n⚠️  ${warnings.length} warning(s):`);
    warnings.forEach(w => console.error('  - ' + w));
  }
  if (!errors.length && !warnings.length) {
    console.error('✓ validate: no issues');
  }
}

emit();
process.exit(errors.length ? 1 : (strict && warnings.length ? 1 : 0));
