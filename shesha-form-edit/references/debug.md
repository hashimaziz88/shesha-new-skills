# Debug — symptom → cause catalog

When a push succeeds but the form misbehaves in the browser, **consult this table before guessing**. Each row maps a visible symptom to the most likely cause(s) and the fix. Loaded only on demand by Step 9 (browser smoke) or when the user reports a runtime issue.

## Reading order

1. Match the symptom you observe.
2. Walk the listed causes top-to-bottom (most common first).
3. Apply the fix; re-validate via Step 6 + 8.
4. Re-run the smoke step.

If multiple symptoms fire at once, fix them in source order — earlier rows often unblock later ones.

---

## Catalog

| # | Symptom | Likely cause(s) | Fix | Reference |
|---|---|---|---|---|
| 1 | **Field renders but won't accept input / button click does nothing** | `editMode` missing or `"inherited"` on a form whose effective mode resolved to read-only (typically `dataLoaderType: "none"` or an anonymous page). | Set `editMode: "editable"` on every interactive component. Walk the tree; assert. | [edit-mode.md](components/edit-mode.md) |
| 2 | **Button click fires nothing in console, no network call** | `actionConfiguration` missing, malformed, or `actionName` not recognised. Or the handler script throws before reaching the API call (look for an unhandled exception in console). | Verify `actionConfiguration._type === "action-config"`, `actionOwner` matches case (`shesha.common`, not `Shesha.Common`), `actionName` is one of the documented values. Wrap script body in try/catch. | [actions.md](components/actions.md), [scripts.md](components/scripts.md) |
| 3 | **Value shown in field but never persists on save** | `propertyName` typo (camelCase vs entity's PascalCase mapping), or pointing at a property that doesn't exist on the entity. Or `formSettings.dataSubmitterType` is `"none"`. | Validate `propertyName` against the entity metadata summary (Step 1.5). Confirm `dataSubmitterType` is set when the form is meant to save. | [form-shape.md](components/form-shape.md) |
| 4 | **Anonymous page returns 401 / redirects to login** | `formSettings.access` is not `5` (still default `3`). The `Create` endpoint sometimes ignores `access` on initial create. | `UpdateMarkup` with `access: 5, permissions: []`. Re-fetch via `GetByName` and assert `result.access === 5`. | [api.md §11](api.md), [form-shape.md](components/form-shape.md) |
| 5 | **Datalist / datatable shows nothing despite data existing** | The datalist is at root with `entityType` / `sourceType` set on the component itself instead of on a `dataTableContext` wrapper. | Wrap in `dataTableContext` (or `dataContext`); move `entityType`, `sourceType`, `permanentFilter` to the wrapper; clear them from the inner component. | [data-tables.md](components/data-tables.md) |
| 6 | **Refresh button / Export to Excel / quick-search no-ops** | Same as #5 — toolbar actions target the wrapper by `actionOwner`. No wrapper = nothing to target. | Same fix as #5. | [data-tables.md](components/data-tables.md) |
| 7 | **Sub-form-renderer datalist row template renders empty** | Same as #5, plus: if the wrapper exists, `formId.module` / `formId.name` may be wrong. | Confirm wrapper exists; verify the row template form exists via `GetByName`. | [data-tables.md](components/data-tables.md) |
| 8 | **Dropdown is empty (or shows IDs, not labels)** | `dataSourceType: "referenceList"` with wrong `referenceListId.module` / `name` pair, or `dataSourceType: "values"` with malformed items (each must be `{ id, label, value }`). | For ref-list: confirm the reflist exists (browse via the Configuration UI or query `ReferenceList/GetByName`). For values: assert the three keys per item. | [dropdowns.md](components/dropdowns.md) |
| 9 | **Card children render in the wrong place / disappear entirely** | Children pushed onto `card.components` instead of `card.content.components`. | Move into `card.content.components`. Header content goes in `card.header.components`. | [containers.md](components/containers.md) |
| 10 | **Conditional tab / container won't hide** | `hidden` returns a string instead of a bool — common when the IPropertySetting wrapper's `_code` returns `"true"` (string) or evaluates to a truthy non-bool. | Ensure `_code` returns a boolean. For `customVisibility`, the same applies. | [edit-mode.md](components/edit-mode.md), [form-shape.md](components/form-shape.md) |
| 11 | **Script runs but no error surfaces — silent failure** | API call missing `try/catch`. The promise rejects, `clean-form-config` may have left `console.log` stripped, leaving nothing visible. Or `.then()` chain swallowed the error. | Wrap in `try/catch` with `message.error(...)` in the catch. Convert `.then()` to `await`. | [scripts.md](components/scripts.md) |
| 12 | **Push succeeds (200) but UI doesn't reflect changes** | Browser cache: front-end caches form configs. | Hard-refresh (Ctrl+Shift+R) or close + reopen the form designer. If still stale, re-fetch via `GetJson` and confirm the markup matches what you sent. | [api.md §11](api.md) |
| 13 | **Push 500 with `Unable to translate bytes [E2] at index N from specified code page to Unicode`** | PowerShell `Invoke-RestMethod -Body $jsonString` encoded the body as Windows-1252; em dashes / curly quotes / accented chars failed to encode. | Pass body as UTF-8 bytes (`[System.Text.Encoding]::UTF8.GetBytes(...)`) or use `curl --data-binary @file` from Bash. | [SKILL.md](../SKILL.md) Non-negotiables |
| 14 | **Push 500 with NHibernate / mapping error** | `formSettings.modelType` references an entity that doesn't exist or isn't mapped. Or a `propertyName` references a missing property. | Re-run Step 1.5 (entity introspection). Compare the form's property bindings against the entity's actual property list. | [api.md §10](api.md) |
| 15 | **Form loads on first visit, fails on second (hard refresh)** | `contexts.appContext` value being read as if it persisted across hard refreshes — but `appContext` is in-memory only. | Pass via URL (`?id=...`) and re-read from `formArguments`; persist server-side; OR use `localStorage` (with namespace + only for non-sensitive data) — see [shared-state.md §"When localStorage is OK"](components/shared-state.md). | [shared-state.md](components/shared-state.md) |
| 16 | **`application.user` is `undefined` inside a script on an anonymous page** | The form is anonymous (`access: 5`); there's no logged-in user. | Optional-chain everything (`application.user?.foo`). For anonymous flows, get the value from `formArguments` (URL params) or a previous `appContext` write done from an authenticated form. | [scripts.md](components/scripts.md) |
| 17 | **`Submit` button no-op on form with `onSubmit` configured** | A custom toolbar `button` with `actionName: "Submit"` doesn't trigger `formSettings.onSubmit` directly — it triggers form-level submit. If `onSubmit` is itself a script, you may need `actionName: "ExecuteScript"` instead. | If you want the form's submit pipeline, use `actionName: "Submit"`. If you want to run an arbitrary script, use `ExecuteScript`. They are not interchangeable. | [actions.md](components/actions.md) |
| 18 | **Tab key skips field / focus order wrong** | Components were reordered in `components: []` array but the visual order doesn't match the array order — usually because a parent container has `flexDirection: "row-reverse"` or similar. | Match array order to visual order. If the visual reverse is intentional, accept the tab-order mismatch or set `tabIndex` manually. | [containers.md](components/containers.md) |

---

## Capture protocol

When the playwright smoke step (Step 9) reports a finding:

1. Quote the captured error / network response **verbatim** in your reply.
2. Reference the row number above (e.g. "matches debug.md row 1 — editMode missing").
3. Apply the fix; re-run Step 6 (validate) and Step 8 (verify).
4. Re-run the smoke step before reporting success.

If no row matches: **don't guess**. Report "no match in debug.md" and ask the user how to proceed. Adding a new row here is a maintenance task, not a runtime workaround.
