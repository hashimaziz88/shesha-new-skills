---
name: airtable-migration
description: >
  Migrates Airtable requirements-matrix data into the Shesha RequirementsStudio backend.
  Use this skill when the user asks to migrate, sync, or import data from Airtable into the
  application, or when running any of the four migration phases: schema analysis, mapping review,
  migration execution, or balancing report generation. Reads configuration from
  migration.config.json in the project root.
---

# Airtable → Shesha Migration

## Zero Data Loss Policy

**No Airtable field may be silently dropped.** Every field in every Airtable table MUST be accounted for in `references/entity-map.json` — either:
- **Mapped**: listed in `fields`, `fk_fields`, or `mm_fields` with a concrete Shesha property
- **Explicitly skipped**: listed in `skip_fields_by_table` with a documented reason

Fields are only acceptable in `skip_fields_by_table` when:
1. They are **reverse-link fields** (Airtable computed back-references with no data of their own), OR
2. They are **attachment blobs** (`multipleAttachments`) with no corresponding `StoredFile` property, OR
3. The data has been confirmed by the user as not needed in Shesha

If a property is added to a Shesha entity AFTER records have already been migrated, use `--reconcile` to back-fill the missing data into already-existing records.

## Overview

Five phases — run them in order, but each is independently re-runnable:

| Phase | Command | Output |
|---|---|---|
| 1. Analyze | `python .claude/skills/airtable-migration/scripts/analyze.py` | `migration-state/{base-name}/mapping-report.md` |
| 2. Review | User + Claude review and fix issues | Updated entity files / enum-map.json |
| 3. Migrate | `python .claude/skills/airtable-migration/scripts/migrate.py` | `migration-state/{base-name}/balancing-report.md` |
| 3b. Reconcile | `python .claude/skills/airtable-migration/scripts/migrate.py --reconcile` | Updates existing records with new/missing fields |
| 4. Report | Read balancing-report.md | Summary to user |

All scripts run from the **project root** (where `migration.config.json` lives). Every output file is written into `migration-state/{base-name}/` — one folder per Airtable base, keeping multi-base runs cleanly separated.

## Prerequisites

```powershell
pip install requests   # only dependency beyond stdlib
```

Check `migration.config.json` has: `airtable_pat`, `airtable_base_id`, `shesha_url`, `shesha_username`, `shesha_password`, `module_namespace`.

## Phase 1: Schema Analysis

```powershell
python .claude/skills/airtable-migration/scripts/analyze.py
```

- Fetches live Airtable schema and compares against `references/entity-map.json`
- Outputs `migration-state/{base-name}/mapping-report.md` — read this with the user
- Outputs `migration-state/{base-name}/field-issues.json` — machine-readable for debugging

**Read the report and take action on ALL issues before proceeding.** The zero data loss policy means no field may be left unmapped without explicit documented justification.

### Issue Type A — Enum value mismatch
Airtable has a singleSelect option not in `references/enum-map.json`.

**Options (ask user):**
1. Add a new value to the Shesha C# enum + create a migration → then add mapping to `enum-map.json`
2. Map to the closest existing value → update `enum-map.json` directly
3. Accept null (data loss — only if user explicitly confirms this value is not needed)

### Issue Type B — Unmapped Airtable field
Field exists in Airtable but has no Shesha property. **Per zero data loss policy, this requires action.**

**Options (ask user):**
1. Add a new property to the entity class + create a migration → add to `entity-map.json`
2. If the field is a reverse-link or attachment blob with no entity property → add to `skip_fields_by_table` with a comment

Reverse-link fields (e.g., "Used by Views", "Used by Background Jobs") are safe to skip because the link is captured from the other side (e.g., ViewDefinition.RequiredApis).

### Issue Type C — Multiple links where Shesha has single FK
E.g., Airtable "Module" is `multipleRecordLinks` but `ViewDefinition.Module` is a single FK. The migration takes only the FIRST linked record.

**Options (ask user):**
1. Change entity to `IList<T>` + junction entity + migration (big change)
2. Accept first-only behaviour (warn user about potential data loss)

### Issue Type D — Schema divergence across bases
Each of the 20+ Airtable bases may have different table/field names or extra columns.

Create a `migration-state/overrides.json` to override mappings for this specific base:
```json
{
  "field_aliases": {
    "Modules": { "Module Name": "Name" }
  },
  "extra_skip_fields": {
    "Views": ["Legacy Field"]
  }
}
```
Then pass `--map migration-state/custom-map.json` if a fully custom map is needed.

## Phase 2: Review & Fix

After reviewing the report, make code changes if needed:

- **Add enum values**: Edit the relevant `RefListRs*.cs` enum file, add the new value, create a migration (use `domain-model` skill), then add the integer mapping to `references/enum-map.json`
- **Add entity properties**: Use the `domain-model` skill to add properties and create migrations
- **Update field mapping**: Edit `references/entity-map.json` (add fields to `fields`, `fk_fields`, or `mm_fields`, or to `skip_fields_by_table`)

Confirm the backend has been restarted and builds successfully before Phase 3.

## Phase 3: Migration Execution

```powershell
# Dry run first — validates transforms without writing to Shesha
python .claude/skills/airtable-migration/scripts/migrate.py --dry-run

# Live migration
python .claude/skills/airtable-migration/scripts/migrate.py

# Migrate single table (for debugging or partial re-runs)
python .claude/skills/airtable-migration/scripts/migrate.py --table "Notifications"
```

**Two-pass strategy:**
- **Pass 1**: Creates all entity records with simple fields + FK references. Saves Airtable ID → Shesha GUID in `migration-state/id-map.json`
- **Pass 2**: Creates all M:M junction entity records using the ID map

**Restartability**: Already-migrated records (found in `id-map.json`) are skipped. Safe to re-run after failures.

## Phase 3b: Reconcile (Back-fill Missing Fields)

Use `--reconcile` when a new entity property was added AFTER the initial migration and existing records need to be updated with the missing data.

```powershell
# Reconcile all tables
python .claude/skills/airtable-migration/scripts/migrate.py --reconcile

# Reconcile a single table (e.g., after adding Mechanism to NotificationDefinition)
python .claude/skills/airtable-migration/scripts/migrate.py --reconcile --table "Notifications"
```

**How reconcile works:**
- For records already in `id-map.json`: calls UPDATE (not CREATE) with the current full field mapping
- For records NOT yet in `id-map.json`: creates them normally
- Pass 2 (junction creation): only runs for newly-created records — already-migrated records are skipped to prevent duplicate junctions

**When to reconcile:**
- A `multiselect_enum` or `multiselect_text` field was added to `entity-map.json` after migration
- A new entity property was added and records need the back-filled value
- The `mechanism` field on `NotificationDefinition` was populated after initial migration

## Phase 4: Balancing Report

Reports are saved to `migration-state/{base-name}/balancing-report.md` (a folder per base keeps multi-base runs organised). A top-level copy is also written to `migration-state/balancing-report.md` for quick access.

After migration, read the report and present a summary:
- Source record count vs inserted/updated count per table
- Number of failed records
- Any errors from `migration-state/errors.json`

If failures exist, investigate `errors.json`, fix the root cause, and re-run Phase 3 (already-inserted records are automatically skipped).

## Supported Field Types in entity-map.json

| Type | Airtable source | Shesha storage | Notes |
|---|---|---|---|
| `text` | singleLineText, multilineText, url | `string` | Truncated to `StringLength` if set |
| `number` | number | `int`/`decimal` | |
| `bool` | checkbox | `bool` | |
| `date` | date | `DateTime` | ISO date only (no time) |
| `enum` | singleSelect | `long?` (reflist) | Maps via `enum-map.json` |
| `multiselect_enum` | multipleSelects | `long?` (bitflags reflist) | OR-combined bitmask; enum values MUST be powers of 2 |
| `multiselect_text` | multipleSelects | `string` | Values joined with `", "` |

## Entity → Airtable Table Mapping

| Airtable Table | Shesha Entity | Notes |
|---|---|---|
| (base itself) | BaseProject | Created once per migration run |
| Projects | ProjectsDefinition | |
| Modules | ModuleDefinition | |
| Releases | ReleaseDefinition | |
| Roles | RoleDefinition | |
| Entities | EntityDefinition | |
| Services | ServiceDefinition | |
| APIs | ApiDefinition | |
| Background Jobs | BackgroundJobDefinition | |
| Notifications | NotificationDefinition | |
| Config | ConfigDefinition | |
| Reports | ReportDefinition | |
| Views | ViewDefinition | |
| View Reqs | ViewRequirement | |
| Other Reqs | OtherRequirement | |
| Menu | MenuDefinition | |
| RefLists | RefListDefinition | |
| RefListItems | RefListItemDefinition | |

Full field mappings and M:M junction definitions are in `references/entity-map.json`.
Enum value mappings (Airtable option name → Shesha integer) are in `references/enum-map.json`.

## Known Mapping Decisions (Pre-documented)

1. **Status field**: Airtable uses "Req Ready", "Ready for Testing", "Tested", etc. which don't exist in `RefListRsStatus`. Current mapping: Req Ready→Done(3), Ready for Testing→Active(4), Tested→Done(3), "Partially Implemented"→InProgress(2), "Failed Testing"→FailedTesting(8), "Not Implemented"→NotImplemented(9).

2. **ServiceType**: Airtable uses "Entity CRUD Service"/"Custom Service" (behaviour types), Shesha uses transport types. Maps to EntityCrud=6 and Custom=7 in `RefListRsServiceType`.

3. **ReportType**: "Excel Download" → ExcelDownload(6), "Pdf Report" → PdfReport(7) in `RefListRsReportType`.

4. **ViewType**: "Picker"→Picker(7), "Workflow"→Workflow(8). All mapped.

5. **Attachments**: Airtable `multipleAttachments` fields exist on most tables — skipped globally via `skip_field_types`. No `StoredFile` property on these entities. Explicitly skipped, not silently dropped.

6. **Notification Mechanism**: Airtable `multipleSelects` field → `RefListRsNotificationType` bitflags (Email=1, SMS=2, Push=4, InApp=8, Webhook=16, SignalR=32). Stored as `MechanismLkp` bigint. If records were migrated before mechanism was added, run `--reconcile --table "Notifications"` to back-fill.

7. **API Other Standard Restrictions**: Airtable `multipleSelects` (e.g., "Restrict by Facility Context") → joined as comma-separated string into `ApiDefinition.OtherStandardRestrictions` (max 500 chars). If records were migrated before this was added, run `--reconcile --table "APIs"`.

8. **View Reqs "Name"**: The Airtable "View Reqs" table has no "Name" field. The `ViewRequirement.Name` property is populated from the "Requirement" field via the `name_field` fallback in the migration script.

9. **Reverse-link fields (skipped)**: Fields like "Used by Views", "Used by Background Jobs", "Used by View Reqs" are Airtable reverse-link computed fields — they have no data of their own. The relationship is captured from the owning side (e.g., ViewDefinition.RequiredApis). These are the ONLY legitimately skippable fields under the zero data loss policy.

## Multi-Base Strategy

For each of the 20+ Airtable bases:
1. Update `migration.config.json` with the new `airtable_base_id`
2. Run Phase 1 to check for schema differences in that base
3. If different table/field names exist, create `migration-state/overrides.json`
4. Run Phase 3 — each base gets its own `BaseProject` record; the `id-map.json` accumulates cross-base state
5. Reports save to `migration-state/{base-name}/` — separate folder per base keeps them organised

To reset and re-migrate a specific base, delete its entries from `id-map.json` (the Airtable record IDs starting with `rec...` for that base, plus the `BASE_{baseId}` key).
