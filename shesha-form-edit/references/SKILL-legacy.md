---
name: shesha-form-edit
description: Create and edit Shesha form configurations via the direct API (auth → resolve → fetch markup → edit → autofix → validate → push → verify → smoke). Use when the user provides a form id (or module + name) and requirements like "add a sector dropdown above email", "make the address tab conditional on AccountType=PBF", "wire Save to call /api/.../Submit", "create a new customer-table form", or "scaffold a brand-new branded login page". Handles brand-new forms (with template selection + complementary-form auto-discovery) and edits to existing ones. Replaces the `shesha-forms` MCP path — `create_form_configuration` is unreliable (`'dict' object has no attribute 'lower'`, JSON-RPC `-32602`); ports its standards and validators.
allowed-tools:
  - Bash
  - PowerShell
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - WebFetch
  - Skill
---

# Shesha Form Edit

Round-trip: **resolve → GET form JSON → edit → autofix → validate → PUT/POST**. Also creates new forms (template selection → complementary-form discovery → scaffold → push).

Args received: `$ARGUMENTS`. Flags: `--refresh-cache` (ignore TTL, re-distill metadata/seeds), `--no-browser` (skip Step 9 browser smoke), `--no-design` (skip Step 0 / 9.5 design passes), `--strict` (treat validate warnings as errors).

## Read first

When invoked, **always** read [references/standards.md](references/standards.md) — the non-derivable canonical rules. Then load only the topic files relevant to the current edit per Step 5's routing table.

## Step 0 — Design consultation (ask first)

For brand-new forms or major restructures, **ask the user via `AskUserQuestion`** whether to invoke the `frontend-design` skill for a design plan (typography, palette, spatial system, section list):

> Want a design consultation from the `frontend-design` skill for this form? It returns aesthetic direction (~30s extra) before authoring.
> - **Yes — get a design plan** (recommended for new pages / major restructures)
> - **No — author from seeds only** (good for adding fields, small tweaks, internal forms)

On Yes: invoke `Skill(skill="frontend-design", ...)` per [references/design.md](references/design.md); cache the plan at `.claude/cache/shesha-form-edit/design-plans/<form-name>.md` for Step 9.5.

**Don't ask** (skip silently) for: trivial edits (add a field, fix a script, change a propertyName), bug fixes, row-template / sub-form / utility forms, or when `--no-design` is in `$ARGUMENTS`. If `frontend-design` isn't installed, warn the user once and continue without it.

## Step 1 — Resolve backend URL

Order: project `*.Web.Host/Properties/launchSettings.json` (`profiles.Project.applicationUrl`) → `appsettings.json` (`Kestrel:Endpoints:Http:Url`) → fallback `http://localhost:21021`. Strip trailing slash. Store as `$BASE_URL`. Ping `$BASE_URL/swagger/index.html` to confirm reachability; if it fails, stop and tell the user to start the backend.

## Step 2 — Authenticate as admin

Local-dev defaults: **`admin` / `123qwe`** — don't ask. POST `$BASE_URL/api/TokenAuth/Authenticate` with `{ userNameOrEmailAddress, password }`; extract `result.accessToken` (or `accessToken` on older builds). See [references/api.md §2](references/api.md). If no token, surface raw response and stop.

## Step 3 — Resolve identity (module / form / entity)

Use [references/resolve.md](references/resolve.md) as the decision rulebook.

### 3a. Module preflight

If the user gave a module name, resolve it via `Module/GetAll` and **assert `isEnabled === true` AND `isEditable === true`** before any write. Block with a clear error if either fails.

### 3b. Form lookup

Required: form id **OR** (module + name) **OR** a partial reference + module.

- Id → use directly (`/Get?id=...`).
- Module + exact name → `GetByName` ([api.md §3](references/api.md)).
- Partial reference → `GetAll` with filter + suffix-aware ranking. If >1 candidate, disambiguate via `AskUserQuestion` (max 5 options).

**Update operations require exact-match form lookup.** Never silently target a near-match form — confirm with user.

For a **new form**, validate the proposed name against the regex `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` ([standards.md "Form naming"](references/standards.md)) and ensure uniqueness in the module. Auto-increment `-2`, `-3`, … on collision; reject after 100 collisions.

Store the resolved id as `$FORM_ID`.

## Step 4 — Fetch the current markup

For existing forms: `GET /api/services/Shesha/FormConfiguration/GetJson?id=$FORM_ID` ([api.md §4](references/api.md)). Save to `$env:TEMP\form-current.json`. The response body is the form JSON directly; parse it. Resulting object has top-level `components` (nested tree) and `formSettings`.

For new forms: skip to Step 4.5.

## Step 4.5 — Entity introspection (mandatory for entity-bound forms)

Skip if `formSettings.dataLoaderType === "none"` (dashboard/login/non-bound). Otherwise:

1. Determine the target entity. Existing form: read `formSettings.modelType`. New form: resolve via [resolve.md "Entity resolution"](references/resolve.md) — exact match OR ≥0.9 semantic similarity.
2. Fetch `/Metadata/Get?container=<modelType>` — recipe in [api.md §10](references/api.md). Cache raw to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json`; distill via `summarize.js --type metadata`.
3. **Filter framework properties**: exclude properties where `suppress === true` OR `isFrameworkRelated === true` before using the metadata to drive field selection — see [standards.md](references/standards.md).
4. Note relationships: `references[]` (FK out — drives EntityPicker / Autocomplete) and `referencedBy[]` (FK in — drives child-table embedding on details forms).
5. **Validate `propertyName`** against the summary's property list for every input component you're adding/editing. Surface mismatches before push.

TTL 24h; `--refresh-cache` forces re-fetch. If the metadata fetch returns nothing or surfaces a malformed entity, optionally invoke `Skill(skill="shesha-developer:test-entity-crud-api", args="--no-fix")` and fix entity bugs before continuing — a form bound to a broken entity will look fine in markup but fail at runtime.

## Step 4.6 — Template selection & complementary-form discovery (new forms only)

For brand-new forms, **pick a template** per [templates.md "Template selection matrix"](references/templates.md):

| User says | Template |
|---|---|
| view / edit / show / open one record | `details` |
| list / browse / index / search records | `table` |
| add / register / new | `create` |
| summary / overview / KPIs / charts | `dashboard` |
| popup / quick confirm / modal action | `dialog` |
| anything else | `custom` |

Then run **complementary-form discovery** ([templates.md "Complementary-form auto-discovery"](references/templates.md)):

- New TABLE → search `{entity}-details*` and `{entity}-create*`; wire action column + Add button if found.
- New DETAILS → search `*-subform` and `*-dialog` matching the entity; offer to embed.
- New CREATE → search `{entity}-details*`; wire success navigation.

Query recipe: [api.md §8a](references/api.md) (`GetAll` with `like` filter). Confidence: exact suffix match → wire silently; suffix match with descriptor mismatch → ask; no match → leave a TODO stub and surface to user.

## Step 5 — Apply the user's requirements

### Read order

1. **Always**: [standards.md](references/standards.md) (canonical rules — IDs preserved, refList shape, stylingBox, hallucination fixes, etc.).
2. **For new forms**: [templates.md](references/templates.md) (per-template invariants — what a `details` / `table` / `create` MUST contain).
3. **Topic files** relevant to the specific edit (load 1–3 typically):

| Topic | File |
|---|---|
| Form structure, skeleton, IPropertySetting wrapper, formSettings deep-dive | [references/components/form-shape.md](references/components/form-shape.md) |
| Inputs, validation, file uploads, regex escaping, date formats | [references/components/inputs.md](references/components/inputs.md) |
| Dropdowns / radio / checkboxGroup / refListStatus | [references/components/dropdowns.md](references/components/dropdowns.md) |
| Autocomplete, entityPicker (entityType, filter, items columns) | [references/components/selectors.md](references/components/selectors.md) |
| Containers, card, columns, tabs (card slot rule) | [references/components/containers.md](references/components/containers.md) |
| Buttons, link, action shells | [references/components/actions.md](references/components/actions.md) |
| Action chain library (delete, add-via-dialog, navigate, sign-in, OTP) | [references/action-chains.md](references/action-chains.md) |
| Form lifecycle hooks (onBeforeDataLoad, onSubmitSuccess, etc.) | [references/lifecycle.md](references/lifecycle.md) |
| Datatable, datalist, dataTableContext | [references/components/data-tables.md](references/components/data-tables.md) |
| subForm (formId object, queryParams autogen) | [references/components/sub-form.md](references/components/sub-form.md) |
| KeyInformationBar (max 3, readOnly children, hideLabel) | [references/components/key-info-bar.md](references/components/key-info-bar.md) |
| Embedded scripts, current user, async/try-catch | [references/components/scripts.md](references/components/scripts.md) |
| Shared state (appContext, pageContext) | [references/components/shared-state.md](references/components/shared-state.md) |
| editMode, visibility, permissions | [references/components/edit-mode.md](references/components/edit-mode.md) |
| Layout pattern (full-page forms, auth, id-remap pass) | [references/components/layout.md](references/components/layout.md) |
| Module/entity/form resolution with confidence | [references/resolve.md](references/resolve.md) |

### Seed discovery for new forms (in order)

1. `assets/patterns/` — vendor seeds (index: [references/patterns.md](references/patterns.md)).
2. `.claude/cache/shesha-form-edit/seeds/` — project-specific forms cached from prior edits.
3. `GetAll` ([api.md §8](references/api.md)) — forms in this backend matching the template + entity.
4. Author from scratch only if no seed fits — follow [templates.md](references/templates.md) per-template invariants.

When copying a seed: **always run the id-remap pass** ([components/layout.md](references/components/layout.md)).

### Component scaffolding

**MANDATORY — read the component schema before writing any component JSON:**

The `shesha-developer:clean-form-config` assets are the authoritative property schema for every Shesha component.

Source — use whichever is accessible:
- **Local (preferred):** glob for `clean-form-config` under `.claude/plugins/cache`, then open `assets/groups/`
- **GitHub (fallback if local not found):** https://github.com/shesha-io/shesha-plugins/tree/main/plugins/shesha-developer/skills/clean-form-config → `assets/groups/`. Other skills in the repo are also browsable from https://github.com/shesha-io/shesha-plugins/tree/main/plugins/shesha-developer/skills

Lookup:
1. `index.json` maps `type` → group file (e.g. `"autocomplete" → "advanced"`, `"tabs" → "layout"`, `"KeyInformationBar" → "layout"`).
2. Open that group file, find the component, read every `prop` with its `type`, `required`, and `desc`.
3. Emit **only** those props. Never invent props from training data — autofix and validate will reject unknown keys.

Do this for **every** component you write or edit, not just unfamiliar ones. The group files are the version-accurate schema; the topic files in Step 5's read-order table are still useful for context but do not override the group-file schema.

When authoring new components, merge defaults from [`assets/component-defaults.json`](assets/component-defaults.json) **before** the user-specified overrides. This mirrors the MCP's transformer output so new components have the keys the runtime expects.

### Proactive doc fetch

When the user's requirements mention non-trivial mechanisms (wizard, OTP, navigator, complex appContext composition, custom action chaining, kanban, charts), `WebFetch` the relevant `shesha-grads.vercel.app` / `docs.shesha.io` page **before** writing scripts. Distill into `.claude/cache/shesha-form-edit/docs/<topic>.summary.md` (~30 lines) so subsequent edits don't re-fetch.

### Tree-editing principles

- Preserve every existing component's `id` and `parentId` (fresh GUIDs only on clones / new nodes).
- When re-parenting, update only the moved node and add it to the new parent's `components`.
- Don't touch `formSettings` unless asked — see [standards.md "What the skill is allowed to change in formSettings"](references/standards.md).
- Match array order to intended tab/visual order.
- When in doubt, mirror the closest existing form and stop. (Don't gold-plate.)

## Step 6 — Autofix, then validate

### 6a. Autofix (deterministic transformer fixes)

Run **`scripts/autofix.js`** on the edited form — applies:

```
node .claude/skills/shesha-form-edit/scripts/autofix.js <path> --inplace
```

- Global-deref dedupe (`form.form.X` → `form.X`, `data.data.X` → `data.X`).
- `stylingBox` stringification (object → JSON string).
- Per-breakpoint style sanitisation (non-null `border` / `background` / `font` / `dimensions` / `shadow`).
- DataTableContext `actionOwner` resolution (componentName → id).
- `required: true` → `validate.required` normalisation.

Idempotent — safe to run multiple times.

### 6b. Validate (MCP-derived structural checks)

Run **`scripts/validate.js`**:

```
node .claude/skills/shesha-form-edit/scripts/validate.js <path> [--name <form-name>] [--strict]
```

Checks: form-name regex (when `--name` given), unique ids, parentId chain, component-specific required props (entityPicker.entityType, dropdown.referenceListId as `{ name, module }`, datatableContext.entityType, subForm.formId as object, refListStatus flat keys), IPropertySetting shape, editMode on interactive nodes, dropdown values shape.

### 6c. clean-form-config (mandatory, blocking)

```
Skill(skill="shesha-developer:clean-form-config", args="<path>")
```

Covers layout overflow, label-vs-propertyName refs, missing try/catch, missing async, broken script syntax — complementary to validate.js.

**Never push a config that fails validation without user confirmation.** If `validate.js` exits 1 OR `clean-form-config` reports issues, present to user and ask before pushing.

## Step 7 — Push

### New form: Create + UpdateMarkup

1. `POST /FormConfiguration/Create` with `{ moduleId, name, label?, modelType? }` ([api.md §7](references/api.md)).
2. `PUT /FormConfiguration/UpdateMarkup` with the scaffolded markup. The `Create` endpoint may not honor `access` / `markup` on initial create — always call `UpdateMarkup` after.

### Existing form: UpdateMarkup

`PUT $BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup`, body `{ "id": "$FORM_ID", "markup": "<stringified form JSON>" }`. Build the body in Node to avoid escaping pain. See [api.md §5](references/api.md).

Alternative: **ImportJson** — multipart upload (`ItemId` + `file`). See [api.md §6](references/api.md). Both write `Markup` on the form configuration.

Success: HTTP 200 with `{ "result": ... }`.

### Strip metadata keys before push

The MCP strips the top-level `module` key from JSON markup before persisting (it's record metadata, not markup). Mirror this: the markup you send should contain only `components` and `formSettings`, never `module`/`name`/`type`/`frontEnd`.

### On push failure (any non-200)

1. Surface the raw response and a short diagnosis (cross-reference [api.md §9](references/api.md) common errors).
2. Ask the user via `AskUserQuestion`: **retry as-is** / **re-fetch and re-apply** / **abort**.
3. Act on the choice. **Never silently retry. Never just stop.**

## Step 8 — Verify

Re-fetch via `GetByName`/`GetJson`; diff against what you sent. Surface any normalization the server applied. For anonymous forms (`access: 5`), confirm `result.access === 5` — the `Create` endpoint may not honor `access` on initial create; call `UpdateMarkup` once more if it didn't stick.

## Step 9 — Browser smoke (default; `--no-browser` opts out)

Invoke the playwright skill to load the form, screenshot, and capture console + network errors that JSON validation can't catch (editMode regressions, runtime script failures, broken layout). Recipe in [api.md §12](references/api.md):

```
Skill(skill="playwright", args="<directive from api.md §12, with FRONTEND_URL + form path filled in>")
```

Frontend URL: derived from the project — read the dev port from `<app>/.env*` or `<app>/package.json`. Authenticated forms render at `/dynamic/<module>/<form>`; anonymous at `/no-auth/<module>/<form>`. If no front-end is running, skip the smoke step and warn the user.

**For `/dynamic/...` routes the playwright directive MUST drive the actual `/login` form** — token-in-localStorage injection leaves the SPA stuck on "Initializing…". See [api.md §12 "Authentication"](references/api.md). Credentials must be email format (frontend regex rejects bare usernames); the default Shesha admin email is `admin@shesha.io` / `123qwe`, but if the project's admin user has `emailAddress: null`, ask the user for working test credentials rather than guessing.

**On any captured error or 4xx/5xx**: consult [references/debug.md](references/debug.md) before guessing — 30 rows map common symptoms to causes. Quote the captured error verbatim; reference the matching row number.

## Step 9.5 — Aesthetic review (ask first; skip if `--no-design` or no Step 0 plan)

If a design plan exists for this form, **ask the user via `AskUserQuestion`** whether to run a post-render aesthetic critique:

> Run an aesthetic review on the rendered form via `frontend-design`? It compares the screenshot against the design plan and returns up to 5 prop-level tweaks.
> - **Yes — review and suggest tweaks**
> - **No — confirm and finish**

On Yes: pass screenshot + plan + original requirements to `frontend-design`. Surface findings as **suggestions, not blockers** — accept/reject per item; on accept, loop back to Step 5 → 6 → 7 → 8 → 9. Recipe: [references/design.md](references/design.md).

## Step 10 — Confirm

Tell the user: form `$FORM_ID` (`<module>/<name>`) updated. Authenticated forms render at `/dynamic/<module>/<form>`; anonymous at `/no-auth/<module>/<form>`. For new forms, also mention which complementary forms (if any) were auto-wired.

---

## Cache (`.claude/cache/shesha-form-edit/`)

Project-scoped learning state. **Skill reads `.summary.md` by default; opens raw `.raw.json` only when summary is insufficient.** Layout: `metadata/`, `seeds/`, `docs/`, `entities/`, `modules/`, `forms/`, `design-plans/`, `_archive/`. Populate via `node .claude/skills/shesha-form-edit/scripts/summarize.js <input.json> [--out <out.summary.md>]`. TTLs: metadata 24h; entities 24h; modules 1h; forms 15min; seeds invalidate on `versionNo` change. `--refresh-cache` ignores TTL.

## Non-negotiables

- **Preserve ids** on existing components — fresh GUIDs only on clones / new nodes.
- **`editMode: "editable"`** on every interactive component — see [components/edit-mode.md](references/components/edit-mode.md).
- **Form name regex** `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` — validate before any LLM/API work.
- **Module preflight**: `isEnabled === true` AND `isEditable === true` before any write.
- **Update lookups are exact-match only** — never silently target a near-match form.
- **`API Call` actions** MUST set `handleSuccess: true` AND `handleFail: true` with both `onSuccess` and `onFail` wired ([action-chains.md](references/action-chains.md)).
- **`referenceListId`, `formId`** are `{ name, module }` objects — never Guids, never strings. (Exception: `refListStatus` uses flat `module` + `referenceListName`.)
- **`stylingBox` is a JSON string**, not an object.
- **`dataTableContext.actionOwner`** is the context's `id`, not its `componentName`. `scripts/autofix.js` resolves it.
- **No `globalState`** for cross-form state. Default to `contexts.appContext` (app-wide) or `pageContext` (inter-page). `localStorage` / `sessionStorage` only when state must survive a hard refresh AND the data is not sensitive — see [shared-state.md](references/components/shared-state.md).
- **API calls in scripts**: `try/catch` + `async/await` (no `.then()` chains) — see [scripts.md](references/components/scripts.md).
- **No doubled global derefs**: `form.formMode` not `form.form.formMode`; `data.X` not `data.data.X`. `scripts/autofix.js` deduplicates.
- **`access: 5`** on anonymous forms (login, register, OTP). Verify post-push via re-fetch.
- **Strip the top-level `module` key** from markup before pushing — it's record metadata.
- **PowerShell + non-ASCII body**: pass UTF-8 bytes — em dashes / curly quotes trigger server 500. Use `[System.Text.Encoding]::UTF8.GetBytes($jsonBody)` or `curl --data-binary @file`. Recipe in [api.md](references/api.md).
- **Don't gold-plate** — don't introduce abstractions, wrapper containers, or scripts the user didn't ask for.

## Doc fallback

When you hit an unfamiliar API / component / action, fetch docs first via `WebFetch` instead of guessing — `https://shesha-grads.vercel.app/docs/` for practical how-to ("how do I X"), `https://docs.shesha.io/` for canonical contracts ("what is the contract for X"). Quote field names and gotchas verbatim; cache distillates in `.claude/cache/shesha-form-edit/docs/<topic>.summary.md`. If docs don't cover it, `GetByName` an existing form in the same backend and grep. If the token expires (24h default), re-run Step 2.
