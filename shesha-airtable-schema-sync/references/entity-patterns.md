# Entity & Migration Patterns — RequirementsStudio

## Project conventions

- All project tables are prefixed `Rs_`
- Table names are plural (`Rs_ModuleDefinitions`)
- FK column names: `{PropertyName}Id` (e.g. `BaseProjectId`)
- RefList enum columns: `{PropertyName}Lkp` suffix (e.g. `StatusLkp`)
- Migration class name: `M{yyyyMMddHHmmss}_{Description}`
- Migration attribute: `[Migration(yyyyMMddHHmmss)]` (14-digit timestamp)
- Migrations inherit `OneWayMigration` (one-directional, no Down())
- Migrations namespace: `Shesha.RequirementsStudio.Domain.Migrations`
- Entity namespace: `Shesha.RequirementsStudio.Domain`
- Entity classes in `backend/src/Module/Shesha.RequirementsStudio.Domain/Domain/{EntityFolder}/`
- Migration files in `backend/src/Module/Shesha.RequirementsStudio.Domain/Migrations/`

## Main entity template

```csharp
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Abp.Domain.Entities.Auditing;
using Shesha.Domain.Attributes;

namespace Shesha.RequirementsStudio.Domain
{
    [Table("Rs_EntityNamePlurals")]
    [Entity(GenerateApplicationService = GenerateApplicationServiceState.AlwaysGenerateApplicationService,
        FriendlyName = "Entity Name")]
    public class EntityName : FullAuditedEntity<Guid>
    {
        [Required]
        public virtual BaseProject BaseProject { get; set; }

        [Required]
        [StringLength(200)]
        public virtual string Name { get; set; }

        [StringLength(2000)]
        public virtual string Description { get; set; }

        public virtual RefListRsStatus? Status { get; set; }

        // FK navigation property
        public virtual OtherEntity RelatedEntity { get; set; }

        // One-to-many collection (no FK on this entity — FK is on ChildEntity)
        public virtual IList<ChildEntity> Children { get; set; }
    }
}
```

## Rules
- All main entities extend `FullAuditedEntity<Guid>` (provides Id, audit columns, soft-delete)
- All properties are `public virtual`
- All string properties need `[StringLength(n)]`
- Required references use `[Required]`
- Nullable reference types (optional FK): no `[Required]`, just `public virtual OtherEntity Prop { get; set; }`
- Nullable value types: `public virtual int? Count { get; set; }`

## Migration template

```csharp
using System;
using FluentMigrator;
using Shesha.FluentMigrator;

namespace Shesha.RequirementsStudio.Domain.Migrations
{
    [Migration(20260512120000)]
    public class M20260512120000_RecreateFromAirtableSchema : OneWayMigration
    {
        public override void Up()
        {
            // 1. Create main table
            Create.Table("Rs_EntityNamePlurals")
                .WithIdAsGuid()
                .WithFullAuditColumns()
                .WithColumn("Name").AsString(200).NotNullable()
                .WithColumn("Description").AsString(2000).Nullable()
                .WithColumn("StatusLkp").AsInt64().Nullable()
                .WithColumn("IsActive").AsBoolean().NotNullable().WithDefaultValue(false);

            // 2. Add FK columns AFTER all tables are created (avoids forward-reference errors)
            Alter.Table("Rs_EntityNamePlurals")
                .AddForeignKeyColumn("BaseProjectId", "Rs_BaseProjects").NotNullable();

            Alter.Table("Rs_EntityNamePlurals")
                .AddForeignKeyColumn("RelatedEntityId", "Rs_OtherEntities").Nullable();

            // 3. M:M junction table (no C# entity class needed)
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
        }
    }
}
```

## Key migration helpers

| Shesha extension | What it creates |
|---|---|
| `.WithIdAsGuid()` | `Id uniqueidentifier NOT NULL` primary key |
| `.WithFullAuditColumns()` | All ABP audit columns (CreationTime, CreatorUserId, LastModificationTime, LastModifierUserId, IsDeleted, DeletionTime, DeleterUserId, TenantId) |
| `.AddForeignKeyColumn("XId", "Rs_Ys")` | `XId uniqueidentifier` + FK constraint to `Rs_Ys.Id` |

Always call `Alter.Table(...).AddForeignKeyColumn(...)` AFTER all `Create.Table(...)` calls — avoids forward-reference failures when the target table doesn't exist yet.

## SQL: drop all Rs_ tables (run BEFORE applying new migrations)

```sql
-- Run against RequirementsStudio database in SSMS or sqlcmd
-- Drops all Rs_ project tables (Shesha framework tables are untouched)
USE RequirementsStudio;

-- Drop all FK constraints on Rs_ tables first
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id))
    + '.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
    + ' DROP CONSTRAINT ' + QUOTENAME(fk.name) + ';' + CHAR(13)
FROM sys.foreign_keys fk
WHERE OBJECT_NAME(fk.parent_object_id) LIKE 'Rs[_]%'
   OR OBJECT_NAME(fk.referenced_object_id) LIKE 'Rs[_]%';
EXEC sp_executesql @sql;

-- Drop all Rs_ tables
SET @sql = N'';
SELECT @sql += N'DROP TABLE IF EXISTS ' + QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME) + ';' + CHAR(13)
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE 'Rs[_]%'
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;
EXEC sp_executesql @sql;

-- Clear FluentMigrator version records for this project's migrations
DELETE FROM [dbo].[VersionInfo]
WHERE [Description] LIKE '%RequirementsStudio%'
   OR [Description] LIKE 'M20260508%'
   OR [Description] LIKE 'M20260509%'
   OR [Description] LIKE 'M20260510%'
   OR [Description] LIKE 'M20260511%'
   OR [Description] LIKE 'M20260512%';
```

## Migration creation order

Create tables in dependency order (parents before children) but add FK columns after ALL tables exist:

```
Phase 1 — Create tables:
  Rs_BaseProjects (no FKs)
  Rs_EntityA (no FKs yet)
  Rs_EntityB (no FKs yet)
  ...junction tables...

Phase 2 — Alter tables to add FK columns:
  Alter Rs_EntityA → add BaseProjectId FK
  Alter Rs_EntityB → add EntityAId FK (if one-to-many)
  ...
```

## Deleting old migration files

Before creating the new migration, delete all existing `M*.cs` files in:
`backend/src/Module/Shesha.RequirementsStudio.Domain/Migrations/`

Keep only the new `M{timestamp}_RecreateFromAirtableSchema.cs`.
Also delete any untracked link entity class files (like `*Link.cs` files in Domain folders) that are being replaced by collection properties.
