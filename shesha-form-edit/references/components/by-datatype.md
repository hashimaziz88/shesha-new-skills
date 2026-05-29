# Component selection by property data type

Pick the input component from the entity property's `dataType` (from `Metadata/GetProperties`). This mirrors the canonical `employee-create` example exactly.

| Property `dataType` | Component `type` | Required config |
|---|---|---|
| `string` (short) | `textField` | `propertyName`, `editMode: "inherited"` |
| `string` (long/multiline) | `textArea` | `propertyName`, `editMode: "inherited"` |
| `number` | `numberField` | `propertyName`, `editMode: "inherited"` |
| `boolean` | `checkbox` (or `switch`) | `propertyName`, `editMode: "inherited"` |
| `date` | `dateField` | `propertyName`, `editMode: "inherited"` |
| `date-time` | `dateField` | `propertyName`, `showTime: true` |
| `reference-list-item` | `dropdown` | `dataSourceType: "referenceList"`, `referenceListId: { module, name }`, `referenceListName: "<Module>.<List>"`, `valueFormat: "simple"`, `mode: "single"` |
| `entity` (FK) | `autocomplete` | `dataSourceType: "entitiesList"`, `entityType: { name: "<ShortClass>", module: "<Module>" }`, `valueFormat: "entityReference"`, `mode: "single"`, `useRawValues: false` |
| `file` | `fileUpload` | `propertyName` |

## Reference-list dropdown (from `employee-create` → `employmentType`, `status`)

```json
{
  "type": "dropdown",
  "propertyName": "status",
  "label": "Status",
  "editMode": "inherited",
  "dataSourceType": "referenceList",
  "referenceListId": { "module": "A.Test", "name": "A.Test.EmployeeStatus" },
  "referenceListName": "A.Test.EmployeeStatus",
  "valueFormat": "simple",
  "mode": "single"
}
```

Find the reference-list name from the property metadata: `referenceListName` + `referenceListModule` on the property. `referenceListId.name` is the **fully-qualified** list name (`<Module>.<ListName>`).

## FK autocomplete (from `employee-create` → `payGrade`)

```json
{
  "type": "autocomplete",
  "propertyName": "payGrade",
  "label": "Pay Grade",
  "editMode": "inherited",
  "dataSourceType": "entitiesList",
  "entityType": { "name": "PayGrade", "module": "A.Test" },
  "valueFormat": "entityReference",
  "mode": "single",
  "useRawValues": false
}
```

`entityType` here is an **object** `{ name: "<ShortClassName>", module }` — the short class name, NOT the full namespace. Get the FK target from the property metadata's `entityType` field.

> A bare `autocomplete`/`entityPicker` with no `entityType` renders an empty box. A `dropdown` without `dataSourceType` renders no options. Always set the data-source config.

> **When you copy a dropdown/autocomplete from a seed, you MUST override its data-source for the new field.** A copied dropdown keeps the seed's `referenceListId`/`referenceListName` (e.g. it'll still point at `EmploymentType`), and a copied autocomplete keeps the seed's `entityType`. Always replace `referenceListId`+`referenceListName` (dropdown) or `entityType` (autocomplete) with the new field's own values — verified: forgetting this makes the field show the wrong list's options.
