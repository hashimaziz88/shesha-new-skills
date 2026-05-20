# dropdown / radio / checkboxGroup / refListStatus

All require `editMode: "editable"` (except `refListStatus`, which is display-only).

---

## dropdown

Two data sources: `'values'` (hardcoded) or `'referenceList'` (Shesha reference list).

### Reference list source

```json
{
  "id": "...",
  "type": "dropdown",
  "propertyName": "accountType",
  "label": "Account Type",
  "dataSourceType": "referenceList",
  "referenceListId": {
    "module": "PBF.MembershipManagement",
    "name": "AccountType"
  },
  "mode": "single",
  "editMode": "editable"
}
```

**`referenceListId` is NOT a Guid** — it's `{ module, name }`. The framework resolves at runtime. A wrong module/name pair = silent empty dropdown.

### Hardcoded values source

Every item must have all three keys (`id`, `label`, `value`):

```json
{
  "id": "...",
  "type": "dropdown",
  "propertyName": "preference",
  "dataSourceType": "values",
  "values": [
    { "id": "1", "label": "Email", "value": "email" },
    { "id": "2", "label": "SMS", "value": "sms" }
  ],
  "editMode": "editable"
}
```

Validation: when `dataSourceType === "values"`, each item in `values` is `{ id, label, value }`. Missing any of the three is a bug — `clean-form-config` flags this.

`mode` is `single` | `multiple` | `tags`.

---

## radio / checkboxGroup

Same `dataSourceType` rules as `dropdown` (above). `radio` is single-select; `checkboxGroup` is multi-select.

---

## refListStatus

Display-only badge for a reference-list-typed property:

```json
{
  "id": "...",
  "type": "refListStatus",
  "propertyName": "status",
  "module": "PBF.MembershipManagement",
  "referenceListName": "ApplicationStatus",
  "showIcon": true
}
```

Note: `refListStatus` uses `module` + `referenceListName` (flat keys), not the `referenceListId: { module, name }` object that `dropdown` uses. Different shape — don't conflate.

No `editMode` needed (display-only).
