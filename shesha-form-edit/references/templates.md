# Form templates — selection and invariants

How to pick a form type and what each one must contain. Load this for any new-form work, or when restructuring an existing form's purpose.

---

## Template selection matrix

| Template | Use when | Key characteristics |
|---|---|---|
| `details` | Viewing/editing **one record** | Full entity info, tabs, child tables, audit log, Edit/Save/Cancel toolbar |
| `table` | Browsing **multiple records** | Search, filter, pagination, bulk actions (export), Add button |
| `create` | **Quick new record** entry | Minimal essential fields, modal dialog, no explicit buttons, `SectionSeparator` only |
| `dashboard` | Showing **analytics / KPIs** | Widgets, visualizations, summary data, home/overview screens |
| `dialog` | **Modal interactions** | Popup forms for quick actions |
| `custom` | **Non-standard layouts** | When standard templates don't fit |

Picking is deterministic from the user's verb / object pair: "view / edit / show / open" + one record → `details`; "list / browse / index / search" → `table`; "add / register / new" → `create`; "summary / overview / KPIs / charts" → `dashboard`; "popup confirm / quick X" → `dialog`. Otherwise `custom`.

---

## Per-template invariants

### `details` (must contain, in order)

1. **Title section** — `<text>` heading + optional `<refListStatus>` highlights for key reference-list properties (e.g. `Status`, `PaymentStatus`).
2. **KeyInformationBar** — at most 3 props, labels hidden, children forced `editMode: "readOnly"`. See [components/key-info-bar.md](components/key-info-bar.md).
3. **Toolbar** — `Edit`, `Save`, `Cancel`, `Audit Log` buttons (Audit Log uses the standard `Show Dialog` action with `formId: { name: "entity-change-audit-log", module: "Shesha" }`).
4. **`<validationErrors />`** at the top of the `sha-page-content` container.
5. **Tabs** — Details tab first; **"Notes" tab last** (always). Other content tabs in between.
6. **Child tables** in a separate `<tabs>` block when many; each `dataTableContext` with `sourceType: "Entity"`, `entityType: <modelType>`, internal pager + quickSearch.

Edit/Save/Cancel buttons are gated by `form.formMode` checks (Edit visible when `formMode === 'readonly'`; Save/Cancel visible when `formMode === 'edit'`).

### `table` (must contain)

1. **Action column FIRST** — first column is `type: "action"`, navigates to the matching details form. Use `Navigate` action with `navigationType: "form"` and `formId: { name: "{entity}-details", module }`. Pass the row id via `formArguments` / `actionArguments.id`.
2. **Add Button** — opens the matching `create` form in a dialog. Wire as `Show Dialog` with `formId: { name: "{entity}-create", module }`.
3. **Refresh on create success** — the Add button's `onSuccess` MUST call `Refresh table` against the parent `dataTableContext`'s `actionOwner` id.
4. **FilterOptions** where the entity has obvious facet properties (status, type, etc.).
5. **No `<text>` title** if a `tableViewSelector` (filter selector) is present — duplicates the header.
6. The `dataTableContext` `sourceType: "Entity"`, `entityType: <modelType>`, `dataFetchingMode: "paging"`, `defaultPageSize: 10`.

### `create` (must contain)

1. **Minimal essential fields only** — defer the long tail to the details form.
2. **No save/cancel buttons** — the dialog framework adds them automatically. Adding them yourself creates duplicates.
3. **Use `<sectionSeparator>` instead of `<panel>`** — create is a single-step dialog; collapsible panels are wrong.
4. **Use `<wizard>` for genuinely multi-step** flows (KYC, onboarding). See [components/wizard.md](components/wizard.md).
5. On submit success: navigate to the matching details form for the newly-created record — see [action-chains.md](action-chains.md) "Create → details navigation".

### `dashboard` (no entity binding)

1. `formSettings.dataLoaderType: "none"`, `modelType` empty.
2. Composed of summary cards, datalists, datatables that each manage their own data fetching (each wrapped in its own `dataTableContext`).
3. KPI cards / statistics via dedicated `statistic` or `progress` components.
4. Often anonymous-accessible or role-gated via `formSettings.access` + `permissions`.

### `dialog`

1. Typically called from a parent form's `Show Dialog` action.
2. Has access to `parentFormValues` in scripts.
3. On submit, either auto-closes (return value flows back through `Show Dialog`'s `onSuccess`) or explicitly invokes `Close Dialog` action.
4. No page chrome (no `sha-page-title`, no `sha-page-content` wrapper).

### `custom`

Anything that doesn't fit the above (login, OTP, multi-source dashboards, settings pages). Use existing seeds (e.g. `auth-login`) or follow [components/layout.md](components/layout.md) for the house pattern.

---

## Complementary-form auto-discovery

When creating a new form, query the existing forms in the same module for the matching counterparts. This is the MCP's biggest unique capability — port the logic.

### For a new TABLE form

1. Search for `{entity-kebab}-details*` (suffix-tolerant — accepts variants like `member-details-for-mvp`). If found → wire the **action column** to navigate to it.
2. Search for `{entity-kebab}-create*`. If found → wire the **Add button** to open it as a dialog.
3. Selection priority: exact suffix match > highest similarity score.

### For a new DETAILS form

1. Search for `*-subform` containing the entity name. Offer to embed each as `subForm` components.
2. Search for `*-dialog` containing the entity name. Offer to add toolbar buttons that open each.
3. Search for forms that don't match the entity name but the user's requirements imply (e.g. "approval-flow", "verification-screen"). Tag as `related_action_forms`.

### For a new CREATE form

1. Search for `{entity-kebab}-details*`. If found → wire the **submit `onSuccess`** to navigate to it with the newly-created id.

### Search recipe (no MCP)

Use the API directly — see [api.md §13](api.md). Example: `GET /api/services/Shesha/FormConfiguration/GetAll?Filter={"and":[{"==":[{"var":"module.name"},"<module>"]},{"like":[{"var":"name"},"<entity>-details%"]}]}`.

If multiple candidates match a suffix, pick the one without an `additional-descriptor` (e.g. `member-details` beats `member-details-for-mvp`). When the user has a role-specific context (e.g. mentioned "for the accountmanager view"), pick the descriptor that matches.

### Confidence handling

- Exact suffix match → wire silently.
- Suffix match with descriptor mismatch → ask: "Found `{candidate}` — wire that, or skip?".
- No match → leave a stub: the action column uses `navigationType: "url"` with a `TODO` URL; the Add button uses a `TODO` `Show Dialog`. Surface to the user.

---

## Reading from existing seeds

When a fitting form already exists in the project, prefer copying it. Search order (Step 5 of SKILL.md):

1. `assets/patterns/*.json` (vendor seeds shipped with skill).
2. `.claude/cache/shesha-form-edit/seeds/*.json` (project cache).
3. `GetAll` query for forms in the same module / same template.
4. Author from scratch (last resort; follow this file's invariants).

After deep-cloning a seed, **always run the id-remap pass** (see [components/layout.md](components/layout.md)).
