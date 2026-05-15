# Entity-bound selectors — autocomplete, entityPicker

Both bind to entity types. Both require `editMode: "editable"`.

---

## autocomplete

Async lookup, type-ahead. Bind to entity, set `entityType`, optional `displayPropertyName`:

```json
{
  "id": "...",
  "type": "autocomplete",
  "propertyName": "subscription",
  "label": "Subscription",
  "entityType": "PBF.MembershipManagement.Domain.Domain.Subscription",
  "displayPropertyName": "_displayName",
  "filter": "...",
  "editMode": "editable"
}
```

For URL-based autocomplete (custom endpoint instead of entity CRUD): set `dataSourceType: "url"` and provide `dataSourceUrl`.

---

## entityPicker

Modal-based entity picker with full search. Heavier than `autocomplete` but supports filtering by columns:

```json
{
  "id": "...",
  "type": "entityPicker",
  "propertyName": "tier",
  "entityType": "PBF.MembershipManagement.Domain.Domain.Tier",
  "displayEntityKey": "name",
  "modalTitle": "Select Tier",
  "items": [ /* table columns config */ ],
  "editMode": "editable"
}
```

---

## When to use which

| Use | When |
|---|---|
| `autocomplete` | Small-to-medium pick lists, type-ahead is enough, no need to see other columns |
| `entityPicker` | Big lists, user needs to see multiple columns to choose, filtering by non-display fields |
| `dropdown` (refList) | Fixed reference list, not an entity (see [dropdowns.md](dropdowns.md)) |

---

## autocomplete — additional knobs

| Field | Values | Notes |
|---|---|---|
| `mode` | `"single" \| "multiple"` | Multi-select returns an array of entity refs |
| `dataSourceType` | `"entitiesList" \| "url"` | Default `"entitiesList"` (bind via `entityType`) |
| `valueFormat` | `"simple" \| "entityReference"` | `"simple"` returns the id; `"entityReference"` returns `{ id, _displayName, _className }` — needed for entity-typed entity properties |
| `displayPropertyName` | string | Property of the target entity to show. Default `_displayName` (Shesha's computed). |
| `filter` | JsonLogic expression | E.g. `{ "==": [{ "var": "isActive" }, true] }`. Applied to the lookup endpoint. |
| `placeholder` | string | Search box hint |
| `getOptionsUrl` (when `dataSourceType: "url"`) | string | Custom endpoint returning `[{ id, label }]` |

---

## entityPicker.items (column shape)

`entityPicker` displays a modal with a table — `items` declares its columns:

```json
"items": [
  {
    "id": "...",
    "itemType": "item",
    "columnType": "data",
    "propertyName": "name",
    "caption": "Name",
    "isVisible": true,
    "sortOrder": 0
  },
  {
    "id": "...",
    "itemType": "item",
    "columnType": "data",
    "propertyName": "code",
    "caption": "Code",
    "isVisible": true,
    "sortOrder": 1
  }
]
```

Each column is a `{ id, itemType: "item", columnType: "data"|"action", propertyName, caption, isVisible, sortOrder, ...  }` record. For an action column on a picker (rare), shape mirrors `dataTable` action columns — see [data-tables.md](data-tables.md).

`displayEntityKey` is the entity property name that fills the field once the user picks a row (e.g. `"name"` shows the tier's name in the textbox after selection). Defaults to `_displayName`.

---

## Filter expressions (JsonLogic)

Both `autocomplete.filter` and `entityPicker.filter` accept JsonLogic. Common shapes:

```json
{ "and": [
  { "==": [{ "var": "isActive" }, true] },
  { "==": [{ "var": "module.name" }, "PBF.MembershipManagement"] }
] }
```

Supported ops: `==`, `!=`, `<`, `>`, `<=`, `>=`, `and`, `or`, `not`, `in`, `startsWith`, `endsWith`, `like`. For dynamic filters that reference form data, use IPropertySetting `_mode: "code"` with `_code` returning the filter object.

---

## Bugs

- **Empty results, no error** → `entityType` typo (wrong namespace) or `filter` syntax error. Verify via `EntityConfig/GetAll`.
- **Picks a row but value doesn't save** → `valueFormat` is `"simple"` but the entity property expects an `entityReference`. Switch to `"entityReference"`.
- **`displayPropertyName` shows blank** → the named property doesn't exist on the entity, or is null on the selected row. Fall back to `_displayName`.
