---
name: shesha-airtable-schema-sync
description: Syncs an Airtable base schema to Shesha domain entities and FluentMigrator migrations. Drops all existing project entity tables and data, rewrites all C# entity classes to exactly match the Airtable schema (fields, types, FK relationships, M:M collections — without junction entity classes), and produces a single clean migration. Use when the user wants to rebuild Shesha domain entities from Airtable, reset the schema from Airtable, or recreate domain entities to match an Airtable base. Requires airtable-sync.json in the project root.
---

# Airtable Schema → Shesha Domain Sync

Fetches an Airtable base schema and rebuilds all Shesha domain entities + one clean migration to match it exactly. All existing project tables and data are removed first.

## Prerequisites

- Python 3 installed
- `airtable-sync.json` exists in the project root (gitignored):
  ```json
  {
    "_comment": "Fill in your Airtable and Shesha credentials.",
    "airtable_pat": "pat...",
    "airtable_base_id": "app...",
    "shesha_url": "http://localhost:21021",
    "shesha_username": "",
    "shesha_password": ""
  }
  ```
  If it doesn't exist, create it and ask the user to fill it in before continuing.

## Step 1 — Fetch Airtable schema

```bash
python .claude/skills/shesha-airtable-schema-sync/scripts/fetch_airtable_schema.py airtable-sync.json
```

This writes `airtable-schema.json` to the project root and prints the schema to stdout. Read `airtable-schema.json` to proceed.

## Step 2 — Analyse the schema

Parse the JSON output. For each table:
- `name` → Airtable table name (may be plural or human-readable)
- `class_name` → PascalCase C# class name (pre-computed by the script)
- `fields` → list of field objects with `type`, `name`, and relationship metadata

**Determine the BaseProject table**: The Airtable base represents the project; one table will be named something like "Base Projects" or "Projects" — this maps to the existing `BaseProject` entity. All other tables' entities should have a `BaseProject` FK.

Identify all relationships by checking `type` against the rules in the next section.

## Step 3 — Map relationships

Read [references/airtable-type-mappings.md](references/airtable-type-mappings.md) for the full type table.

**Relationship decision rules** (use `inverse_field_type` set by the fetch script):

| This field type | Inverse field type | Model as |
|---|---|---|
| `singleRecordLink` | any / null | FK property on this entity (`public virtual B Prop { get; set; }`) |
| `multipleRecordLinks` | `singleRecordLink` | One-to-many: FK column on this table pointing to linked table; add `IList<ThisEntity>` collection on linked entity |
| `multipleRecordLinks` | `multipleRecordLinks` | M:M: junction table in migration only; `IList<LinkedEntity>` on this entity; `IList<ThisEntity>` on linked entity; **no C# junction entity class** |
| `multipleRecordLinks` | null | One-directional collection: add FK on this entity's table pointing to linked table |

**Never create junction entity classes.** M:M is implemented purely in the migration (junction table) and surfaced as `IList<>` properties on both entity classes.

## Step 4 — Drop existing tables and data

Generate the SQL from [references/entity-patterns.md](references/entity-patterns.md) (the dynamic FK-drop + table-drop script). Present it to the user, confirm they want to run it, then have them execute it via SSMS or sqlcmd against the `RequirementsStudio` database.

Also delete all existing migration `.cs` files in:
`backend/src/Module/Shesha.RequirementsStudio.Domain/Migrations/`

And delete all untracked link/junction entity classes (any `*Link.cs` files inside Domain folders).

## Step 5 — Rewrite entity C# files

For each Airtable table, update (or create) the corresponding entity class. Follow the exact template in [references/entity-patterns.md](references/entity-patterns.md).

Rules:
- All main entities extend `FullAuditedEntity<Guid>`
- All properties are `public virtual`
- FK navigation properties: `public virtual OtherEntity PropName { get; set; }`
- One-to-many collections: `public virtual IList<ChildEntity> Children { get; set; }`
- M:M collections: `public virtual IList<OtherEntity> OtherEntities { get; set; }`
- Remove any properties that no longer exist in Airtable
- Add any properties that are missing
- Fix string lengths and types as per [references/airtable-type-mappings.md](references/airtable-type-mappings.md)
- Keep `BaseProject` as a required FK on every entity (except `BaseProject` itself)
- For `singleSelect` fields with known stable choices, create a `RefListRs{Entity}{Field}` enum; use `AsInt64().Nullable()` in migration with `Lkp` suffix

## Step 6 — Create one clean migration

Use a new timestamp (current datetime as `yyyyMMddHHmmss`).
File: `M{timestamp}_RecreateFromAirtableSchema.cs`

Structure:
1. **Phase 1**: `Create.Table(...)` for all entities and junction tables — no FK columns yet
2. **Phase 2**: `Alter.Table(...).AddForeignKeyColumn(...)` for all FK relationships

**M:M junction table pattern** (from entity-patterns.md):
```csharp
Create.Table("Rs_EntityA_EntityBs")
    .WithColumn("EntityAId").AsGuid().NotNullable()
    .WithColumn("EntityBId").AsGuid().NotNullable();

Create.PrimaryKey("PK_Rs_EntityA_EntityBs")
    .OnTable("Rs_EntityA_EntityBs")
    .Columns("EntityAId", "EntityBId");

Create.ForeignKey("FK_Rs_EntityA_EntityBs_AId")
    .FromTable("Rs_EntityA_EntityBs").ForeignColumn("EntityAId")
    .ToTable("Rs_EntityAs").PrimaryColumn("Id");

Create.ForeignKey("FK_Rs_EntityA_EntityBs_BId")
    .FromTable("Rs_EntityA_EntityBs").ForeignColumn("EntityBId")
    .ToTable("Rs_EntityBs").PrimaryColumn("Id");
```

## Step 7 — Build and verify

```bash
dotnet build backend/Shesha.RequirementsStudio.sln
```

Fix any compilation errors. Then run the backend to apply the migration:

```bash
dotnet run --project backend/src/Shesha.RequirementsStudio.Web.Host
```

Check the output for FluentMigrator messages confirming the migration ran.

## Important notes

- The Airtable base name is ignored — only table and field names matter.
- Always add `airtable-sync.json` and `airtable-schema.json` to `.gitignore` if not already there.
- The `BaseProject` entity itself should NOT have a `BaseProjectId` FK — it IS the base project.
- Self-referencing FKs (e.g. a table linked to itself) follow the same FK pattern: `Alter.Table("Rs_X").AddForeignKeyColumn("ParentXId", "Rs_X").Nullable();`
- Junction table names: `Rs_{EntityA}_{EntityBsPlural}` — always entity A as singular, entity B as plural collection name.
- For M:M without a junction entity class, NHibernate requires explicit mapping (HasManyToMany). If the NHibernate mapping is convention-based only, the `IList<>` properties may not be traversable at runtime — note this limitation when outputting entities and flag for follow-up.
