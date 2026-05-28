#!/usr/bin/env node
/**
 * enrich.js — UX heuristics layer.
 *
 * Given (metadata property, raw component fragment), augments the component with
 * smart defaults driven by propertyName patterns + dataType. Keeps the user-supplied
 * shape; only adds polish props the framework would otherwise leave bare.
 *
 * Heuristics are conservative: when in doubt, add nothing rather than guess wrong.
 *
 * Categories detected (by lowercased propertyName regex):
 *   - email           -> textField type=email, prefixIcon=MailOutlined, placeholder, email validation
 *   - phone/mobile    -> textField type=tel, prefixIcon=PhoneOutlined, placeholder
 *   - url/website     -> textField type=url, prefixIcon=LinkOutlined, placeholder
 *   - password        -> textField type=password, prefixIcon=LockOutlined
 *   - currency/amount/price (numeric) -> numberField prefix=$, step=0.01, precision=2
 *   - percent/percentage (numeric)    -> numberField suffix=%, min=0, max=100
 *   - count/quantity  -> numberField, integer step
 *   - description/notes/bio/comments (long string) -> textArea autoSize
 *   - address (string, not entity FK) -> textField with HomeOutlined
 *   - firstName/lastName/middleName/fullName -> textField with UserOutlined
 *   - dateOfBirth / *Date             -> dateField, friendly format
 *   - search/query    -> textField prefix=SearchOutlined
 *
 * Public API:
 *   const enrich = require('./enrich.js');
 *   enrich(metadataProp, baseComponent, tokens)
 *     -> augmented component (new object; does not mutate base)
 *
 * Tokens are optional — if provided, used for placeholder colors etc.
 */

const RULES = [
  // ----- emails -----
  {
    test: (p) => /(email|mail)/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({
      ...c,
      type: 'textField',
      textType: 'email',
      prefixIcon: 'MailOutlined',
      placeholder: 'e.g. name@example.com',
      validate: mergeValidate(c.validate, {
        regExp: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        validationMessage: 'Enter a valid email address.'
      }),
      autoComplete: 'email'
    })
  },

  // ----- phones / mobile -----
  {
    test: (p) => /(phone|mobile|cell|tel)/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({
      ...c,
      type: 'textField',
      textType: 'tel',
      prefixIcon: 'PhoneOutlined',
      placeholder: '+27 81 234 5678',
      autoComplete: 'tel'
    })
  },

  // ----- urls / websites -----
  {
    test: (p) => /(url|website|homepage|link)/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({
      ...c,
      type: 'textField',
      textType: 'url',
      prefixIcon: 'LinkOutlined',
      placeholder: 'https://example.com',
      autoComplete: 'url'
    })
  },

  // ----- passwords -----
  {
    test: (p) => /password|passcode|pin$/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({
      ...c,
      type: 'textField',
      textType: 'password',
      prefixIcon: 'LockOutlined',
      placeholder: 'Enter your password',
      autoComplete: 'current-password'
    })
  },

  // ----- currency / amount / price -----
  {
    test: (p) => /(amount|price|cost|fee|salary|wage|revenue|total|balance|payment|charge|premium)/i.test(p.name)
              && isNumeric(p.dataType),
    apply: (c) => ({
      ...c,
      type: 'numberField',
      prefix: 'R ',
      stepNumeric: 0.01,
      precision: 2,
      placeholder: '0.00'
    })
  },

  // ----- percentages -----
  {
    test: (p) => /(percent|percentage|rate|ratio|discount)/i.test(p.name)
              && isNumeric(p.dataType),
    apply: (c) => ({
      ...c,
      type: 'numberField',
      suffix: '%',
      min: 0,
      max: 100,
      stepNumeric: 0.1,
      placeholder: '0'
    })
  },

  // ----- counts / quantities -----
  {
    test: (p) => /(count|quantity|qty|number|num|total)/i.test(p.name)
              && isNumeric(p.dataType),
    apply: (c) => ({
      ...c,
      type: 'numberField',
      stepNumeric: 1,
      precision: 0,
      placeholder: '0'
    })
  },

  // ----- long-form text (regex catches most narrative property names) -----
  {
    test: (p) => /(description|notes|comments|bio|summary|details|remarks|message|reason|justification|background|coverLetter|cover_letter|qualifications|workExperience|work_experience|experience|skills|motivation|essay|letter|proposal|abstract|statement|narrative|story|history|content|body|text|paragraph|response|answer|explanation|rationale|objectives|achievements|responsibilities|biography|introduction|conclusion|feedback|review|opinion|thoughts)/i.test(p.name)
              && (p.dataType === 'string' || p.dataType === 'multiline-string' || p.dataType === 'text'),
    apply: (c) => ({
      ...c,
      type: 'textArea',
      autoSize: { minRows: 4, maxRows: 12 },
      placeholder: 'Write here…',
      showCount: true,
      allowClear: true
    })
  },

  // ----- length-driven fallback: maxLength > 250 OR dataType == 'multiline-string' -----
  // Last-resort textArea promotion when the name doesn't match but metadata signals "long".
  {
    test: (p) => (
      (p.dataType === 'multiline-string' || p.dataType === 'text') ||
      (p.dataType === 'string' && typeof p.maxLength === 'number' && p.maxLength > 250) ||
      (p.dataType === 'string' && typeof p.maxLength === 'undefined' && /(.{3,})(Long|Text|Note|Full|Detailed)$/.test(p.name || ''))
    ),
    apply: (c) => ({
      ...c,
      type: 'textArea',
      autoSize: { minRows: 3, maxRows: 8 },
      placeholder: 'Enter text…',
      showCount: true,
      allowClear: true
    })
  },

  // ----- person name fields -----
  {
    test: (p) => /^(firstName|lastName|middleName|fullName|displayName|preferredName|givenName|familyName|surname|maidenName|name)$/i.test(p.name)
              && p.dataType === 'string',
    apply: (c, p) => ({
      ...c,
      type: 'textField',
      prefixIcon: 'UserOutlined',
      placeholder: friendlyPlaceholder(p),
      autoComplete: nameAutoComplete(p.name)
    })
  },

  // ----- street address (string field, not entity FK) -----
  {
    test: (p) => /(addressLine|streetAddress|street|^address$)/i.test(p.name)
              && p.dataType === 'string' && !p.entityType,
    apply: (c) => ({
      ...c,
      type: 'textField',
      prefixIcon: 'HomeOutlined',
      placeholder: '123 Main Street',
      autoComplete: 'street-address'
    })
  },

  // ----- city / town -----
  {
    test: (p) => /^(city|town|locality)$/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({ ...c, type: 'textField', placeholder: 'e.g. Johannesburg', autoComplete: 'address-level2' })
  },

  // ----- postal / zip -----
  {
    test: (p) => /(postalCode|postCode|zipCode|zip)/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({ ...c, type: 'textField', placeholder: '0001', autoComplete: 'postal-code' })
  },

  // ----- country -----
  {
    test: (p) => /^country$/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({ ...c, type: 'textField', placeholder: 'e.g. South Africa', autoComplete: 'country-name' })
  },

  // ----- dates: use friendly format -----
  {
    test: (p) => (p.dataType === 'date' || p.dataType === 'date-time'),
    apply: (c, p) => ({
      ...c,
      type: 'dateField',
      dateFormat: p.dataType === 'date-time' ? 'DD MMM YYYY HH:mm' : 'DD MMM YYYY',
      prefixIcon: 'CalendarOutlined',
      placeholder: p.dataType === 'date-time' ? 'Select date and time' : 'Select date',
      showTime: p.dataType === 'date-time'
    })
  },

  // ----- search / query -----
  {
    test: (p) => /(search|query|keyword)/i.test(p.name) && p.dataType === 'string',
    apply: (c) => ({ ...c, type: 'textField', prefixIcon: 'SearchOutlined', placeholder: 'Search…', allowClear: true })
  },

  // ----- IDs / reference numbers -----
  {
    test: (p) => /(ref|reference|code|number)$/i.test(p.name) && p.dataType === 'string'
              && !/phoneNumber|mobileNumber/i.test(p.name),
    apply: (c) => ({ ...c, type: 'textField', placeholder: 'e.g. ABC-12345' })
  }
];

function enrich(prop, base, tokens = null) {
  for (const rule of RULES) {
    try {
      if (rule.test(prop)) {
        return rule.apply({ ...base }, prop, tokens);
      }
    } catch (_) { /* keep going */ }
  }
  // No specific rule — return base unchanged but with a generic placeholder if absent
  if (!base.placeholder && base.type === 'textField' && prop.dataType === 'string') {
    return { ...base, placeholder: `Enter ${(prop.label || base.label || 'value').toLowerCase()}` };
  }
  return base;
}

// ---- helpers ----

function isNumeric(dt) {
  if (!dt) return false;
  const x = String(dt).toLowerCase();
  return ['number', 'int', 'integer', 'decimal', 'float', 'double', 'long', 'short', 'byte', 'money']
    .includes(x);
}

function mergeValidate(existing, additions) {
  return { ...(existing || {}), ...additions };
}

function friendlyPlaceholder(prop) {
  const name = prop.name || prop.path || '';
  if (/^firstName$/i.test(name))  return 'e.g. Sarah';
  if (/^lastName$/i.test(name))   return 'e.g. van der Merwe';
  if (/^middleName$/i.test(name)) return 'Optional';
  if (/^fullName$/i.test(name))   return 'e.g. Sarah van der Merwe';
  if (/name/i.test(name))         return 'Enter name';
  return 'Enter ' + (prop.label || name).toLowerCase();
}

function nameAutoComplete(propName) {
  if (/firstName|givenName/i.test(propName)) return 'given-name';
  if (/lastName|surname|familyName/i.test(propName)) return 'family-name';
  if (/middleName/i.test(propName)) return 'additional-name';
  if (/fullName|displayName/i.test(propName)) return 'name';
  return 'off';
}

module.exports = enrich;
module.exports.enrich = enrich;

if (require.main === module) {
  // CLI: pipe a metadata property as JSON, get back the enriched component
  const samples = [
    { name: 'emailAddress1', dataType: 'string', label: 'Email' },
    { name: 'firstName', dataType: 'string', label: 'First Name' },
    { name: 'dateOfBirth', dataType: 'date', label: 'Date Of Birth' },
    { name: 'salaryAmount', dataType: 'decimal', label: 'Salary' },
    { name: 'description', dataType: 'string', label: 'Description' },
    { name: 'mobileNumber', dataType: 'string', label: 'Mobile' }
  ];
  for (const p of samples) {
    const base = { type: 'textField', propertyName: p.name, label: p.label, editMode: 'editable' };
    console.log(p.name, '=>', JSON.stringify(enrich(p, base), null, 2).split('\n').join(' '));
  }
}
