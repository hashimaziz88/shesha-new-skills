#!/usr/bin/env node
/**
 * components-index.js — single source of truth for "what props does <component type> support".
 *
 * Loads the canonical component-properties index shipped with the `shesha-developer:clean-form-config`
 * skill (assets/groups/*.json). That skill is the authority — never duplicate the index here.
 *
 * Resolution order:
 *   1. SHESHA_COMPONENTS_INDEX_DIR env var (explicit override, used by tests)
 *   2. ~/.claude/plugins/cache/shesha-plugins/shesha-developer/<latest>/skills/clean-form-config/assets/groups/
 *   3. ~/.claude/plugins/marketplaces/shesha-plugins/plugins/shesha-developer/skills/clean-form-config/assets/groups/
 *   4. Throws with a clear remediation message
 *
 * Public API:
 *   const idx = require('./components-index.js');
 *   idx.types()                    // -> ['button','textField',...] (every known type)
 *   idx.propsFor(type)             // -> [{name,type,required,JsReturnType,desc}, ...] (component-specific only)
 *   idx.basePropsFor()             // -> [...] (base props that apply to every component)
 *   idx.allPropsFor(type)          // -> base props + component-specific (deduped)
 *   idx.isKnownType(type)          // -> boolean
 *   idx.sourceDir                  // -> resolved path (for error messages)
 *
 * Caches on first call; subsequent require()s are cheap.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let _cache = null;

function findIndexDir() {
  if (process.env.SHESHA_COMPONENTS_INDEX_DIR) {
    const dir = process.env.SHESHA_COMPONENTS_INDEX_DIR;
    if (fs.existsSync(path.join(dir, 'index.json'))) return dir;
    throw new Error(`SHESHA_COMPONENTS_INDEX_DIR=${dir} but index.json not found there`);
  }

  const home = os.homedir();
  const cacheRoot = path.join(home, '.claude', 'plugins', 'cache', 'shesha-plugins', 'shesha-developer');
  if (fs.existsSync(cacheRoot)) {
    const versions = fs.readdirSync(cacheRoot)
      .filter(v => /^\d+\.\d+\.\d+/.test(v))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
        return 0;
      });
    for (const v of versions) {
      const dir = path.join(cacheRoot, v, 'skills', 'clean-form-config', 'assets', 'groups');
      if (fs.existsSync(path.join(dir, 'index.json'))) return dir;
    }
  }

  const marketplaceDir = path.join(home, '.claude', 'plugins', 'marketplaces', 'shesha-plugins',
    'plugins', 'shesha-developer', 'skills', 'clean-form-config', 'assets', 'groups');
  if (fs.existsSync(path.join(marketplaceDir, 'index.json'))) return marketplaceDir;

  throw new Error(
    'Component-properties index not found. Install the `shesha-developer` plugin ' +
    '(it ships the canonical index at skills/clean-form-config/assets/groups/). ' +
    'To override: set SHESHA_COMPONENTS_INDEX_DIR.'
  );
}

function load() {
  if (_cache) return _cache;
  const dir = findIndexDir();
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const groups = {};
  for (const file of index.groupFiles) {
    groups[file.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  const baseProps = (groups.base && groups.base.base && groups.base.base.props) || [];
  const baseNames = new Set(baseProps.map(p => p.name));

  const byType = {};
  for (const [type, groupName] of Object.entries(index.components)) {
    const g = groups[groupName];
    const entry = g && g[type];
    byType[type] = {
      group: groupName,
      props: (entry && entry.props) || [],
      propNames: new Set((entry && entry.props || []).map(p => p.name)),
    };
  }

  _cache = { sourceDir: dir, index, baseProps, baseNames, byType };
  return _cache;
}

function types() { return Object.keys(load().byType); }
function propsFor(type) { const c = load(); return (c.byType[type] && c.byType[type].props) || []; }
function basePropsFor() { return load().baseProps; }
function allPropsFor(type) {
  const c = load();
  const own = c.byType[type] ? c.byType[type].props : [];
  const ownNames = new Set(own.map(p => p.name));
  return [...own, ...c.baseProps.filter(p => !ownNames.has(p.name))];
}
function isKnownType(type) { return !!load().byType[type]; }
function isValidProp(type, prop) {
  const c = load();
  if (c.baseNames.has(prop)) return true;
  const t = c.byType[type];
  return !!(t && t.propNames.has(prop));
}

module.exports = {
  get sourceDir() { return load().sourceDir; },
  types, propsFor, basePropsFor, allPropsFor, isKnownType, isValidProp,
};

if (require.main === module) {
  // CLI: node components-index.js [type]
  const arg = process.argv[2];
  if (!arg) {
    const c = load();
    console.log('Source:', c.sourceDir);
    console.log('Known types:', types().length);
    console.log('Base props:', c.baseProps.length);
    process.exit(0);
  }
  if (!isKnownType(arg)) { console.error('Unknown type:', arg); process.exit(2); }
  const own = propsFor(arg);
  console.log(`# ${arg} (${own.length} component-specific props)`);
  own.forEach(p => console.log(`  ${p.name}${p.required ? '*' : ''} : ${p.type || '?'}`));
  console.log(`# + ${basePropsFor().length} base props (label, propertyName, id, parentId, etc.)`);
}
