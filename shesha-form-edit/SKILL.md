---
name: shesha-form-edit
description: Create Shesha forms via a Plan → Execute → Verify workflow. Use when the user asks for any form, set of forms, or a feature ("e-recruitment system", "leave management", "scaffold a details form for X"). The skill has two paths — heuristic (one-shot CLI for trivial cases) and plan-driven (AI authors a plan JSON, scaffold.js executes it verbatim, Playwright verifies). Plan-driven is the default for any non-trivial work.
allowed-tools:
  - Bash
  - PowerShell
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - Skill
---

# Shesha Form Edit

Two paths, by intent.

## Path A — Plan → Execute → Verify (default for non-trivial work)

**When to use:** any multi-form feature ("e-recruitment system"), forms with long-form text fields whose names don't fit the heuristic regex, forms whose entityPickers need a specific `displayProperty`, anything the user describes by *function* rather than by *entity*.

Workflow:

1. **Plan** — gather entity metadata + existing refLists + existing forms + EntityConfig, then write a plan JSON that explicitly lists every field's type / propertyName / refList binding / entityType. The AI takes ownership of component choices; no regex heuristics involved.
2. **Execute** — `node scripts/scaffold.js --plan-file=<path> --push`. The plan JSON is canonical; scaffold.js splices fields verbatim, applies design tokens, validates, pushes, files into folder.
3. **Verify** — invoke the `playwright` skill with the verification directive. It loads the form, screenshots desktop + mobile, opens every dropdown / entityPicker / datatable, captures console + network errors, reports broken refLists / pickers / tables / overflow.
4. **If verify reports issues** — fix the plan, re-execute, re-verify. Never patch the rendered markup directly; always go through the plan.

Full recipe with schema, field shapes, refList/entityType gotchas, and the Playwright directive template: **[references/plan-execute-verify.md](references/plan-execute-verify.md)**.

## Path B — Heuristic one-shot (trivial cases only)

**When to use:** "scaffold a details form for Person in A.Test" — single form, no special UX requirements, throwaway / smoke-test work.

```
node scripts/scaffold.js \
    --template=<details|table|create|wizard|approval-flow|audit-trail|citizen-profile|document-submission|dashboard-departmental|reports-printable> \
    --entity=<EntityClassName> \
    --module=<ModuleName> \
    [--name=<form-name>] \
    [--include=propA,propB,...] [--exclude=propX] [--max-fields=N] \
    --base-url=http://localhost:21021 \
    --username=admin --password=<password> \
    --push
```

Pipeline: auth → resolve module → resolve entity → fetch metadata → render template → id-remap → enrich (UX heuristics) → polish layout → style → autofix → validate → push → fold → verify.

**Don't use Path B when:**
- The entity has long-form fields whose names don't match `/description|notes|comments|bio|summary|details|remarks|message|reason|justification|background|coverLetter|qualifications|workExperience|skills|motivation|essay|letter|proposal|statement/i` — they'll be rendered as `textField` instead of `textArea`.
- The user wants a specific `displayProperty` on an entityPicker (heuristics default to `_displayName`).
- The user wants explicit field ordering or sectioning that differs from the auto-section heuristic.
- You're shipping multiple related forms (table + create + details for the same entity) where complementary-form wiring matters.

In all those cases, **plan first**.

---

## Templates are starting points, not constraints

scaffold.js always loads a template seed (`primary/details.json`, `primary/table.json`, etc.) — that's how the page chrome, toolbars, validation row, panel structure, and Notes tab get a consistent shape. But the AI **owns** what goes inside the slots. A plan can:

- Pick any template, even one that's a 70% fit — and override the rest.
- Provide its own `fields[]` (heuristics never run in plan mode).
- Provide its own `columns[]` (table template).
- Provide its own `steps[]` (wizard template — replaces the section-clustering default).
- Provide `childTables[]` (details template — see above).
- Override `formSettings` indirectly via `dataLoaderType` choice + the chosen template.

What plans CANNOT do today: replace the template's outer chrome (page-heading, page-content, collapsiblePanel, child-tables tabs block). If the AI needs a truly custom layout (e.g. a 3-column dashboard with a sticky sidebar, or a modal-only mini-form with no chrome), the right path is:

1. Try the closest-fit template anyway — most "weird" requirements still fit `details` (just override fields) or `custom`.
2. If that's genuinely impossible, fall back to **`SKILL-legacy.md`** — the hand-edit GET → mutate → PUT workflow lets the AI author raw markup with no template scaffolding at all.

**Don't bend a plan into a template-shape it doesn't fit.** Use the legacy hand-edit path when the template would actively get in the way. The framework's `organisation-detail-view-example` and `organisation-table-example` (in module A.Test) are the canonical "what good looks like" references; the primary templates now mirror their chrome exactly.

---

## Step 1 — Decide the template

Read what the user wants. One word maps to one template:

| User says (any of) | --template | Entity-bound? |
|---|---|---|
| view / edit / show / open one record / details | `details` | yes |
| list / browse / index / search / table | `table` | yes |
| add / register / new / create | `create` | yes |
| multi-step / KYC / onboarding / application form | `wizard` | yes |
| review / approve / reject / workflow | `approval-flow` | yes |
| change log / who-edited-what / audit | `audit-trail` | yes |
| my profile / self-service / account page | `citizen-profile` | yes |
| upload documents / KYC docs / file checklist | `document-submission` | yes |
| KPIs / overview / departmental landing | `dashboard-departmental` | no |
| printable / A4 / official report | `reports-printable` | no |

Anything else (login, custom layout) → **don't use scaffold.js**. Fall back to `references/SKILL-legacy.md` (`assets/patterns/auth-login.json` for auth).

## Step 2 — Decide entity + module

The user almost always names them (e.g. "scaffold a details form for Person in A.Test"). Capture:

- `--entity=<EntityClassName>` — short PascalCase name like `Person`, `Customer`, `LoanApplication`. scaffold.js resolves it to the fully-qualified type via `EntityConfig/GetAll`.
- `--module=<ModuleName>` — exact module name like `A.Test`, `Shesha`, `PBF.MembershipManagement`. scaffold.js validates it's enabled and editable before any write.

If the user didn't specify a module, ask once via `AskUserQuestion` listing the modules from `Module/GetAll`. Don't guess.

## Step 3 — Resolve backend URL + credentials

Defaults: `--base-url=http://localhost:21021 --username=admin --password=123qwe`.

If those fail with HTTP 401, ask the user once via `AskUserQuestion`. Don't brute-force.

## Step 4 — Run, dry-run first

Run **without `--push`** first to verify the rendered markup. The script prints the full form JSON to stdout. If it exits 0:
- Field selection looks sensible (or pass `--include=` to narrow it).
- No validator errors.

Then re-run with `--push` to actually create the form.

## Step 5 — Report

If scaffold.js exits 0 with a "DONE" line, tell the user the form id and the route (`/dynamic/<module>/<form>` or `/no-auth/<module>/<form>`). Don't add commentary the user didn't ask for.

If scaffold.js exits non-zero, **quote the error verbatim** and check [references/cheatsheet.md](references/cheatsheet.md) for the matching symptom. Don't guess.

---

## Editing existing forms (NOT scaffolding new)

scaffold.js only creates new forms. For edits ("add a sector dropdown to member-create", "make this tab conditional"), follow the legacy workflow in [references/SKILL-legacy.md](references/SKILL-legacy.md): resolve → GET form JSON → edit → autofix → validate → PUT UpdateMarkup → verify.

The same `scripts/autofix.js`, `scripts/validate.js`, and the `shesha-developer:clean-form-config` skill apply.

---

## Cheatsheet

When you hit anything you don't recognise, **read [references/cheatsheet.md](references/cheatsheet.md)**. It's a single ~300-line file covering:
- Template selection
- Form naming regex
- IPropertySetting forms (`_mode: "value"` vs `_mode: "code"`)
- `referenceListId` / `formId` shapes (object, not Guid)
- `refListStatus` exception (flat keys)
- `stylingBox` is a JSON string
- Common API errors and what they mean
- Decision tree when something fails

Don't read the 24-file `references/components/` tree unless cheatsheet.md points you there.

---

## Component properties — always consult clean-form-config

**MANDATORY:** Before writing or editing ANY component JSON (in a plan, a hand-edit, or an example), read the relevant group file from the `shesha-developer:clean-form-config` assets.

**Source — use whichever is accessible:**
1. **Local (preferred):** `<plugin-cache>/shesha-plugins/shesha-developer/<version>/skills/clean-form-config/assets/groups/` — glob for `clean-form-config` under your `.claude/plugins/cache` folder.
2. **GitHub (fallback if local files not found):** https://github.com/shesha-io/shesha-plugins/tree/main/plugins/shesha-developer/skills/clean-form-config — the `assets/groups/` folder contains the same files. Other skills in the repo are also available there.

Lookup workflow:
1. Read `index.json` — it maps every component `type` string to its group file (e.g. `"textField" → "data-entry"`, `"tabs" → "layout"`, `"KeyInformationBar" → "layout"`).
2. Read the group file (e.g. `data-entry.json`) and find the component's entry — it lists every accepted `prop`, its `type`, whether it's `required`, and a `desc`.
3. Only emit props that appear in that list. Never invent props from training data.

**Do this for every component you write**, not just unfamiliar ones. The group files are the authoritative schema; training-data guesses will produce invalid configs that autofix/validate will reject.

---

## Non-negotiables (the rare cases scaffold.js misses)

- **Preserve ids** when editing existing forms — fresh GUIDs only on new components.
- **`editMode: "editable"`** on every interactive component.
- **`referenceListId` / `formId` are `{ name, module }` objects**, never Guids or strings. Exception: `refListStatus` uses flat `module` + `referenceListName`.
- **`stylingBox` is a JSON string**, not an object. autofix.js handles this.
- **`API Call` actions need `handleSuccess: true` AND `handleFail: true`** with both `onSuccess` and `onFail` wired.
- **No `globalState`** for cross-form state — use `contexts.appContext` or `pageContext`.
- **API calls in scripts**: `try/catch` + `async/await` — never `.then()` chains. clean-form-config catches violations.
- **`access: 5`** on anonymous forms (login, register, OTP) — and call `UpdateMarkup` after Create to lock it in.

---

## Folder structure (Shesha v0.45+)

scaffold.js auto-detects the `ConfigurationStudio` API. If the endpoint exists (Shesha v0.45 or newer), **every form is filed into a folder** — there is no opt-in. Default folder convention:

| Template type | Default folder |
|---|---|
| Entity-bound (details, table, create, wizard, approval-flow, audit-trail, citizen-profile, document-submission) | `<EntityPretty>` (e.g. `Person`) |
| Dashboard | `Dashboards` |
| Reports | `Reports` |

Override with `--folder=<path>`. Paths are slash-separated and folders are created recursively if missing (e.g. `--folder=Forms/People` creates both `Forms` and `People`). Existing folders are reused, not duplicated.

Opt out with `--no-folder`. On older Shesha builds (pre-v0.45, no ConfigurationStudio API) scaffold.js detects the 404 and skips foldering silently.

---

## Design tokens (rebrand in one file)

Every scaffolded form's typography, color, spacing, border radius, and shadow comes from `assets/design-tokens.json` — the single source of truth. Default is Claude-aligned (neutral palette, generous whitespace, 8px grid, restrained borders, subtle elevation) and enterprise-safe (no brand-specific colors hardcoded).

To rebrand: edit one value. Examples:
- Set `color.accent` to a brand colour (e.g. `#D97757`) → every primary button, focus ring, link, indicator picks it up.
- Tighten / loosen spacing → adjust `spacing.md` and `spacing.lg`.
- Change the typeface → set `typography.fontFamily` once.

Per-project overrides via `--tokens-file=<path>` (scaffold.js loads from there instead of the default).

The styler (`scripts/styler.js`) walks the rendered tree and applies role-based styling: `button-primary` / `button-secondary` / `button-ghost` / `button-danger`, `input`, `card`, `heading-1` / `heading-2` / `subtitle` / `body`, `sectionHeading`, `tabs`, `keyInfoBar`, `validationErrors`, `table`, `page` / `pageTitle` / `pageContent` / `toolbar`. Role detection is automatic from `type` + `className` + `buttonType`. No manual annotation needed.

---

## Reference lists ("list of values")

Two halves to keep straight:

- **Binding** an existing reference list to a `dropdown` / `radio` / `checkboxGroup` is automatic — scaffold.js emits the right `referenceListId: { module, name }` shape whenever the entity metadata says a property has `referenceListName` + `referenceListModule`. No manual wiring needed.
- **Creating** a new reference list (because none exists for what the user is asking for) — use the bundled CLI:

```
node scripts/reflist.js create --module=<ModuleName> --name=<RefListName> \
  --items='Label1:1,Label2:2,Label3:3' \
  [--folder=Lookups] \
  --base-url=... --username=... --password=...
```

Or list what already exists:

```
node scripts/reflist.js list --module=<ModuleName> --base-url=... --username=... --password=...
```

The CLI is idempotent (re-running skips existing items by name) and requires Shesha v0.45+ (`ConfigurationStudio` API). Older builds: create reference lists via FluentMigrator (a separate skill) or the Shesha designer.

See [references/cheatsheet.md §19](references/cheatsheet.md) for the full shape contracts (including the `refListStatus` flat-keys exception, hardcoded `values` source, status-style refLists with colour/icon, and 6 common pitfalls).

---

## Component property reference

The canonical "what props does this component support" index lives in the **`shesha-developer:clean-form-config`** skill at `assets/groups/*.json`. `scripts/components-index.js` loads it automatically. Never maintain a duplicate copy in this skill.

To inspect props for a single type:

```
node scripts/components-index.js <type>      # e.g. dropdown, entityPicker, refListStatus
```
