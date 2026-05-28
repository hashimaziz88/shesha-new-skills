# Shesha form cheatsheet (single-file)

The one file to read when scaffold.js fails or when you need to write a form by hand. ~300 lines of rules that are not derivable from the running code. Read top-to-bottom on first encounter; thereafter, jump to the section matching your symptom via the table of contents.

## Contents

1. [Template selection](#1-template-selection)
2. [Form naming](#2-form-naming)
3. [Form skeleton](#3-form-skeleton)
4. [IPropertySetting (`_mode` / `_value` / `_code`)](#4-ipropertysetting)
5. [`referenceListId` / `formId` shapes](#5-referencelistid--formid-shapes)
6. [`refListStatus` exception (flat keys)](#6-reflistststatus-exception)
7. [`stylingBox` is a JSON string](#7-stylingbox-is-a-json-string)
8. [Required props per component](#8-required-props-per-component)
9. [editMode rule](#9-editmode-rule)
10. [API-call action shape](#10-api-call-action-shape)
11. [Script invariants (try/catch, async/await, no globalState)](#11-script-invariants)
12. [dataTable / dataTableContext](#12-datatable--datatablecontext)
13. [KeyInformationBar invariants](#13-keyinformationbar)
14. [Anonymous forms (`access: 5`)](#14-anonymous-forms)
15. [Common API errors](#15-common-api-errors)
16. [Decision tree when something fails](#16-decision-tree)
17. [What scaffold.js does NOT do](#17-what-scaffoldjs-does-not-do)
17b. [Folder structure (Shesha v0.45+)](#17b-folder-structure-shesha-v045)
18. [Design tokens & the polish pipeline](#18-design-tokens--the-polish-pipeline)
19. [Reference lists — binding + creating](#19-reference-lists--binding--creating)

---

## 1. Template selection

Map the user's verb/noun to a template. Deterministic, no judgment required.

| User verb/noun pair | --template | Entity-bound? |
|---|---|---|
| "view / edit / show / open one X" | `details` | yes |
| "list / browse / index / search / table of X" | `table` | yes |
| "add / register / create new X" | `create` | yes |
| "multi-step / wizard / KYC / onboarding / staged application" | `wizard` | yes — sections become steps |
| "approve / reject / review / workflow / sign-off" | `approval-flow` | yes |
| "audit / change history / who-edited" | `audit-trail` | yes |
| "my profile / self-service / account page" | `citizen-profile` | yes |
| "upload documents / KYC docs / file checklist" | `document-submission` | yes |
| "dashboard / KPIs / departmental overview" | `dashboard-departmental` | no (but `--entity` is used if provided) |
| "printable / A4 / official report / signed off" | `reports-printable` | no |
| "login / register / OTP" | (not in scaffold.js — copy `assets/patterns/auth-login.json`) | — |
| "popup / quick confirm / modal action" | (not in scaffold.js — use legacy) | — |

Anything not in this table → **don't use scaffold.js**, follow `SKILL-legacy.md`.

### Template invariants quick reference

- **`wizard`** — runs layout-polish, then converts each detected section into a wizard step. Submit on last step navigates to `{entity}-details`. Steps inherit form `editMode`.
- **`approval-flow`** — KeyInfoBar at top (status/ref/requester), 3 tabs (Request Details / Comments / History), action toolbar (Approve / Reject / Request Changes) wired to `/api/services/app/{Entity}/Approve` and `/Reject` endpoints (TODO: implement those endpoints).
- **`audit-trail`** — wraps `/api/services/app/EntityHistory/GetAuditTrail`. Filter row, paginated table of changes (when / user / action / property / from / to). Export to Excel button.
- **`citizen-profile`** — 4 tabs (Profile / Documents / Applications / History). Profile holds field components; Documents uses `attachmentsEditor`; Applications is an entity-bound datatable filtered by `owner.id == data.id`; History reads from EntityHistory.
- **`document-submission`** — 3 example cards (ID proof / address proof / supporting docs) using `fileUpload` + `attachmentsEditor`. Submit-for-Review button posts to `/api/services/app/{Entity}/SubmitDocuments` (TODO endpoint).
- **`dashboard-departmental`** — 4 KPI statistic cards (TODO endpoints), recent-activity entity-bound datatable, quick-actions row with Add + Browse-all buttons.
- **`reports-printable`** — A4 layout: org logo + meta + title + summary + detail table + signature block (Prepared / Reviewed / Approved) + footer. Print + Download-PDF buttons.

---

## 2. Form naming

Regex: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` — kebab-case, must start with a letter, no leading digit, no double-dashes, no trailing dash.

Composition: `{entity-kebab}-{template}[-{descriptor}]`. Examples:
- `person-details` ✓
- `loan-application-table` ✓
- `customer-create-for-account-manager` ✓ (descriptor only when there's a variant)
- `Customer-Details` ✗ (PascalCase)
- `person_details` ✗ (snake_case)
- `2024-summary` ✗ (leading digit)

`scaffold.js` derives the name from `--entity` + `--template` by default. Pass `--name=` only to override.

Uniqueness within the module is enforced server-side. On collision: rename or delete the existing form first.

---

## 3. Form skeleton

After `JSON.parse(markup)`:

```json
{
  "components": [ /* nested tree, parentId chain to "root" */ ],
  "formSettings": {
    "modelType": "Fully.Qualified.EntityClass",
    "dataLoaderType": "gql" | "entity" | "custom" | "none",
    "dataSubmitterType": "gql" | "entity" | "custom" | "none",
    "layout": "horizontal" | "vertical",
    "labelCol": { "span": 8 },
    "wrapperCol": { "span": 16 },
    "colon": true,
    "size": "middle",
    "access": 3,
    "permissions": [],
    "version": 8
  }
}
```

Every component has at minimum:

```json
{ "id": "<unique-string>", "type": "<componentType>", "parentId": "<parent-id-or-root>", "propertyName": "<camelCase>", "label": "<display>" }
```

- `id` — unique across the tree. Preserve when editing; mint fresh GUIDs only on clones / new nodes. (`scaffold.js` does this automatically.)
- `propertyName` — **camelCase**, matches the entity property. The metadata API returns PascalCase paths; lower-case the first letter.
- `parentId` — `"root"` for top-level, otherwise an existing `id` in the tree.
- `label` — display label. `hideLabel: true` removes it.

Strip these top-level keys before pushing markup: `module`, `name`, `type`, `frontEnd`, `label`, `description`, `versionNo`, `versionStatus`. They live on the form record (`FormConfigurationDto`), not in markup.

---

## 4. IPropertySetting

Many string/number/boolean props accept three forms:

```json
"hidden": false                                                          // plain
"hidden": { "_mode": "value", "_value": false }                          // wrapped value
"hidden": { "_mode": "code", "_code": "return data.accountType !== 'PBF';" }   // runtime JS
```

Rules:
- Always include `_mode`. Bare `{ "_value": ... }` is not recognised.
- `_mode: "code"` requires `_code`; `_mode: "value"` requires `_value`.
- `_code` is evaluated against the script context (`data`, `form`, `globalState`, `contexts`, etc. — see [components/scripts.md](components/scripts.md)).
- Prefer `_code` that explicitly **`return`s** a value: `return data.x !== null;`.
- When editing existing markup, keep wrapper shape. Only convert plain → wrapped when the user asks for runtime behaviour.

Applies to: `hidden`, `disabled`, `defaultValue`, `label` (sometimes), and many component-specific props. `validate.js` enforces shape.

---

## 5. `referenceListId` / `formId` shapes

These four props take **object** shape, never a string, never a Guid:

| Component | Prop | Shape |
|---|---|---|
| dropdown / radio / checkboxGroup (when `dataSourceType: "referenceList"`) | `referenceListId` | `{ "name": "PaymentStatus", "module": "Shesha" }` |
| subForm | `formId` | `{ "name": "address-edit", "module": "Shesha" }` |
| datatable / datalist with row-template | `formId` | `{ "name": "...", "module": "..." }` |
| Show Dialog action arguments | `formId` | `{ "name": "...", "module": "..." }` |

`validate.js` enforces both shapes. scaffold.js emits them correctly when the metadata has `referenceListName` / `referenceListModule` populated.

---

## 6. `refListStatus` exception

`refListStatus` uses **flat** keys, not the object shape:

```json
{
  "type": "refListStatus",
  "propertyName": "status",
  "module": "Shesha",
  "referenceListName": "MemberStatus",
  "showIcon": true,
  "hideLabel": true
}
```

Don't conflate with the dropdown shape. `validate.js` checks both.

---

## 7. `stylingBox` is a JSON string

Almost all styling subkeys (`border`, `background`, `font`, `dimensions`, `shadow`) are objects nested under `desktop` / `tablet` / `mobile`. **`stylingBox` is the exception** — it is stored as a JSON-encoded string:

```json
"stylingBox": "{\"paddingTop\":16,\"paddingBottom\":16,\"marginLeft\":\"auto\"}"
```

If you compute it as an object, `JSON.stringify` it before persisting. `autofix.js` does this automatically when it sees an object value at `stylingBox`.

---

## 8. Required props per component

**Always read the clean-form-config group files before writing any component.** They are the authoritative, version-accurate schema — faster than guessing and guaranteed not to produce unknown-prop rejections.

Lookup path — use whichever is accessible:
- **Local (preferred):** glob for `clean-form-config` under `.claude/plugins/cache`, then open `assets/groups/`
- **GitHub (fallback):** https://github.com/shesha-io/shesha-plugins/tree/main/plugins/shesha-developer/skills/clean-form-config → `assets/groups/`

Files:
- `index.json` → maps `type` to group file name
- group file → lists every accepted `prop` with `type`, `required`, `desc`

Mandatory props `validate.js` enforces for the most-used types:

| Component type | Mandatory props |
|---|---|
| `entityPicker` | `entityType` (full class name) |
| `dropdown` / `radio` / `checkboxGroup` with `dataSourceType: "referenceList"` | `referenceListId: { name, module }` |
| `datatableContext` with `sourceType: "Entity"` | `entityType` OR `dataSourceEntity` |
| `subForm` | `formId: { name, module }`, `formSelectionMode`, `dataSource` |
| `refListStatus` | flat `module` + `referenceListName` (see §6) |
| `notes` | `ownerType` (entity class) — `ownerIdExpression` for non-root forms |

For the full per-component prop catalog, run `node scripts/components-index.js <type>` — this loads from `shesha-developer:clean-form-config`'s authoritative index.

---

## 9. editMode rule

Every **interactive** component must have `editMode: "editable"` (or `"inherited"` for buttons that don't bind to data).

Interactive types: `textField`, `textArea`, `numberField`, `dateField`, `timePicker`, `dropdown`, `radio`, `checkbox`, `checkboxGroup`, `switch`, `rate`, `slider`, `autocomplete`, `entityPicker`, `colorPicker`, `richTextEditor`, `fileUpload`, `notes`, `address`, `button`, `link`, `buttonGroupItem`.

Layout components (`container`, `card`, `tabs`, `columns`, `sectionSeparator`) get `editMode: "inherited"` or omit it.

`KeyInformationBar` children are forced `editMode: "readOnly"` by the framework (see §13).

`validate.js` warns when an interactive node is missing `editMode`.

---

## 10. API-call action shape

When wiring a button or lifecycle hook to call an API:

```json
"actionConfiguration": {
  "actionOwner": "shesha.common",
  "actionName": "API Call",
  "handleSuccess": true,
  "handleFail": true,
  "actionArguments": { "url": "/api/...", "verb": "POST", "data": {} },
  "onSuccess": { "_type": "action-config", "actionOwner": "shesha.common", "actionName": "Execute Script", "actionArguments": { "expression": "/* ... */" } },
  "onFail":    { "_type": "action-config", "actionOwner": "shesha.common", "actionName": "Execute Script", "actionArguments": { "expression": "if (actionError?.response) { message.error(actionError.response.data.error.message, 5); }" } }
}
```

Both `handleSuccess: true` AND `handleFail: true` AND both `onSuccess` / `onFail` configured. Missing any of those four = silent failure mode.

---

## 11. Script invariants

Inside any `_code` / lifecycle-hook / action-script string:

1. **Globals are not doubled.** Write `form.formMode`, not `form.form.formMode`. Same for `data.x` (not `data.data.x`) and `globalState.x` (not `globalState.globalState.x`). `autofix.js` deduplicates with a regex pass.

2. **API calls use `try/catch` + `async/await`.** Never `.then()` chains.

   ```js
   try {
     const r = await http.get('/api/...');
     // use r
   } catch (e) {
     message.error(e?.response?.data?.error?.message || 'Failed', 5);
   }
   ```

   `clean-form-config` detects `.then()` chains and missing `try/catch` / `async`.

3. **No `globalState` for cross-form state.** Use `contexts.appContext` (app-wide) or `pageContext` (inter-page within the same page). `localStorage` / `sessionStorage` only for state that must survive a hard refresh AND is not sensitive.

4. **Quote escaping** — inside `_code` strings that came from XML-imported markup, use `&quot;` for `"`. In hand-written JSON, normal `\"` is fine.

5. **Scripts use `propertyName`, not `label`.** `clean-form-config` flags `data.firstNameLabel` / `data["First Name"]` references.

---

## 12. dataTable / dataTableContext

**`datatable` and `datalist` MUST be wrapped in a `dataTableContext`** — never put them at root with their own `entityType` / `sourceType`. That breaks Refresh, Export, sub-form-renderer row data, and external action wiring.

Canonical entity-bound list:

```json
{
  "type": "dataTableContext",
  "componentName": "tableContext",
  "sourceType": "Entity",
  "entityType": "Shesha.Domain.Person",
  "dataFetchingMode": "paging",
  "defaultPageSize": 10,
  "components": [
    { "type": "datatable.quickSearch", "actionOwner": "tableContext" },
    { "type": "datatable", "items": [/* columns */] },
    { "type": "datatable.pager", "actionOwner": "tableContext" }
  ]
}
```

Buttons/filters inside the context that target the context (`Refresh table`, `Export to Excel`, `Toggle Advanced Filter`) must set `actionOwner` to the context's `id`, not its `componentName`. **Authoring shortcut**: write `actionOwner` as the `componentName` for readability — `autofix.js` rewrites it to the id recursively.

Action column inside the datatable navigates to the details form:

```json
{
  "columnType": "action",
  "actionConfiguration": {
    "actionOwner": "shesha.common",
    "actionName": "Navigate",
    "actionArguments": {
      "navigationType": "form",
      "formId": { "name": "person-details", "module": "A.Test" }
    }
  }
}
```

`navigationType: "form"`, NOT `"url"`. scaffold.js's `table` template emits this correctly.

---

## 13. KeyInformationBar

A read-only horizontal banner at the top of details forms.

Invariants:
- **Max 3 properties** — more collapses on mobile.
- **Children forced `editMode: "readOnly"`** — the framework overrides any other editMode.
- **Children forced `hideLabel: true`** — labels render as a separate `<text>` above each value.
- **Each property is wrapped in its own column container** (`width: 200px`, centered text, column flex direction).
- For reference-list-valued props (Status, Tier), use `refListStatus` (§6) as the inner display component, not `textField`.

When in doubt, see [components/key-info-bar.md](components/key-info-bar.md) for the canonical shape.

---

## 14. Anonymous forms

`formSettings.access = 5` makes the form reachable without login. Served at `/no-auth/<module>/<form>`. Authenticated forms (`access: 3`, default) live at `/dynamic/<module>/<form>`.

**Gotcha**: the `Create` endpoint may not honour `access` on initial create. After `POST /Create`, immediately call `PUT /UpdateMarkup` with `access: 5, permissions: []` to lock it in. Verify by re-fetching `GetByName` and checking `result.access === 5`.

scaffold.js sets `access: 3` by default. Anonymous forms aren't a scaffold.js use case — copy `assets/patterns/auth-login.json` instead.

---

## 15. Common API errors

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` on Authenticate | Wrong username/password | Ask the user. Don't brute-force. Default `admin/123qwe` doesn't work on all builds. |
| `401` on protected endpoint | Token expired (24h default) | Re-authenticate |
| `403 Forbidden` | User lacks `app:Configurator` | Login as a configurator-role user |
| `404` on `Module/GetAll` under `/Shesha/` | Some builds expose `Module` under `/app/` not `/Shesha/` | scaffold.js tries both automatically. Hand-curl: swap namespace before assuming endpoint is missing. |
| `Metadata/Get` returns 400 "request is not valid" | Newer builds require `entityType+module+name`, not `container` | Use `Metadata/GetProperties?container=<FullClassName>` — returns a flat property array. |
| `"Form is not editable"` on Create | Module's `isEditable === false` | Module must be enabled & editable in the module manager. |
| `Module is null` | Form's module reference is broken | Re-fetch via `Get`, check `result.module` is populated |
| `Markup is not valid JSON` | The string isn't parseable | Re-stringify; ensure no truncation in the request body |
| Empty `result` from GetByName | Form doesn't exist under that name/module | Verify via `GetAll` |
| `result: null` on UpdateMarkup but `success: true` | Normal — endpoint returns void | No action |
| Server 500 on UpdateMarkup with em-dashes / curly quotes | UTF-8 byte-handling on the request body | Pass the body as UTF-8 bytes; `scaffold.js` does this. Hand-curl: use `curl --data-binary @file`. |

---

## 16. Decision tree

When scaffold.js exits non-zero or a runtime error appears in the browser:

```
1. Quote the error message verbatim.
2. Match it to a row in §15 (API errors) or look it up in references/debug.md (30 rows of symptom → cause).
3. If the symptom maps to a known fix, apply it. Re-run scaffold.js.
4. If validate.js reports an error, read the file at the staged path (printed in the log). Fix manually, re-run validate.js, re-push.
5. If autofix.js applied a transformation you didn't expect, that's fine — autofix is deterministic and idempotent. Don't fight it.
6. If clean-form-config reports an issue, accept its fix (it has the full component-property index).
7. Last resort: read references/SKILL-legacy.md and walk the full 10-step Opus workflow.
```

Never silently retry a failed push. Never invent endpoints or property names. Never push markup that fails validation.

---

## 17. What scaffold.js does NOT do

scaffold.js handles the 80% case: creating a brand-new `details` / `table` / `create` form for an entity that exists in the backend. It does NOT:

- **Edit existing forms.** Use `SKILL-legacy.md` for the GET-edit-PUT round-trip.
- **Compose multi-source dashboards** (dashboard, KPI cards, summary widgets). Copy `assets/patterns/dashboard.json` and edit.
- **Build login / register / OTP / branded auth pages.** Copy `assets/patterns/auth-login.json` and edit.
- **Wire dialogs / modal actions / wizards / kanban / charts.** Use the relevant `components/<topic>.md` references.
- **Auto-discover complementary forms.** scaffold.js wires `table` action columns to `{entity}-details` and Add buttons to `{entity}-create` by **convention** (assuming those forms exist or will be created). The legacy MCP queries the backend to confirm; scaffold.js does not.
- **Apply project-specific design / branding.** scaffold.js emits neutral defaults. Run `frontend-design` skill afterwards if you need bespoke styling.
- **Run the post-push browser smoke.** Invoke the `playwright` skill afterwards if you want visual confirmation (recipe in `references/api.md §12`).

For any of those, fall back to the legacy workflow or the relevant skill.

---

## 17b. Folder structure (Shesha v0.45+)

When the running backend exposes the `ConfigurationStudio` service, **scaffold.js MUST file every form into a folder** — this is enforced, not optional. Detection is automatic via `GET /api/services/app/ConfigurationStudio/GetModules`; if it 200s, foldering is on. If it 404s (pre-v0.45), foldering is silently skipped.

### Endpoints used (all under `/api/services/app/ConfigurationStudio/`)

| Endpoint | Purpose |
|---|---|
| `GetModules` | Detection probe — does the v0.45 API exist? |
| `GetFlatTree` | List existing folders + items to find-or-create the target folder |
| `CreateFolder` | POST `{ moduleId, folderId (parent, null=root), name, prevItemId }` |
| `MoveNodeToFolder` | POST `{ nodeType: 2, nodeId: <formId>, folderId }` (1=module, 2=item, 3=folder) |

### Default folder convention

scaffold.js picks the folder when `--folder=` isn't passed:

| Template | Default folder |
|---|---|
| Entity-bound (details, table, create, wizard, approval-flow, audit-trail, citizen-profile, document-submission) | `<EntityPretty>` (e.g. `Person`, `LoanApplication`) |
| `dashboard-departmental` | `Dashboards` |
| `reports-printable` | `Reports` |

### Overrides

- `--folder=Forms/People` — explicit nested path. Creates `Forms` (if missing), then `People` under it, returns People's id, files the form there.
- `--no-folder` — opt out entirely (form lands at module root).

### Find-or-create semantics

`ensureFolderPath()` walks `GetFlatTree`'s output, indexes folders by `parentId + name (case-insensitive)`, then either reuses an existing folder or creates a new one segment-by-segment. Multiple scaffold.js runs targeting the same path are idempotent.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `foldering: ConfigurationStudio API not available (pre-v0.45 Shesha) — skipping` | Backend is older Shesha | Upgrade Shesha, or pass `--no-folder` to silence the warning |
| `CreateFolder("Forms") failed: ...` | Module isn't editable, or the user lacks ConfigurationStudio permissions | Verify `module.isEditable === true` and the user has Configurator access |
| Form created but not in a folder after success | `--no-folder` was passed | Re-run without `--no-folder` (folder add is post-create, idempotent) |

---

## 18. Design tokens & the polish pipeline

scaffold.js does three things between metadata fetch and push that produce enterprise-grade output by default. None of them require user intervention; all three respect overrides if the caller wants control.

### 18a. `scripts/enrich.js` — propertyName UX heuristics

Looks at each picked metadata property's name and dataType, then adds icons / placeholders / formats. Conservative — if nothing matches, the component is unchanged.

| Property name pattern | Augmentation |
|---|---|
| `email*` / `*Mail*` (string) | `prefixIcon: "MailOutlined"`, placeholder `e.g. name@example.com`, email regex |
| `phone*` / `mobile*` / `cell*` (string) | `PhoneOutlined`, `textType: "tel"`, `+27 81…` placeholder, `autoComplete: "tel"` |
| `url*` / `website*` (string) | `LinkOutlined`, `textType: "url"`, `https://…` placeholder |
| `password*` (string) | `LockOutlined`, `textType: "password"` |
| `amount*` / `price*` / `salary*` (numeric) | `prefix: "R "`, `precision: 2`, `stepNumeric: 0.01` |
| `percent*` / `rate*` (numeric) | `suffix: "%"`, `min: 0`, `max: 100` |
| `count*` / `quantity*` (numeric) | `precision: 0`, integer step |
| `description` / `notes` / `bio` / `comments` (string) | upgrades to `textArea` with `autoSize: { minRows: 3, maxRows: 8 }`, `showCount`, `allowClear` |
| `firstName` / `lastName` / `fullName` etc. | `UserOutlined`, friendly placeholders (`e.g. Sarah`), correct `autoComplete` token |
| `addressLine*` / `street*` (string, not entity FK) | `HomeOutlined`, `autoComplete: "street-address"` |
| `city` / `postalCode` / `country` | `autoComplete` tokens for browser fill |
| date / date-time | `dateField` with `DD MMM YYYY`, `CalendarOutlined`, `showTime` for datetimes |
| `search*` / `query*` | `SearchOutlined`, `allowClear` |

To add a heuristic: append a rule object to `RULES` in `scripts/enrich.js`. Each rule is `{ test(prop): bool, apply(component, prop): component }`.

### 18b. `scripts/layout-polish.js` — structure

Takes the flat list of input components after enrichment, returns a structured tree:

1. **Section clustering** — fields are grouped by semantic category and each group gets a `sectionSeparator` heading:
   - **Identity** — name, gender, DOB, ID number, reference numbers
   - **Contact** — email, phone, fax, social, URL
   - **Address** — street, city, postal, country
   - **Employment** — job title, department, salary, hire date
   - **Preferences** — language, timezone, currency, opt-ins
   - **Details** — description, notes, bio, comments, summary
   - **Other** — catch-all (always last)
2. **2-column pairing** — adjacent "short" fields (text, number, date, dropdown, switch) are wrapped in a `columns` row with 12+12 flex, 16px gutter. Long fields (`textArea`, `autoSize`) always stay full-width.
3. **KeyInformationBar inference (details only)** — top 1–3 high-signal props (status, ref/reference number, tier/level, amount, created date) are extracted and rendered above the validationErrors as small uppercase labels + bold values. Uses `refListStatus` for status props (flat keys; §6).

Skipped automatically when there are fewer than 3 fields (no benefit).

### 18c. `scripts/styler.js` — typography, color, spacing, elevation

Walks the rendered tree, detects each component's **role**, and writes a complete `desktop` + `tablet` + `mobile` style block from `assets/design-tokens.json`.

Roles detected automatically (no annotation needed):

| Role | Trigger |
|---|---|
| `page` / `pageTitle` / `pageContent` | `container` with `className: "sha-page"` / `"sha-page-title"` / `"sha-page-content"` |
| `toolbar` | `container` with `componentName` containing "toolbar" |
| `card` | `type: "card"` |
| `button-primary` / `-secondary` / `-ghost` / `-danger` | `type: "button"`, by `buttonType` (defaults to `secondary`; icon-only buttons → `ghost`) |
| `input` | any of `textField`, `textArea`, `numberField`, `dateField`, `timePicker`, `dropdown`, `radio`, `checkbox`, `checkboxGroup`, `switch`, `rate`, `slider`, `autocomplete`, `entityPicker`, `colorPicker`, `richTextEditor`, `fileUpload`, `address` |
| `heading-1` / `heading-2` / `subtitle` / `body` | `type: "text"` by `level` and font-size |
| `sectionHeading` | `type: "sectionSeparator"` |
| `tabs` | `type: "tabs"` |
| `keyInfoBar` | `type: "keyInformationBar"` |
| `validationErrors` | `type: "validationErrors"` |
| `table` | `type: "datatable"` |
| `columnsRow` | `type: "columns"` |
| `container` (default) | any other `container` |

### 18d. Customising the design system

| To change | Edit |
|---|---|
| Accent / brand colour | `color.accent` in `design-tokens.json` (rest of palette stays neutral) |
| Font | `typography.fontFamily` |
| Spacing density | `spacing.md` / `spacing.lg` / `component.input.height` |
| Border radius style | `radius.md` (inputs, buttons) / `radius.xl` (cards) |
| Elevation | `shadow.sm` / `shadow.md` |
| Per-project override | pass `--tokens-file=<path>` to scaffold.js |

The styler reads from a single resolved tokens object — references like `"{color.accent}"` are resolved at load time, so internal cross-references work.

### 18e. Bypassing the pipeline

If you need raw output (no enrich, no polish, no styler), edit `scripts/scaffold.js` to skip those stages and re-run. Or pass `--max-fields=2` to keep the field list small enough that polish becomes a no-op.

---

## 19. Reference lists — binding + creating

A **reference list** ("list of values") is Shesha's way of storing a fixed enumeration with stable integer codes (e.g. `ApplicationStatus = { Submitted: 1, Approved: 2, Rejected: 3 }`). Two halves matter for forms:

- **Binding** — wiring an existing reference list to a `dropdown` / `radio` / `checkboxGroup` / `refListStatus` component.
- **Creating** — making a brand-new reference list available via the API (Shesha v0.45+).

### 19a. Binding to an existing reference list

Use `dataSourceType: "referenceList"` + an object `referenceListId`. The object shape — **never** a Guid, **never** a string — has two keys: `module` and `name`:

```json
{
  "type": "dropdown",
  "propertyName": "priority",
  "label": "Priority",
  "dataSourceType": "referenceList",
  "referenceListId": { "module": "A.Test", "name": "Priority" },
  "mode": "single",
  "editMode": "editable"
}
```

`mode` is `"single"` | `"multiple"` | `"tags"`. Same shape for `radio` and `checkboxGroup`. See [components/dropdowns.md](components/dropdowns.md) for additional details.

**`refListStatus` is the exception** — it uses **flat keys**, not the object:

```json
{
  "type": "refListStatus",
  "propertyName": "status",
  "module": "A.Test",
  "referenceListName": "ApplicationStatus",
  "showIcon": true
}
```

If you write `referenceListId` on a `refListStatus`, it renders empty. `validate.js` flags this.

**Naming**: the reference-list `name` you pass is the *short* name (e.g. `Priority`). The backend stores it as `<Module>.<Name>` (e.g. `A.Test.Priority`); the runtime resolves the prefix automatically — don't include the module prefix in `referenceListId.name` / `refListStatus.referenceListName`.

**`scaffold.js` emits the right shape automatically** when the entity metadata exposes `referenceListName` + `referenceListModule` on a property. No manual binding needed for entity-bound forms.

### 19b. Hardcoded values (no refList)

When the options are small + not reused, hardcode with `dataSourceType: "values"`:

```json
{
  "type": "dropdown",
  "propertyName": "preferredChannel",
  "dataSourceType": "values",
  "values": [
    { "id": "1", "label": "Email", "value": "email" },
    { "id": "2", "label": "SMS",   "value": "sms" }
  ],
  "editMode": "editable"
}
```

Each item needs all three keys (`id`, `label`, `value`). Missing any → silent breakage. `clean-form-config` flags this.

### 19c. Creating a new reference list (Shesha v0.45+)

Use the bundled CLI:

```
node scripts/reflist.js create \
  --module=<ModuleName> \
  --name=<RefListShortName> \
  --items='Label1:1,Label2:2,Label3:3' \
  [--label='Display label'] \
  [--description='...'] \
  [--folder=Lookups] \
  [--base-url=...] [--username=...] [--password=...]
```

The script is **idempotent**: re-running with the same name finds the existing reference list (no duplicate), and items whose `item` field matches an existing one (case-insensitive) are skipped. New items in subsequent runs are appended.

Behind the scenes it calls:

| Endpoint | Purpose |
|---|---|
| `POST /api/services/app/ConfigurationStudio/CreateItem` | Creates the reference-list record (`itemType: "reference-list"`, `discriminator: "reference-list"`). Backend assigns the prefixed full name `<Module>.<RefListName>`. |
| `POST /api/dynamic/Shesha/ReferenceListItem/Crud/Create` | Adds each item with `{ item, itemValue, orderIndex, color, icon, shortAlias, referenceList: { id } }`. |
| `GET /api/services/app/ConfigurationStudio/GetItem?module=&name=&itemType=reference-list` | Fetches the full refList (with items) for idempotency checks + verification. |
| `POST /api/services/app/ConfigurationStudio/MoveNodeToFolder` | Optional — files the new refList under a folder (e.g. `Lookups`). |

After creation, the CLI prints the exact JSON snippet to paste into a form for binding (both dropdown shape and refListStatus shape).

### 19d. Listing existing reference lists

```
node scripts/reflist.js list --module=<ModuleName> [--base-url=...] [--username=...] [--password=...]
```

Outputs every reference list in the module with its id. Useful when you're about to bind a dropdown and need to confirm the exact name.

### 19e. Items with extra fields (color, icon, shortAlias)

For status-style refLists where each item has a colour or icon (e.g. green check for "Approved", red x for "Rejected"), use `--items-json` instead of `--items`:

```
node scripts/reflist.js create --module=A.Test --name=ApplicationStatus \
  --items-json='[
    {"item":"Submitted","itemValue":1,"color":"#0284C7","icon":"ClockCircleOutlined"},
    {"item":"Approved","itemValue":2,"color":"#16A34A","icon":"CheckCircleOutlined"},
    {"item":"Rejected","itemValue":3,"color":"#DC2626","icon":"CloseCircleOutlined"}
  ]' --base-url=... --username=... --password=...
```

`color` and `icon` flow through to `refListStatus` rendering, so the status badges are pre-styled.

### 19f. Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Dropdown renders empty | `referenceListId` is a string / Guid / wrong shape | Must be `{ module, name }` object |
| `refListStatus` renders empty | Used the dropdown shape (`referenceListId`) instead of flat keys | Use flat `module` + `referenceListName` |
| `reflist: ConfigurationStudio API not available` | Pre-v0.45 Shesha | Upgrade Shesha. On older builds, refLists are created via FluentMigrator (a separate skill) or the legacy UI. |
| Duplicate items appear after re-run | `--items` includes an item with a different case (e.g. "Low" vs "low") | Match the existing casing exactly, or accept the dupe and clean up via the designer |
| Item created but won't appear in the dropdown | `itemValue` overlaps with an existing item's value | Each `itemValue` must be unique within the refList |
| Existing reference list's items missing after binding | The refList was named with the module prefix in the form (`referenceListId.name: "A.Test.Priority"`) | Drop the prefix — use just `"Priority"`. The runtime adds the module prefix automatically. |

---

## Quick reference card

```
# New details form
node scripts/scaffold.js --template=details --entity=Person --module=A.Test \
  --base-url=http://localhost:21021 --username=admin --password='Passw0rd!' \
  --max-fields=8 --push

# New table form (5 visible columns + action col)
node scripts/scaffold.js --template=table --entity=Person --module=A.Test \
  --base-url=http://localhost:21021 --username=admin --password='Passw0rd!' \
  --max-fields=5 --push

# New create form (specific fields, in order)
node scripts/scaffold.js --template=create --entity=Person --module=A.Test \
  --base-url=http://localhost:21021 --username=admin --password='Passw0rd!' \
  --include=firstName,lastName,emailAddress1 --push

# Inspect props valid for a component type
node scripts/components-index.js dropdown

# Create a reference list with items (Shesha v0.45+)
node scripts/reflist.js create --module=A.Test --name=Priority \
  --items='Low:1,Medium:2,High:3,Critical:4' --folder=Lookups \
  --base-url=http://localhost:21021 --username=admin --password='123qwe'

# List existing reference lists in a module
node scripts/reflist.js list --module=A.Test --base-url=... --username=... --password=...

# Dry-run (no --push) prints the rendered markup to stdout
node scripts/scaffold.js --template=details --entity=Person --module=A.Test --base-url=... --username=... --password=...
```
