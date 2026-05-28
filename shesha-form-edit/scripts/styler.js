#!/usr/bin/env node
/**
 * styler.js — apply design tokens to a Shesha form tree.
 *
 * Walks the rendered form, determines each component's *role* (input, button,
 * section heading, page chrome, etc.), and writes a complete desktop/tablet/mobile
 * style block consistent with `assets/design-tokens.json`.
 *
 * Why a single styler instead of per-template inline styling:
 *   - Restyle the entire output by editing ONE file (design-tokens.json).
 *   - Templates stay structural, easy to read.
 *   - No drift between auth-login / dashboard / details / table / create.
 *
 * Public API:
 *   const { style, loadTokens, resolveTokens } = require('./styler.js');
 *   style(form, tokens);   // mutates form in place
 *
 * Role detection (priority order):
 *   1. node.__role            (explicit hint from caller)
 *   2. node.type==='button'   -> 'button-primary' | 'button-secondary' | 'button-ghost' | 'button-danger'
 *   3. node.type==='card'     -> 'card'
 *   4. INPUT_TYPES.has(type)  -> 'input'
 *   5. node.type==='text'     -> 'heading-1' | 'heading-2' | 'subtitle' | 'body'
 *   6. node.type==='sectionSeparator' -> 'sectionHeading'
 *   7. node.type==='validationErrors' -> 'validationErrors'
 *   8. node.type==='tabs'     -> 'tabs'
 *   9. node.type==='keyInformationBar' -> 'keyInfoBar'
 *  10. node.type==='datatable' -> 'table'
 *  11. node.className==='sha-page' -> 'page'
 *  12. node.className==='sha-page-title' -> 'pageTitle'
 *  13. node.className==='sha-page-content' -> 'pageContent'
 *  14. Default container -> 'container'
 *
 * Strips the node.__role hint after applying.
 */

const fs = require('fs');
const path = require('path');

const INPUT_TYPES = new Set([
  'textField', 'textArea', 'numberField', 'dateField', 'timePicker',
  'dropdown', 'radio', 'checkbox', 'checkboxGroup', 'switch', 'rate', 'slider',
  'autocomplete', 'entityPicker', 'colorPicker', 'richTextEditor', 'fileUpload', 'address'
]);

// ---------------- token resolver ----------------

function loadTokens(tokensPath) {
  const p = tokensPath || path.join(__dirname, '..', 'assets', 'design-tokens.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return resolveTokens(raw);
}

// Resolve `{path.to.token}` references recursively until fixed point.
function resolveTokens(obj) {
  const root = obj;
  function lookup(refPath) {
    const parts = refPath.split('.');
    let cur = root;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return undefined;
    }
    return cur;
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const out = {};
    for (const k of Object.keys(node)) {
      let v = node[k];
      if (typeof v === 'string') {
        // Single-token wrapper: "{token.path}" -> raw value (may be object)
        const m = /^\{([\w.]+)\}$/.exec(v.trim());
        if (m) {
          const ref = lookup(m[1]);
          v = ref === undefined ? v : ref;
        } else {
          // Embedded refs: "1px solid {color.border}" -> string substitution
          v = v.replace(/\{([\w.]+)\}/g, (whole, p) => {
            const ref = lookup(p);
            return ref === undefined ? whole : String(ref);
          });
        }
      }
      out[k] = walk(v);
    }
    return out;
  }
  // Two passes — handles tokens referencing other tokens
  return walk(walk(obj));
}

// ---------------- style fragment builders ----------------

function noBorder() {
  return {
    hideBorder: true,
    radiusType: 'all',
    borderType: 'all',
    border: { all: { width: '0px', style: 'none', color: 'transparent' }, top: {}, bottom: {}, left: {}, right: {} },
    radius: { all: 0 }
  };
}
function borderObj(width, color, radius) {
  return {
    hideBorder: false,
    radiusType: 'all',
    borderType: 'all',
    border: {
      all: { width: `${width}px`, style: 'solid', color },
      top: {}, bottom: {}, left: {}, right: {}
    },
    radius: { all: radius }
  };
}
function bgColor(color) {
  return {
    type: 'color',
    color: color || 'transparent',
    repeat: 'no-repeat',
    size: 'auto',
    position: 'center',
    gradient: { direction: 'to right', colors: {} },
    url: '',
    storedFile: { id: null },
    uploadFile: null
  };
}
function fontObj({ family, color, size, weight, align } = {}) {
  return {
    type: family,
    color,
    align: align || 'left',
    size,
    weight
  };
}
function noShadow() {
  return { offsetX: 0, offsetY: 0, color: '#00000000', blurRadius: 0, spreadRadius: 0 };
}
function shadowFromToken(s) {
  if (!s || typeof s !== 'object') return noShadow();
  return {
    offsetX: s.offsetX || 0,
    offsetY: s.offsetY || 0,
    color: s.color || '#00000000',
    blurRadius: s.blurRadius || 0,
    spreadRadius: s.spreadRadius || 0
  };
}
function dimensions({ width, height, minWidth, minHeight, maxWidth, maxHeight } = {}) {
  return {
    width:     width     || 'auto',
    height:    height    || 'auto',
    minWidth:  minWidth  || '0px',
    minHeight: minHeight || '0px',
    maxWidth:  maxWidth  || '100%',
    maxHeight: maxHeight || 'auto'
  };
}
function stylingBoxStr(obj) { return JSON.stringify(obj || {}); }

// ---------------- role styles ----------------

function buildRoleStyles(role, node, t) {
  const fam = t.typography.fontFamily;
  switch (role) {

    case 'page':
      return {
        background: bgColor(t.color.background),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%', minHeight: '100vh', maxWidth: 'none' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({
          paddingTop: t.component.page.paddingY,
          paddingBottom: t.component.page.paddingY,
          paddingLeft: t.component.page.paddingX,
          paddingRight: t.component.page.paddingX
        }),
        gap: t.component.page.gap,
        direction: 'vertical',
        flexWrap: 'nowrap'
      };

    case 'pageTitle':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ marginBottom: t.spacing.lg })
      };

    case 'pageHeading':
      // Header band: title row + KeyInfoBar row, or the toolbar row. Restrained padding-bottom only.
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ paddingTop: t.spacing.sm, paddingBottom: t.spacing.sm, marginBottom: t.spacing.sm })
      };

    case 'tableControl':
      // sha-index-table-control row
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ paddingTop: t.spacing.sm, paddingBottom: t.spacing.sm, marginBottom: t.spacing.sm }),
        gap: t.spacing.sm,
        direction: 'horizontal',
        flexWrap: 'wrap'
      };

    case 'tableControlSide':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: 'auto' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({}),
        gap: t.spacing.xs,
        direction: 'horizontal',
        alignItems: 'center'
      };

    case 'collapsiblePanel':
      return {
        background: bgColor(t.color.background),
        border:     borderObj(1, t.color.border, t.radius.xl),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     shadowFromToken(t.shadow.sm),
        stylingBox: stylingBoxStr({ paddingTop: t.spacing.xs, paddingBottom: t.spacing.xs, marginBottom: t.spacing.lg })
      };

    case 'buttonGroup':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({}),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({}),
        gap: t.spacing.xs,
        direction: 'horizontal'
      };

    case 'pageContent':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({}),
        gap: t.spacing.lg,
        direction: 'vertical'
      };

    case 'heading-1':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size['3xl'], weight: t.typography.weight.semibold }),
        dimensions: dimensions({}),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ marginBottom: t.spacing.xs })
      };

    case 'heading-2':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size['2xl'], weight: t.typography.weight.semibold }),
        dimensions: dimensions({}),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ marginBottom: t.spacing.sm })
      };

    case 'subtitle':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.textMuted, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({}),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({})
      };

    case 'body':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({}),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({})
      };

    case 'sectionHeading':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.lg, weight: t.typography.weight.semibold }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ marginTop: t.spacing.xl, marginBottom: t.spacing.md, paddingBottom: t.spacing.sm })
      };

    case 'card':
      return {
        background: bgColor(t.color.background),
        border:     borderObj(1, t.color.border, t.radius.xl),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     shadowFromToken(t.shadow.sm),
        stylingBox: stylingBoxStr({
          paddingTop: t.component.card.padding,
          paddingBottom: t.component.card.padding,
          paddingLeft: t.component.card.padding,
          paddingRight: t.component.card.padding
        })
      };

    case 'input':
      return {
        background: bgColor(t.color.background),
        border:     borderObj(1, t.color.borderStrong, t.radius.md),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%', height: `${t.component.input.height}px`, minHeight: `${t.component.input.height}px` }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({})
      };

    case 'button-primary':
      return {
        background: bgColor(t.color.accent),
        border:     borderObj(1, t.color.accent, t.radius.md),
        font:       fontObj({ family: fam, color: t.color.textOnAccent, size: t.typography.size.base, weight: t.typography.weight.medium, align: 'center' }),
        dimensions: dimensions({ height: `${t.component.button.primary.height}px`, minHeight: `${t.component.button.primary.height}px` }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ paddingLeft: t.component.button.primary.paddingX, paddingRight: t.component.button.primary.paddingX })
      };

    case 'button-secondary':
      return {
        background: bgColor(t.color.background),
        border:     borderObj(1, t.color.borderStrong, t.radius.md),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.medium, align: 'center' }),
        dimensions: dimensions({ height: `${t.component.button.secondary.height}px`, minHeight: `${t.component.button.secondary.height}px` }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ paddingLeft: t.component.button.secondary.paddingX, paddingRight: t.component.button.secondary.paddingX })
      };

    case 'button-ghost':
      return {
        background: bgColor('transparent'),
        border:     borderObj(1, 'transparent', t.radius.md),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.medium, align: 'center' }),
        dimensions: dimensions({ height: `${t.component.button.ghost.height}px`, minHeight: `${t.component.button.ghost.height}px` }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ paddingLeft: t.component.button.ghost.paddingX, paddingRight: t.component.button.ghost.paddingX })
      };

    case 'button-danger':
      return {
        background: bgColor(t.color.background),
        border:     borderObj(1, t.color.danger, t.radius.md),
        font:       fontObj({ family: fam, color: t.color.danger, size: t.typography.size.base, weight: t.typography.weight.medium, align: 'center' }),
        dimensions: dimensions({ height: '40px', minHeight: '40px' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ paddingLeft: 16, paddingRight: 16 })
      };

    case 'tabs':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.medium }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ marginBottom: t.spacing.lg })
      };

    case 'keyInfoBar':
      return {
        background: bgColor(t.component.keyInfoBar.background),
        border:     borderObj(1, t.color.border, t.radius.lg),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({
          paddingTop: t.component.keyInfoBar.paddingY,
          paddingBottom: t.component.keyInfoBar.paddingY,
          paddingLeft: t.component.keyInfoBar.paddingX,
          paddingRight: t.component.keyInfoBar.paddingX,
          marginBottom: t.spacing.lg
        }),
        gap: t.component.keyInfoBar.gap
      };

    case 'validationErrors':
      return {
        background: bgColor(t.component.validationErrors.background),
        border:     borderObj(1, '#FECACA', t.radius.md),
        font:       fontObj({ family: fam, color: t.color.danger, size: t.typography.size.sm, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({
          paddingTop: t.component.validationErrors.padding,
          paddingBottom: t.component.validationErrors.padding,
          paddingLeft: t.component.validationErrors.padding,
          paddingRight: t.component.validationErrors.padding,
          marginBottom: t.spacing.md
        })
      };

    case 'table':
      return {
        background: bgColor(t.color.background),
        border:     borderObj(1, t.color.border, t.radius.lg),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     shadowFromToken(t.shadow.sm),
        stylingBox: stylingBoxStr({})
      };

    case 'toolbar':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({ marginBottom: t.spacing.md }),
        gap: t.spacing.sm,
        direction: 'horizontal',
        flexWrap: 'wrap'
      };

    case 'columnsRow':
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({})
      };

    case 'container':
    default:
      return {
        background: bgColor('transparent'),
        border:     noBorder(),
        font:       fontObj({ family: fam, color: t.color.text, size: t.typography.size.base, weight: t.typography.weight.regular }),
        dimensions: dimensions({ width: '100%' }),
        shadow:     noShadow(),
        stylingBox: stylingBoxStr({}),
        gap: t.spacing.md,
        direction: 'vertical'
      };
  }
}

function responsiveOverride(baseStyle, role, t, breakpoint) {
  const out = { ...baseStyle };
  const r = (t.responsive && t.responsive[breakpoint]) || {};
  if (role === 'page') {
    const pad = (r.page && (r.page.paddingX !== undefined ? r.page.paddingX : t.component.page.paddingX));
    const padY = (r.page && (r.page.paddingY !== undefined ? r.page.paddingY : t.component.page.paddingY));
    out.stylingBox = stylingBoxStr({ paddingTop: padY, paddingBottom: padY, paddingLeft: pad, paddingRight: pad });
  } else if (role === 'pageTitle' && r.pageTitle && r.pageTitle.fontSize) {
    out.font = { ...out.font, size: r.pageTitle.fontSize };
  } else if (role === 'heading-1' && r.pageTitle && r.pageTitle.fontSize) {
    out.font = { ...out.font, size: r.pageTitle.fontSize };
  }
  return out;
}

// ---------------- role detection ----------------

function detectRole(node) {
  if (node.__role) return node.__role;
  const t = node.type;
  if (t === 'card') return 'card';
  if (t === 'button') {
    const bt = (node.buttonType || '').toLowerCase();
    if (bt === 'primary') return 'button-primary';
    if (bt === 'danger' || bt === 'destructive') return 'button-danger';
    if (bt === 'link' || bt === 'ghost' || bt === 'text') return 'button-ghost';
    // Secondary by default unless an icon-only refresh-style button -> ghost
    if (node.icon && !node.label && !node.children) return 'button-ghost';
    return 'button-secondary';
  }
  if (INPUT_TYPES.has(t)) return 'input';
  if (t === 'text') {
    const lvl = node.level;
    if (lvl === 1) return 'heading-1';
    if (lvl === 2) return 'heading-2';
    const sz = node.font && node.font.size;
    if (typeof sz === 'number' && sz >= 20) return 'heading-1';
    if (node.componentName === 'subtitle' || /subtitle|sub$/i.test(node.propertyName || '')) return 'subtitle';
    return 'body';
  }
  if (t === 'sectionSeparator') return 'sectionHeading';
  if (t === 'validationErrors') return 'validationErrors';
  if (t === 'tabs') return 'tabs';
  if (t === 'keyInformationBar' || t === 'KeyInformationBar') return 'keyInfoBar';
  if (t === 'datatable') return 'table';
  if (t === 'columns') return 'columnsRow';
  if (t === 'container') {
    const cls = node.className || '';
    if (cls === 'sha-page' || cls === 'sha-index-table-full') return 'page';
    if (cls === 'sha-page-title') return 'pageTitle';
    if (cls === 'sha-page-heading') return 'pageHeading';
    if (cls === 'sha-page-content') return 'pageContent';
    if (cls === 'sha-index-table-control') return 'tableControl';
    if (cls === 'index-table-controls-left' || cls === 'index-table-controls-right') return 'tableControlSide';
    if (cls === 'sha-index-toolbar') return 'toolbar';
    if (/toolbar/i.test(node.componentName || '') || cls.includes('toolbar')) return 'toolbar';
    return 'container';
  }
  if (t === 'collapsiblePanel') return 'collapsiblePanel';
  if (t === 'buttonGroup') return 'buttonGroup';
  if (t === 'dataContext' || t === 'datatableContext') return null; // wrappers, no styling
  return null;
}

// ---------------- main walker ----------------

function style(form, tokens) {
  if (!tokens) tokens = loadTokens();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const role = detectRole(node);
    if (role) {
      const desktop = buildRoleStyles(role, node, tokens);
      const tablet  = responsiveOverride(desktop, role, tokens, 'tablet');
      const mobile  = responsiveOverride(desktop, role, tokens, 'mobile');
      node.desktop = { ...(node.desktop || {}), ...desktop };
      node.tablet  = { ...(node.tablet  || {}), ...tablet };
      node.mobile  = { ...(node.mobile  || {}), ...mobile };
      // Mirror critical flat-keys (legacy renderers read these)
      node.stylingBox = desktop.stylingBox;
      node.font = desktop.font;
      node.dimensions = desktop.dimensions;
      node.border = desktop.border;
      node.background = desktop.background;
      node.shadow = desktop.shadow;
      delete node.__role;
    }
    for (const k of ['components', 'tabs', 'columns', 'items']) {
      if (Array.isArray(node[k])) walk(node[k]);
    }
    if (node.header) walk(node.header);
    if (node.content) walk(node.content);
    if (Array.isArray(node.columns)) node.columns.forEach(col => col.components && walk(col.components));
  }
  walk(form.components);
  return form;
}

module.exports = { style, loadTokens, resolveTokens, detectRole, INPUT_TYPES };

if (require.main === module) {
  const tokens = loadTokens();
  console.log('Tokens loaded. Sample resolved values:');
  console.log('  color.accent           =', tokens.color.accent);
  console.log('  spacing.lg             =', tokens.spacing.lg);
  console.log('  component.input.height =', tokens.component.input.height);
  console.log('  shadow.sm              =', JSON.stringify(tokens.shadow.sm));
}
