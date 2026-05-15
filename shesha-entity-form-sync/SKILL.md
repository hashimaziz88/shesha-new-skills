---
name: shesha-entity-form-sync
description: Rebuilds Shesha form configurations for RequirementsStudio entities to match the current domain model. Reads entity .cs files, maps properties to form components, and applies a standardised improved layout with sections, 2-column rows, and tabbed M:M collections. Use when entity properties have changed and forms need updating, when forms are missing fields, or when the user asks to "sync forms with entities", "update entity forms", "fix form layout", "refresh forms", or "improve forms for entities".
---

# Shesha Entity Form Sync

Rebuilds form configurations for all (or selected) RequirementsStudio entity forms so they exactly match the current domain model with an improved standardised layout.

## Prerequisites

- Shesha MCP connected (`mcp__shesha__*` tools available)
- Backend running at `http://localhost:21021` (check `appsettings.json`)
- Entity `.cs` files up to date in `backend/src/Module/Shesha.RequirementsStudio.Domain/Domain/`

Before proceeding, ping the backend:
```powershell
try { Invoke-WebRequest -Uri "http://localhost:21021/api/services/app/Session/GetCurrentLoginInformations" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop | Out-Null; Write-Host "OK" } catch { Write-Host "Backend not running" }
```

## Workflow

### Step 1 — Determine scope

Ask which entities to update, or default to all if user says "all forms":
- All 18 entities, or a named subset
- Entity list: `BaseProject`, `ProjectsDefinition`, `ModuleDefinition`, `ReleaseDefinition`, `EntityDefinition`, `ViewDefinition`, `ViewRequirement`, `RoleDefinition`, `MenuDefinition`, `ServiceDefinition`, `ApiDefinition`, `BackgroundJobDefinition`, `NotificationDefinition`, `ConfigDefinition`, `ReportDefinition`, `OtherRequirement`, `RefListDefinition`, `RefListItemDefinition`

### Step 2 — Read entity properties

For each target entity, read the corresponding `.cs` file:
```
backend/src/Module/Shesha.RequirementsStudio.Domain/Domain/{EntityFolder}/{EntityName}.cs
```

Extract all `public virtual` properties. See [references/field-component-map.md](references/field-component-map.md) for the property-type → component-type mapping.

### Step 3 — Find existing forms via MCP

Use `mcp__shesha__search_forms` to find forms for each entity. Search by the entity class name (e.g. `ModuleDefinition`). Note the form `id`, `module`, and `name` for each result.

If no form exists for an entity, skip it (do not create new forms — that is out of scope for this skill).

### Step 4 — Build the updated markup

Construct the form `components` array using the standard layout below. See [references/field-component-map.md](references/field-component-map.md) for exact JSON for each component type.

**Standard layout (apply to every entity form):**

```
1. SECTION SEPARATOR — "Project Context"
   COLUMNS (2):
     Left:  BaseProject  (entityPicker, required)
     Right: Project      (entityPicker, required)
   COLUMNS (2):
     Left:  Module  (entityPicker, nullable) — omit if entity has no Module property
     Right: Release (entityPicker, nullable) — omit if entity has no Release property

2. SECTION SEPARATOR — "Details"
   COLUMNS (2):
     Left:  Name   (textField, required) — omit if entity has no Name property
     Right: Status (dropdown, refList)   — omit if entity has no Status property
   [Entity-specific fields — see rules below]

3. SECTION SEPARATOR — "DevOps"  — omit entire section if entity has no ExistsInDevOps
   COLUMNS (2):
     Left:  ExistsInDevOps (dropdown)
     Right: DevOpsWiUrl    (textField/url)

4. TABS — "Relationships"  — omit if entity has NO IList<> collection properties
   One tab per IList<> property, each containing a dataTable
```

**Entity-specific fields placement rules (inside "Details" section):**
- `bool` fields → 2-column row, grouped together
- `string [≤200]` fields → 2-column row with related fields; group thematically
- `string [>200]` or `multilineText` fields → full-width (single column), after the 2-col rows
- `RefList` dropdown fields → 2-column row, grouped with related fields
- FK navigation properties (not BaseProject/Project/Module/Release) → 2-column row as entityPicker
- Non-standard FK pickers (e.g. `CentralEntity`, `BaseClass`, `ServiceToBuildOn`) → place in Details

### Step 5 — Update via MCP

Use `mcp__shesha__update_form_configuration` with the rebuilt `components` array.

For each form: show a summary of what changed (added components, removed components, layout changes) then apply.

### Step 6 — Verify

After updating, call `mcp__shesha__get_form_test_url` to get the test URL for each updated form and report it to the user.

## Important rules

- Generate a fresh UUID (e.g. via `[guid]::NewGuid()` in PowerShell or `uuid.uuid4()` in Python) for every component `id` — never reuse IDs across forms.
- `propertyName` must be **camelCase** matching the C# property name with first letter lowercased (e.g. `BaseProject` → `baseProject`, `ExistsInDevOps` → `existsInDevOps`).
- Never add components for `BaseProject` FK and `Project` FK duplicates — they always appear once in the "Project Context" section.
- Skip `BaseProjectId`, `ProjectId`, `ModuleId`, `ReleaseId` scalar ID columns — use the navigation property name instead.
- For RefList dropdowns, the reference list path is `Shesha.RequirementsStudio/{EnumNameWithoutRefListRs}` (e.g. `RefListRsStatus` → `Shesha.RequirementsStudio/RsStatus`).
- For IList<> collections: use `dataTable` with the entity type path as the `entityType`.

See [references/field-component-map.md](references/field-component-map.md) for all JSON templates.
