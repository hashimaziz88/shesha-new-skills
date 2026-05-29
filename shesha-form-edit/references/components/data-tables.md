# dataTableContext, datatable, datalist

---

## Wrapper rule (non-negotiable)

**`datatable` and `datalist` MUST be wrapped in a `dataTableContext` (or `dataContext`).** Never put them at root with `entityType` / `sourceType` set on the component itself — that pattern technically renders something in some Shesha versions but is wrong and brittle:

- The data-fetching, paging, sorting, and filtering all live on the **context wrapper**, not the table/list. Putting them on the inner component means they don't get re-evaluated when filters or sort change, and external components (toolbar buttons, refresh actions) can't target them by `actionOwner: "<contextId>"`.
- Built-in actions (`Refresh table`, `Export to Excel`, quick-search wiring) all expect to find a `dataTableContext` ancestor. Without it, they silently no-op.
- Sub-form-renderer datalists (`formSelectionMode: "name"` with a row-template form) inherit the row data from the context's current row. Without the context, the row template gets nothing.

Common symptoms of a missing wrapper: "datalist isn't refreshing after I change the filter", "the export button does nothing", "the row template isn't seeing the row data". Walk up the `parentId` chain from the datalist; if there isn't a `dataTableContext` ancestor, that's the bug.

**Only exception**: a datalist with hardcoded `items` (not entity-bound) — e.g. inline help-style display. Even then, prefer the wrapper unless you have a specific reason.

---

## Canonical entity-bound list

```json
{
  "id": "...",
  "type": "dataTableContext",
  "propertyName": "tiersContext",
  "componentName": "tiersContext",
  "sourceType": "Entity",
  "entityType": "PBF.MembershipManagement.Domain.Domain.Tier",
  "defaultPageSize": 25,
  "dataFetchingMode": "paging",
  "sortMode": "standard",
  "strictSortBy": "sortOrder",
  "strictSortOrder": "asc",
  "permanentFilter": { "==": [{"var": "mode"}, {"var": "modeFilter"}] },
  "components": [
    { "id": "...", "type": "datatable.quickSearch" },
    {
      "id": "...",
      "type": "datalist",
      "formSelectionMode": "name",
      "formId": { "module": "PBF.MembershipManagement", "name": "tier-card" },
      "orientation": "wrap",
      "listItemWidth": 0.25
    },
    { "id": "...", "type": "datatable.pager" }
  ]
}
```

The `datalist` here has **no** `entityType`, **no** `sourceType`, **no** `permanentFilter`, **no** `properties` — it inherits them all from the wrapper. Same rule for `datatable`.

---

## URL-bound list (custom endpoint)

```json
{
  "type": "dataTableContext",
  "sourceType": "Url",
  "endpoint": "/api/services/app/EntityHistory/GetAuditTrail?entityId={{data.id}}&entityTypeFullName={{data.modelType}}",
  "defaultPageSize": 10,
  "components": [ /* datatable or datalist */ ]
}
```

---

## Inner components quick reference

| Type | Purpose |
|---|---|
| `datatable` | Column-based grid view. Columns go in `items: []`. Sorting/filter/paging inherited from the wrapper. |
| `datatable.quickSearch` | Search box that targets the wrapper's data |
| `datatable.pager` | Pagination controls |
| `datatable.toolbar` | Toolbar slot (Add / Refresh / Export buttons; their `actionOwner` typically references the wrapper's id) |
| `datalist` | Card / list view. Either `items: []` (inline) or `formSelectionMode: "name"` + `formId: { module, name }` (sub-form row template). Cards lay out via `orientation` (`vertical` / `horizontal` / `wrap`) and `listItemWidth` (fraction of container width) |

### Dynamic permanentFilter via IPropertySetting code mode

```json
"permanentFilter": {
  "_mode": "code",
  "_code": "data?.tierId ? JSON.stringify({ '==': [{ var: 'tier.id' }, data.tierId] }) : JSON.stringify({ '==': [1, 0] })"
}
```

The `{ '==': [1, 0] }` fallback returns no rows — useful when the filter dependency hasn't loaded yet.

---

## Row template (sub-form-renderer datalist)

When `formSelectionMode: "name"` is set with a `formId: { module, name }`, the datalist renders each row using that form. The row data is exposed inside the row template's scripts as `data` (the row entity instance). Wrap the row template in its own form (e.g. `tier-card`, `tier-benefit-row`) and treat it as a regular entity-bound form.
