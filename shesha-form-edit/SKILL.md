---
name: shesha-form-edit
description: Create and edit Shesha form configurations via the direct API (auth → fetch markup → edit → validate → push). Use when the user provides a form id (or module + name) and requirements like "add a sector dropdown above email", "make the address tab conditional on AccountType=PBF", "wire Save to call /api/.../Submit", or "create a new branded login page using the auth-login pattern". Handles brand-new forms (Create + UpdateMarkup) and edits to existing ones. Prefer over the `shesha-forms` MCP path — its `create_form_configuration` is unreliable (`'dict' object has no attribute 'lower'`, JSON-RPC `-32602`).
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

Round-trip: **GET form JSON → edit → PUT/POST it back**. Also creates new forms (`Create` then `UpdateMarkup`).

Args received: `$ARGUMENTS`. Flags: `--refresh-cache` (ignore TTL, re-distill metadata/seeds), `--no-browser` (skip Step 9 browser smoke), `--no-design` (skip Step 0 / 9.5 design passes).

## Step 0 — Design consultation (ask first)

For brand-new forms or major restructures, **ask the user via `AskUserQuestion`** whether to invoke the `frontend-design` skill for a design plan (typography, palette, spatial system, section list):

> Want a design consultation from the `frontend-design` skill for this form? It returns aesthetic direction (~30s extra) before authoring.
> - **Yes — get a design plan** (recommended for new pages / major restructures)
> - **No — author from seeds only** (good for adding fields, small tweaks, internal forms)

On Yes: invoke `Skill(skill="frontend-design", ...)` per [references/design.md](references/design.md); cache the plan at `.claude/cache/shesha-form-edit/design-plans/<form-name>.md` for Step 9.5.

**Don't ask** (skip silently) for: trivial edits (add a field, fix a script, change a propertyName), bug fixes, row-template / sub-form / utility forms, or when `--no-design` is in `$ARGUMENTS`. If `frontend-design` isn't installed, warn the user once and continue without it.

## Step 1 — Resolve backend URL

Order: `src/PBF.MembershipManagement.Web.Host/Properties/launchSettings.json` (`profiles.Project.applicationUrl`) → `appsettings.json` (`Kestrel:Endpoints:Http:Url`) → fallback `http://localhost:21021`. Strip trailing slash. Store as `$BASE_URL`. Ping `$BASE_URL/swagger/index.html` to confirm reachability; if it fails, stop and tell the user to start the backend.

## Step 2 — Authenticate as admin

Local-dev defaults: **`admin` / `123qwe`** — don't ask. POST `$BASE_URL/api/TokenAuth/Authenticate` with `{ userNameOrEmailAddress, password }`; extract `result.accessToken` (or `accessToken` on older builds). See [references/api.md §2](references/api.md). If no token, surface raw response and stop.

## Step 3 — Identify the form

Required: form id **OR** (module + name). Ask the user only what's missing:

> Which form? Either give me the **id** (Guid), or **module + name** (e.g. `PBF.MembershipManagement` + `member-create`).

If module + name only, resolve via `GetByName` ([api.md §3](references/api.md)). Store as `$FORM_ID`.

## Step 4 — Fetch the current markup

`GET /api/services/Shesha/FormConfiguration/GetJson?id=$FORM_ID` ([api.md §4](references/api.md)). Save to `$env:TEMP\form-current.json`. The response body is a stringified form JSON; parse it. Resulting object has top-level `components` (nested tree) and `formSettings`.

## Step 4.5 — Entity introspection (mandatory for entity-bound forms)

Skip if `formSettings.dataLoaderType === "none"`. Otherwise fetch the entity's metadata and validate every `propertyName` in the edit:

1. Read `formSettings.modelType` from the form (Step 4).
2. Fetch `/Metadata/Get?container=<modelType>` — recipe in [api.md §10](references/api.md). Cache raw to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json`; distill via `summarize.js --type metadata`.
3. **Validate `propertyName` against the summary's property list** for every input component you're adding/editing. Surface mismatches before push.

TTL 24h; `--refresh-cache` forces re-fetch. If the metadata fetch returns nothing or surfaces a malformed entity, optionally invoke `Skill(skill="shesha-developer:test-entity-crud-api", args="--no-fix")` and fix entity bugs before continuing — a form bound to a broken entity will look fine in markup but fail at runtime.

## Step 5 — Apply the user's requirements

**Component properties come exclusively from `clean-form-config` assets — do not guess, do not use memory, do not use any other reference file.** The authoritative source is:

```
C:\Users\Lethabo\.claude\plugins\cache\shesha-plugins\shesha-developer\1.7.1\skills\clean-form-config\assets\groups\
```

Read `index.json` to map component type → group file, then read the group file for valid prop names and types. Only set properties that appear in the group file definition. Any property not in the group file will be silently stripped by the server or crash the renderer.

**Seed discovery for new forms** (in this order):
1. `assets/patterns/` — vendor seeds (index: [references/patterns.md](references/patterns.md)).
2. `.claude/cache/shesha-form-edit/seeds/` — project-specific forms cached from prior edits.
3. **MCP `search_forms`** — query `mcp__shesha__search_forms` for forms in this backend matching the layout type (e.g. "auth", "edit", "dashboard"). Use the closest match as a seed; cache it under `seeds/` for next time.
4. Author from scratch only if no seed fits — guided by the design plan from Step 0.

**Proactive doc fetch**: when the user's requirements mention non-trivial mechanisms (wizard, OTP, navigator, complex appContext composition, custom action chaining), `WebFetch` the relevant `shesha-grads.vercel.app` / `docs.shesha.io` page **before** writing scripts. Distill into `.claude/cache/shesha-form-edit/docs/<topic>.summary.md` (~30 lines) so subsequent edits don't re-fetch.

**Component plan + index check (mandatory, blocking — do this before writing any component JSON)**:

For every new or edited form, before writing a single component object:

1. **List every component `type` you plan to use.** (e.g. for a table form: `container`, `text`, `button`, `datatableContext`, `datatable`)

2. **Confirm each type exists** in the `clean-form-config` component index:
   ```
   C:\Users\Lethabo\.claude\plugins\cache\shesha-plugins\shesha-developer\1.7.1\skills\clean-form-config\assets\groups\index.json
   ```
   If a type is missing, you have the wrong name. The index is the authoritative source for the exact `type` string used in form JSON (e.g. `datatableContext` not `dataTableContext`; `datatable` not `dataTable`).

3. **Load the group file** for each component type (the index maps type → group file). Read the group file to get the full list of valid property names, their expected types, and descriptions. Only use properties listed there — anything else will be stripped by `clean-form-config` at Step 6.

4. **Scan the group for alternatives.** While in the group file, check whether a better-fit component exists (e.g. `refListStatus` instead of `dropdown` for read-only status display, `columns` instead of nested `container` for side-by-side layout).

5. **Update the plan** with corrected type names, valid properties, and any swapped alternatives — then write the JSON.

Tree-editing principles:
- **Every component must have `parentId`** set to its direct parent component's `id`. Root-level components get `parentId: "root"`. Components inside column slots get `parentId` = the `columns` component's `id` (not the slot's id). Missing `parentId` crashes the Shesha renderer entirely.
- Preserve every existing component's `id` — fresh GUIDs only on new nodes.
- When re-parenting, update only the moved node; don't touch `formSettings` unless asked.

## Step 6 — Validate

Walk tree (unique ids, valid types, valid parent chain); dead-prop check against `assets/component-properties.json`; runtime-type checks (booleans not `"true"`, numbers not `"42"`); dropdown `values` shape (`{ id, label, value }`); `node --check` each script string.

### clean-form-config (mandatory, blocking — two-path protocol)

**Path A — skill available (preferred):**

```
Skill(skill="shesha-developer:clean-form-config", args="<path to your edited form>")
```

Invoke this for **every form you author or edit**, no exceptions. It covers layout overflow, label-vs-propertyName refs, missing try/catch, missing async, broken script syntax, and invalid property names.

**Do NOT skip it because the form is "simple" or "just a table" — those are exactly the forms where wrong column names and missing editMode slip through.**

**Path B — skill unavailable or returns invocation error:**

If the Skill tool is unavailable or the `shesha-developer:clean-form-config` invocation itself errors (not a form-content error — an invocation failure), fall back to manual group-file validation:

1. For every component `type` in your form, open its group file from:
   ```
   C:\Users\Lethabo\.claude\plugins\cache\shesha-plugins\shesha-developer\1.7.1\skills\clean-form-config\assets\groups\<group>.json
   ```
   (Use the `index.json` in that folder to map type → group file.)

2. For each component instance, walk every property you set and confirm it exists in the group file definition. Remove any property that is not listed — unknown props are silently stripped by the server and can mask bugs.

3. For interactive components (`textField`, `dropdown`, `button`, `entityPicker`, `checkbox`, etc.), confirm `editMode: "editable"` is present.

4. For `datatableContext`, confirm `entityType` and `sourceType` are set on the **context**, not on the inner `datatable`.

5. Log your manual check as a bullet list in your response so the user can audit it.

**Either path must complete before Step 7.** If validation finds issues, present them to the user before pushing. **Never push a config that fails validation without user confirmation.**

## Step 7 — Push

Default: **UpdateMarkup** — `PUT $BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup`, body `{ "id": "$FORM_ID", "markup": "<stringified form JSON>" }`. Build the body in Node to avoid escaping pain. See [api.md §5](references/api.md).

Alternative: **ImportJson** — multipart upload (`ItemId` + `file`). See [api.md §6](references/api.md). Both write `Markup` on the form configuration.

Success: HTTP 200 with `{ "result": ... }`.

### On push failure (any non-200)

1. Surface the raw response and a short diagnosis.
2. Ask the user via `AskUserQuestion`: **retry as-is** / **re-fetch and re-apply** / **abort**.
3. Act on the choice. **Never silently retry. Never just stop.**

## Step 8 — Verify

Re-fetch via `GetByName`/`GetJson`; diff against what you sent. Surface any normalization the server applied. For anonymous forms (`access: 5`), confirm `result.access === 5` — the `Create` endpoint may not honor `access` on initial create; call `UpdateMarkup` once more if it didn't stick.

## Step 9 — Browser smoke (default; `--no-browser` opts out)

Invoke the playwright skill to load the form, screenshot, and capture console + network errors that JSON validation can't catch (editMode regressions, runtime script failures, broken layout). Recipe in [api.md §12](references/api.md):

```
Skill(skill="playwright", args="<directive from api.md §12, with FRONTEND_URL + form path filled in>")
```

Frontend URL: `adminportal/` (auth forms) or `publicportal/` (anonymous) — read the dev port from `<app>/.env*` or `<app>/package.json`. If neither front-end is running, skip the smoke step and warn the user.

**On any captured error or 4xx/5xx**: consult [references/debug.md](references/debug.md) before guessing — it maps common symptoms to causes. Quote the captured error verbatim; reference the matching row number.

## Step 9.5 — Aesthetic review (ask first; skip if `--no-design` or no Step 0 plan)

If a design plan exists for this form, **ask the user via `AskUserQuestion`** whether to run a post-render aesthetic critique:

> Run an aesthetic review on the rendered form via `frontend-design`? It compares the screenshot against the design plan and returns up to 5 prop-level tweaks.
> - **Yes — review and suggest tweaks**
> - **No — confirm and finish**

On Yes: pass screenshot + plan + original requirements to `frontend-design`. Surface findings as **suggestions, not blockers** — accept/reject per item; on accept, loop back to Step 5 → 8 → 9. Recipe: [references/design.md](references/design.md).

## Step 10 — Confirm

Tell the user: form `$FORM_ID` updated. Authenticated forms render at `/dynamic/<module>/<form>`; anonymous at `/no-auth/<module>/<form>`.

## Cache (`.claude/cache/shesha-form-edit/`)

Project-scoped learning state. **Skill reads `.summary.md` by default; opens raw `.raw.json` only when summary is insufficient.** Layout: `metadata/`, `seeds/`, `docs/`, `_archive/` — see `.claude/cache/shesha-form-edit/README.md`. Populate via `node .claude/skills/shesha-form-edit/scripts/summarize.js <input.json> [--out <out.summary.md>]`. TTLs: metadata 24h; seeds invalidate on `versionNo` change. `--refresh-cache` ignores TTL.

## Non-negotiables

- **`parentId` on every component** — set to the parent's `id`; root components get `"root"`. Missing `parentId` crashes the renderer.
- **Preserve ids** on existing components — fresh GUIDs only on new nodes.
- **`editMode: "editable"`** on every interactive component (textField, dropdown, button, entityPicker, checkbox, etc.).
- **Only use props from clean-form-config group files** — any unknown prop is silently stripped by the server or causes a crash.
- **`actionConfiguration.actionArguments.target`** for Navigate — not `configData.target`.
- **No `globalState`** for cross-form state — use `contexts.appContext` (app-wide) or `pageContext` (inter-page).
- **API calls in scripts**: `try/catch` + `async/await` (no `.then()` chains).
- **`access: 5`** on anonymous forms (login, register, OTP). Verify post-push via re-fetch.
- **PowerShell + non-ASCII body**: pass UTF-8 bytes. Use `[System.Text.Encoding]::UTF8.GetBytes($jsonBody)` or `curl --data-binary @file`. Recipe in [api.md](references/api.md).

## Doc fallback

When you hit an unfamiliar API / component / action, fetch docs first via `WebFetch` instead of guessing — `https://shesha-grads.vercel.app/docs/` for practical how-to ("how do I X"), `https://docs.shesha.io/` for canonical contracts ("what is the contract for X"). Quote field names and gotchas verbatim; cache distillates in `.claude/cache/shesha-form-edit/docs/<topic>.summary.md`. If docs don't cover it, `GetByName` an existing form in the same backend and grep. If the token expires (24h default), re-run Step 2.
