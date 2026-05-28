# Plan → Execute → Verify

The "AI-decides" workflow. Use this **whenever the heuristics would produce something wrong** — multi-form features (e-recruitment, leave-management, member onboarding), long-form text fields whose `propertyName` doesn't match the enrichment regex, entityPickers that need a custom `displayProperty`, or any time the small model is making a judgment call about structure.

The heuristic path (`scaffold.js --template=X --entity=Y --module=Z`) is fine for the dumbest possible "scaffold a details form for Person" case. For anything beyond that, **plan first**.

---

## Step 1 — Plan (the AI does the thinking)

Before writing any form, gather the four things you need to make good decisions:

### 1a. Entity metadata

```
GET /api/services/app/Metadata/GetProperties?container=<FullClassName>
```

Returns a flat array of `{ path, name, label, dataType, required, referenceListName, referenceListModule, entityType, suppress, isFrameworkRelated, maxLength }`. Filter out framework props (`suppress === true || isFrameworkRelated === true`). What's left is your candidate field set.

### 1b. Existing reference lists in the module

```
node scripts/reflist.js list --module=<ModuleName> --base-url=... --username=... --password=...
```

You need the *short* names (without the module prefix) to bind a dropdown. Cross-reference with the metadata: every prop whose `referenceListName` is non-null should bind to one of these.

If a property's `referenceListName` points to a refList that doesn't exist yet, create it:

```
node scripts/reflist.js create --module=<ModuleName> --name=<RefListName> \
  --items='Label1:1,Label2:2,...' [--folder=Lookups] \
  --base-url=... --username=... --password=...
```

### 1c. Existing forms in the module (complementary-form discovery)

```
GET /api/services/app/ConfigurationStudio/GetFlatTree
```

Filter to `itemType: "form"` + `moduleId === <yourModuleId>`. When you create a table, you want to know whether `<entity>-details` and `<entity>-create` already exist so the action column and Add button wire correctly. When you create a details, you want to know which subforms exist for that entity.

### 1d. Entity-config catalog (for entityPicker.entityType resolution)

```
GET /api/services/app/EntityConfig/GetAll?MaxResultCount=2000
```

`Metadata/GetProperties` returns FK targets as bare class names (`"JobPosting"`). The runtime needs fully-qualified names (`"A.Test.Domain.Domain.Recruitment.JobPosting"`). Look them up here. (`scaffold.js` also caches this when it auto-resolves — but in plan mode you're the one writing the plan, so you do the lookup.)

---

## Step 2 — Write the plan as JSON

The plan is a single file scaffold.js consumes. Schema:

```json
{
  "_meta": { "purpose": "human-readable note about what this plan creates" },

  "template": "details | table | create | wizard | approval-flow | audit-trail | citizen-profile | document-submission | dashboard-departmental | reports-printable",
  "name": "<form-name>",                           // kebab-case, regex: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$
  "label": "<Human-readable label>",                // optional, defaults to plan.name
  "moduleName": "<ModuleName>",                     // exact module name
  "modelType": "<Fully.Qualified.EntityClass>",     // required for entity-bound templates
  "entity": "<EntityShortName>",                    // optional, for placeholder substitution (defaults to last segment of modelType)
  "entityPretty": "<Display name>",                 // optional, defaults to pretty-cased entity
  "folder": "<Folder/Path/Inside/Module>",          // optional, defaults to entity name or template-kind

  "fields": [
    { /* each is a fully-formed component config — see "Field shapes" below */ }
  ],

  "columns": [                                      // table template only — appended after the action column
    { "propertyName": "...", "caption": "...", "isVisible": true, "sortable": true, "minWidth": 140 }
  ],

  "steps": [                                        // wizard template only — explicit step grouping
    { "key": "personal",  "title": "Personal info", "fieldRefs": ["firstName", "lastName", "dateOfBirth"] },
    { "key": "contact",   "title": "Contact",       "fieldRefs": ["email", "phone"] }
  ],

  "childTables": [                                  // details template — one tab each, prepended before Notes
    {
      "title": "Job applications",
      "entityType": "A.Test.Domain.Domain.Recruitment.JobApplication",
      "fkProperty": "jobPosting",                   // FK on the CHILD entity pointing back at parent
      "defaultPageSize": 5,
      "inlineEdit": true,                           // adds crud-operations column (per-row edit/delete)
      "columns": [
        { "propertyName": "applicationNumber", "caption": "Reference", "minWidth": 140 },
        { "propertyName": "candidate",         "caption": "Candidate", "minWidth": 200 },
        { "propertyName": "status",            "caption": "Status",    "minWidth": 140 },
        { "propertyName": "dateSubmitted",     "caption": "Submitted", "minWidth": 140 }
      ]
    }
  ]
}
```

### Child tables (details template only)

The upgraded `primary/details.json` exposes a `__SLOT_CHILD_TABLES__` slot (the `childTablesTabs` component) where plan-declared child tables become tabs. Each `plan.childTables[]` entry expands into a `dataContext` + `datatable` block mirroring the framework's `organisation-detail-view-example` pattern:

- `dataContext` (lowercase d — the framework's variant) with `sourceType: Entity`, `entityType: <child entity>`, `dataFetchingMode: paging`.
- A mustache-evaluated `permanentFilter` that scopes rows by `{{data.id}}` via the FK property you specify (`fkProperty`). The child entity's FK property must match.
- An internal `container` with `datatable.quickSearch` + `datatable.pager`.
- A `datatable` with your `columns[]`. If `inlineEdit: true`, a `crud-operations` column is prepended (gives the user per-row edit/delete inline).

Tabs are prepended **before** the Notes tab (which is always last). The first child-table tab becomes the default active tab.

`buttonGroup` convention: the framework uses `buttonGroup` (with `items[]`) for toolbars instead of loose `button` components in a container. The upgraded templates follow this. When authoring a plan that adds custom toolbar buttons, prefer the `buttonGroup` shape over a flat list.

When the plan loads, scaffold.js:
1. Substitutes placeholders in the template seed (using `moduleName`, `entity`, `entityPretty`, `modelType`).
2. Splices `fields[]` directly into the `__SLOT_FIELDS__` container with fresh GUIDs. **No enrichment, no polish, no layout heuristics** — the plan is canonical.
3. (Wizard only) Groups fields into steps per `plan.steps[]`.
4. (Table only) Appends `columns[]` to the datatable's `items[]`.
5. Runs `styler.js` (design tokens), `autofix.js`, `validate.js`, push, fold, verify.

### Component properties — read the schema before you write

**MANDATORY before writing any field, column, or component JSON:** look up the component's accepted props in the `clean-form-config` group files.

Source — use whichever is accessible:
- **Local (preferred):** glob for `clean-form-config` under `.claude/plugins/cache`, then open `assets/groups/`
- **GitHub (fallback if local not found):** https://github.com/shesha-io/shesha-plugins/tree/main/plugins/shesha-developer/skills/clean-form-config → `assets/groups/`

1. Open `index.json` → find the component type → note its group file (e.g. `"textField" → "data-entry"`, `"autocomplete" → "advanced"`, `"tabs" → "layout"`).
2. Open that group file → find the component entry → read every `prop` with its `type`, `required` flag, and `desc`.
3. Only emit props in that list. Never guess from training data.

This applies even to familiar components — the schema is the ground truth and it changes between Shesha versions.

### Field shapes (Reference)

The plan owns every field's exact configuration. Below are minimal-correct templates; add other props (`hidden`, `disabled`, `defaultValue`, `description`, etc.) as needed.

```json
{
  "type": "textField",
  "propertyName": "firstName",
  "label": "First name",
  "placeholder": "e.g. Sarah",
  "prefixIcon": "UserOutlined",
  "autoComplete": "given-name",
  "validate": { "required": true }
}
```

```json
{
  "type": "textArea",
  "propertyName": "coverLetter",
  "label": "Cover letter",
  "placeholder": "Tell us why you're a great fit…",
  "autoSize": { "minRows": 6, "maxRows": 14 },
  "showCount": true,
  "allowClear": true,
  "validate": { "required": true }
}
```

```json
{
  "type": "numberField",
  "propertyName": "salaryAmount",
  "label": "Salary",
  "prefix": "R ",
  "stepNumeric": 0.01,
  "precision": 2,
  "placeholder": "0.00"
}
```

```json
{
  "type": "dateField",
  "propertyName": "dateOfBirth",
  "label": "Date of birth",
  "dateFormat": "DD MMM YYYY",
  "prefixIcon": "CalendarOutlined",
  "validate": { "required": true }
}
```

```json
{
  "type": "dropdown",
  "propertyName": "status",
  "label": "Application status",
  "dataSourceType": "referenceList",
  "referenceListId": { "module": "A.Test", "name": "ApplicationStatus" },
  "mode": "single",
  "validate": { "required": true }
}
```

⚠️ **`referenceListId.name` is the SHORT name** (without the module prefix). The backend stores it as `A.Test.ApplicationStatus`; the runtime adds the prefix when looking up. Get this wrong → silent empty dropdown.

```json
{
  "type": "entityPicker",
  "propertyName": "jobPosting",
  "label": "Job posting",
  "entityType": "A.Test.Domain.Domain.Recruitment.JobPosting",
  "displayProperty": "title",
  "mode": "single",
  "validate": { "required": true }
}
```

⚠️ **`entityPicker.entityType` is the FULLY-QUALIFIED .NET class name** (not the bare class name `JobPosting`). Look it up via `/api/services/app/EntityConfig/GetAll`.

```json
{
  "type": "refListStatus",
  "propertyName": "status",
  "module": "A.Test",
  "referenceListName": "ApplicationStatus",
  "showIcon": true
}
```

⚠️ **`refListStatus` uses FLAT keys** (`module` + `referenceListName`), NOT the `referenceListId` object. Different shape — don't conflate.

```json
{
  "type": "checkbox",
  "propertyName": "consentToContact",
  "label": "I consent to be contacted about this application",
  "defaultValue": false
}
```

```json
{
  "type": "fileUpload",
  "propertyName": "cv",
  "label": "Curriculum Vitae",
  "allowUpload": true,
  "allowReplace": true,
  "allowDelete": true,
  "isDragger": false,
  "ownerType": "A.Test.Domain.Domain.Recruitment.JobApplication",
  "ownerIdExpression": "data?.id",
  "category": "cv"
}
```

```json
{
  "type": "notes",
  "propertyName": "notes",
  "label": " ",
  "hideLabel": true,
  "ownerType": "A.Test.Domain.Domain.Recruitment.JobApplication",
  "ownerIdExpression": "data?.id",
  "allowDelete": true,
  "savePlacement": "left"
}
```

For containers, columns, cards, and more exotic components, see the relevant `references/components/*.md` files. Plan-driven mode does NOT polish or restructure — what you put in `fields[]` is what you get.

---

## Step 3 — Execute

```
node scripts/scaffold.js --plan-file=<path> \
  --base-url=<backend> --username=<u> --password=<p> [--push]
```

Without `--push`, scaffold.js does a dry-run (validates, prints the rendered markup, exits 0). With `--push`, it creates the form, files it under `plan.folder` (or the default), and verifies via re-fetch.

Stages: load plan → load EntityConfig cache → load seed → substitute placeholders → id-remap → splice plan.fields → style → autofix → validate → push → fold → verify.

If autofix or validate report errors, **read the staged file** (path printed in the log), inspect, fix the plan, re-run. Never push markup that fails validation.

---

## Step 4 — Verify (Playwright subagent)

After every push, run the verifier. It catches the things JSON validation can't:

- Empty dropdown menus (refList didn't resolve)
- EntityPickers that show no autocomplete results
- Datatables with no rows AND no empty-state
- Inputs with no visible label
- Layout overflow (content cropped horizontally)
- Console errors / network 4xx-5xx on form load

### Invocation

The skill ships with the `playwright` skill available. Invoke it with the directive below:

```
Skill(skill="playwright", args="<directive>")
```

### Directive template

```
Open <FRONTEND_URL>/dynamic/<MODULE>/<FORM_NAME> in a fresh browser context.

Auth:
  1. Navigate to <FRONTEND_URL>/login (fallback: /no-auth/<MODULE>/auth-login).
  2. Wait for the email input to render.
  3. Fill admin@shesha.io / 123qwe (or the provided credentials).
  4. Click the submit button. Wait until location.pathname no longer contains "auth-login" or "/login".

Navigate to the target form.
Wait for the .sha-form selector or a 5s timeout.

Then check + report each of the following, with screenshots:

DESKTOP (1440x900):
  - Full-page screenshot.
  - For every <input>, <select>, <textarea>: does it have a visible label above it? Report any unlabeled.
  - For every <select> / role="combobox": click it open. Are there options? If empty, capture the open dropdown and flag as BROKEN_REFLIST: <propertyName>.
  - For every entityPicker: click it, type "a". Are autocomplete results returned? Flag empty as BROKEN_ENTITYPICKER: <propertyName>.
  - For every datatable: is there a table header row visible? Is there at least an empty-state? Flag empty-no-empty-state as BROKEN_TABLE.
  - Capture console messages of level "error" or "warning".
  - Capture network responses with status >= 400.

MOBILE (375x667):
  - Full-page screenshot.
  - Horizontal scrollbar present? Flag as OVERFLOW_MOBILE.

Then click the form's primary action button (Save / Submit / Apply).
  - If validation fires, capture which fields show errors.
  - If submit succeeds, capture the post-submit screenshot + URL.

Report:
  - One-paragraph summary.
  - Screenshot file paths.
  - Verbatim console errors + network 4xx-5xx.
  - List of BROKEN_REFLIST / BROKEN_ENTITYPICKER / BROKEN_TABLE / OVERFLOW_MOBILE flags with the component propertyName.
  - Pass / Fail verdict (Fail if ANY broken flag fired).
```

### Acting on the verifier's findings

If verify returns BROKEN_REFLIST: the dropdown's `referenceListId.name` is wrong (typo or includes the module prefix). Fix the plan, re-push.

If verify returns BROKEN_ENTITYPICKER: the `entityType` is wrong (bare className instead of fully-qualified, or wrong entity entirely). Look it up via EntityConfig/GetAll, fix the plan, re-push.

If verify returns BROKEN_TABLE: the template/plan didn't include a `datatable` + `datatableContext`. Either the wrong template was used, or the plan stripped them. Re-author the plan.

If verify returns OVERFLOW_MOBILE: the form has a fixed-width container or too many columns at narrow viewports. The default templates handle this; if your plan added custom containers, they might be over-constrained.

Never push a fix without re-verifying. The loop is **plan → execute → verify → (if broken) re-plan**.

---

## When to use the legacy heuristic path

The CLI form (`--template=X --entity=Y --module=Z`) is still appropriate for:

- **One-shot "give me a form for X"** with no specific UX requirements.
- **Quick prototypes** where you'll edit the form by hand afterwards.
- **Smoke testing** the pipeline itself.

For real features delivered to a customer, **plan first**.
