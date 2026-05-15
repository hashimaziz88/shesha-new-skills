# subForm — embedding another form configuration

A `subForm` component renders another form inline. Use for **subordinate data conceptually part of the same record** (address, contact, verification result, KYC details). For peer relationships managed via their own UI, prefer a child table or a Show Dialog action.

---

## Canonical shape

```json
{
  "id": "...",
  "type": "subForm",
  "propertyName": "address",
  "componentName": "addressSubForm",
  "label": "Address",
  "hideLabel": true,
  "editMode": "editable",
  "formId": { "name": "address-edit", "module": "Shesha" },
  "formSelectionMode": "name",
  "dataSource": "api",
  "apiMode": "entityName",
  "entityType": "Shesha.Domain.Address",
  "labelCol": 6,
  "wrapperCol": 18,
  "queryParams": "    return { id: data.address?.id };"
}
```

---

## Rules

1. **`formId` is an object** — `{ name, module }`. Never a Guid; never a flat string. [standards.md](../standards.md) enforces this.
2. **Capital F** in `subForm`. Aliases like `Subform` exist in some XML imports but the JSON `type` should be `subForm`.
3. **`formSelectionMode: "name"`** is the only common mode in modern Shesha. Selection by id (`"formId"`) is legacy.
4. **`queryParams` autogen** — when `propertyName` is set and `queryParams` isn't, default to:
   ```
       return { id: data.{propertyName}.id };
   ```
   This wires the sub-form to load the record whose foreign key lives at `data.<propertyName>.id`. The MCP injects this automatically; the skill should do the same when authoring.
5. **`labelCol` / `wrapperCol`** — sub-forms usually want the full row width because their own form has its own grid. `labelCol: 6, wrapperCol: 18` is the MCP default.
6. **`hideLabel: true`** — the inner form has its own headings. Showing the outer label duplicates.
7. **`editMode`** — propagate the parent form's mode. `"editable"` lets the user edit when the parent is in edit mode; `"inherited"` defers to the parent.

---

## API modes

| `apiMode` | When |
|---|---|
| `entityName` | The sub-form is bound to an entity (most common). Specify `entityType`. |
| `url` | Custom endpoint. Specify `getUrl`, `postUrl`, etc. |

---

## subForm vs subForm-with-Dialog vs child table

| Need | Component |
|---|---|
| Inline edit, single related record | `subForm` |
| Open a related record's full UI in a popup | Button with `Show Dialog` action |
| List many child records with their own CRUD | `dataTableContext` + `dataTable` (or `dataList`) — see [data-tables.md](data-tables.md) |

---

## Common bugs

- **`formId` as a string** (`"address-edit"`) — silently fails to resolve. Fix: wrap in `{ name, module }`.
- **`queryParams` missing** — sub-form loads with no id, creates a new blank record. Fix: add the default `return { id: data.<propertyName>.id }`.
- **`entityType` mismatch with the referenced form's `modelType`** — runtime error when posting back. Fix: keep them in sync.
- **Recursion** — sub-form whose `formId` points back to the parent form's name. Crashes browser. Always check.

---

## Worked example: Member details with embedded Address sub-form

```json
{
  "id": "addr-subform-uuid",
  "type": "subForm",
  "propertyName": "primaryAddress",
  "componentName": "primaryAddressSubForm",
  "label": "Primary address",
  "hideLabel": false,
  "editMode": "inherited",
  "formId": { "name": "address-edit", "module": "Shesha" },
  "formSelectionMode": "name",
  "dataSource": "api",
  "apiMode": "entityName",
  "entityType": "Shesha.Domain.Address",
  "queryParams": "    return { id: data.primaryAddress?.id };"
}
```
