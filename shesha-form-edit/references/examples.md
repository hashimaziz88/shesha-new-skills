# Canonical Example Forms — copy these first

`assets/examples/` holds four **Shesha-standard reference forms** captured verbatim from a working A.Test backend. They are the single source of truth for layout, component selection, and CRUD wiring. **Before authoring any new form, open the matching example and copy its structure** — change only `modelType`, `entityType`, `propertyName`s, captions, and the `formId` references. Do not invent structure the examples don't have.

These contain template tokens `{{GEN_KEY}}` / `{{NEW_KEY}}` for some ids — replace each with a fresh `crypto.randomUUID()` (the same token must map to the same UUID within one form so parent/child links stay intact).

| Need | Example file | Use when |
|---|---|---|
| List/index page | `assets/examples/employee-table.json` | "table form", "list of X", "manage X" |
| Create / edit in modal | `assets/examples/employee-create.json` | the form the table's **Add** button opens; also the edit form |
| Detail page, no children | `assets/examples/employee-detail-without-child-tables.json` | a standalone record view/edit page |
| Detail page with child tables | `assets/examples/employee-detail-with-child-tables.json` | record view that also lists related child entities |

## The CRUD loop (how the four fit together)

1. **Table** (`employee-table`) lists records. Its toolbar **Add** button is a `buttonGroup` item with `buttonAction: "dialogue"` → `actionName: "Show Dialog"` (owner `shesha.common`) → `actionArguments.formId: { name: "<create-form>", module: "<module>" }`, `modalWidth: "60%"`, `formMode: "edit"`. It does **not** navigate.
2. **Create** (`employee-create`) renders inside that modal. `dataLoaderType: "gql"`, `dataSubmitterType: "gql"`; the dialog's OK button submits it via the form's default endpoints.
3. **Detail** opens a full record. The header `buttonGroup` carries the lifecycle: **Edit** = `Start Edit` (owner `shesha.form`), **Save** = `Submit` (owner `shesha.form`), **Cancel** = `Cancel Edit` (owner `shesha.form`), plus an optional **Audit Log** = `Show Dialog` → `entity-change-audit-log` (module `Shesha`). There is **no** manual navigate-back Save.
4. **Child tables** live in a `tabs` component; each tab is a `dataContext` + `datatable` filtered to the parent.

## Non-obvious specifics the examples encode

- **Data context type is `dataContext`** (canonical here) with `sourceType: "Entity"`, `entityType: "<full.Class.Name>"`, `dataFetchingMode: "paging"`, `defaultPageSize: 10`, `uniqueStateId`, `componentName`, `propertyName`, `sortMode: "standard"`, `allowReordering: "no"`. (`datatableContext` is an accepted alias but match the example and use `dataContext`.)
- **Toolbar buttons are context-scoped**: Refresh = `actionName: "Refresh table"`, column toggle = `"Toggle Columns Selector"`, both with `actionOwner` set to the **dataContext component's id** (not `shesha.common`).
- **Layout uses a `columns` component** named `detailsPanel`, `hideLabel: true`, `gutterX: 10`, `gutterY: 10`, two columns each `flex: 12` (24-grid → 50/50). Fields go inside the columns' `components`.
- **Component choice is driven by the property's data type** — see [components/by-datatype.md](components/by-datatype.md).
- **Child-table filter** uses JsonLogic + mustache:
  ```json
  "permanentFilter": { "and": [ { "==": [
    { "var": "<parentFkProp>" },
    { "evaluate": [ { "expression": "{{data.id}}", "required": true, "type": "mustache" } ] }
  ] } ] }
  ```
- **`editMode: "inherited"`** on every component; the detail header's Start Edit/Cancel Edit toggles the whole form.
