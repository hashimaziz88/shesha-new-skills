#!/usr/bin/env node
/**
 * layout-polish.js — group + pair + highlight.
 *
 * Takes a flat list of input components (output of scaffold.js's pickFields ->
 * enrich), returns a structured component list with:
 *
 *   - sectionSeparator headers between semantic groups (Personal / Contact / Address / Other)
 *   - adjacent "short" fields paired into 12+12 columns rows
 *   - top 1-3 high-signal props extracted for an inferred KeyInformationBar
 *     (returned separately; the caller decides whether to use it)
 *
 * Public API:
 *   const polish = require('./layout-polish.js');
 *   const { sections, keyInfoItems } = polish.organize(components, { newGuid, parentId, withKeyInfoBar: true });
 *
 *   - `sections` is an array of components ready to splice into the fields slot
 *   - `keyInfoItems` is an array of {propertyName, label, dataType, type} — empty if none
 *
 * Pure function — does not mutate the inputs.
 */

// Section taxonomy. First match wins; "other" is the catch-all.
const SECTIONS = [
  {
    key: 'identity',
    title: 'Identity',
    match: /^(firstName|lastName|middleName|fullName|displayName|preferredName|givenName|familyName|surname|maidenName|title|salutation|gender|dateOfBirth|nationality|idNumber|passportNumber|taxNumber|ref|reference|code|number)$/i
  },
  {
    key: 'contact',
    title: 'Contact',
    match: /(email|mail|phone|mobile|cell|tel|fax|url|website|homepage|social)/i
  },
  {
    key: 'address',
    title: 'Address',
    match: /(address|street|city|town|locality|postalCode|postCode|zipCode|zip|state|province|country|region)/i
  },
  {
    key: 'employment',
    title: 'Employment',
    match: /(jobTitle|role|position|department|company|employer|organisation|organization|industry|occupation|hireDate|startDate|endDate|salary|wage|payment)/i
  },
  {
    key: 'preferences',
    title: 'Preferences',
    match: /(language|locale|timezone|currency|notification|subscription|preference|setting|consent|optIn|optOut)/i
  },
  {
    key: 'details',
    title: 'Details',
    match: /(description|notes|comments|bio|summary|details|remarks|message|reason|justification|background)/i
  }
];

// Types considered "short" and therefore eligible to pair into a 2-column row.
const SHORT_TYPES = new Set([
  'textField', 'numberField', 'dateField', 'timePicker',
  'dropdown', 'switch', 'checkbox', 'rate'
]);

// Heuristic: which props should bubble up to a KeyInformationBar?
// Priority order — first match wins; max 3.
const KEY_INFO_CANDIDATES = [
  /^status$/i,
  /^(ref|reference|referenceNumber|code|memberNumber|customerNumber)$/i,
  /^(tier|level|grade|rank|priority)$/i,
  /^(amount|balance|total)$/i,
  /^(createdOn|creationTime|registeredOn|joinedOn)$/i
];

function sectionFor(propName) {
  for (const s of SECTIONS) if (s.match.test(propName)) return s.key;
  return 'other';
}

function isShort(component) {
  return SHORT_TYPES.has(component.type) && !component.autoSize;
}

function organize(components, opts) {
  const { newGuid, parentId, withKeyInfoBar = false, withSections = true } = opts || {};
  if (!Array.isArray(components) || !components.length) {
    return { sections: [], keyInfoItems: [] };
  }
  if (typeof newGuid !== 'function') {
    throw new Error('layout-polish: opts.newGuid is required (factory for new component ids)');
  }

  // 1) Optionally extract KeyInformationBar candidates (don't remove from sections —
  //    a property can render in both places).
  const keyInfoItems = withKeyInfoBar ? extractKeyInfoItems(components) : [];

  // 2) Cluster by section
  const buckets = {};
  for (const c of components) {
    const key = withSections ? sectionFor(c.propertyName || '') : 'fields';
    (buckets[key] = buckets[key] || []).push(c);
  }

  // 3) Emit in section order; pair short adjacent fields into columns rows
  const out = [];
  const order = withSections
    ? ['identity', 'contact', 'address', 'employment', 'preferences', 'details', 'other']
    : ['fields'];

  for (const key of order) {
    const bucket = buckets[key];
    if (!bucket || !bucket.length) continue;

    if (withSections && bucket !== buckets.fields) {
      const sec = SECTIONS.find(s => s.key === key);
      const title = sec ? sec.title : 'Other';
      out.push({
        id: newGuid(),
        type: 'sectionSeparator',
        propertyName: 'section' + cap(key),
        componentName: 'section' + cap(key),
        parentId,
        label: title
      });
    }

    // Re-parent bucket children and pair adjacent shorts
    let i = 0;
    while (i < bucket.length) {
      const cur = bucket[i];
      const next = bucket[i + 1];
      cur.parentId = parentId;

      const pairable = next && isShort(cur) && isShort(next);
      if (pairable) {
        const rowId = newGuid();
        const colAId = newGuid();
        const colBId = newGuid();
        cur.parentId = colAId;
        next.parentId = colBId;
        out.push({
          id: rowId,
          type: 'columns',
          propertyName: 'row' + (out.length + 1),
          componentName: 'row' + (out.length + 1),
          parentId,
          label: ' ',
          hideLabel: true,
          gutterX: 16,
          gutterY: 0,
          columns: [
            { id: colAId, flex: 12, offset: 0, push: 0, pull: 0, components: [cur] },
            { id: colBId, flex: 12, offset: 0, push: 0, pull: 0, components: [next] }
          ]
        });
        i += 2;
      } else {
        out.push(cur);
        i += 1;
      }
    }
  }

  return { sections: out, keyInfoItems };
}

function extractKeyInfoItems(components) {
  const items = [];
  for (const pattern of KEY_INFO_CANDIDATES) {
    if (items.length >= 3) break;
    const hit = components.find(c => pattern.test(c.propertyName || ''));
    if (hit && !items.find(x => x.propertyName === hit.propertyName)) {
      items.push({
        propertyName: hit.propertyName,
        label: hit.label,
        type: hit.type
      });
    }
  }
  return items;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

module.exports = { organize, extractKeyInfoItems, sectionFor };

if (require.main === module) {
  // CLI demo
  const crypto = require('crypto');
  const guid = () => crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 22);
  const sample = [
    { type: 'textField', propertyName: 'firstName', label: 'First Name' },
    { type: 'textField', propertyName: 'lastName', label: 'Last Name' },
    { type: 'dateField', propertyName: 'dateOfBirth', label: 'DOB' },
    { type: 'textField', propertyName: 'emailAddress1', label: 'Email' },
    { type: 'textField', propertyName: 'mobileNumber', label: 'Mobile' },
    { type: 'textField', propertyName: 'addressLine1', label: 'Address' },
    { type: 'textField', propertyName: 'city', label: 'City' },
    { type: 'textField', propertyName: 'postalCode', label: 'Postal Code' },
    { type: 'textArea', propertyName: 'description', label: 'About', autoSize: { minRows: 3 } },
    { type: 'dropdown', propertyName: 'status', label: 'Status' }
  ];
  const r = organize(sample, { newGuid: guid, parentId: 'root', withKeyInfoBar: true });
  console.log('Sections:', r.sections.length);
  r.sections.forEach(s => console.log(' -', s.type, s.label || s.propertyName));
  console.log('KeyInfoBar:', r.keyInfoItems);
}
