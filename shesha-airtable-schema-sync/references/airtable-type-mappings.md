# Airtable Field Type → C# / FluentMigrator Mappings

## Standard field types

| Airtable type | C# property type | FluentMigrator column | Notes |
|---|---|---|---|
| `singleLineText` | `string` | `.AsString(300).Nullable()` | Adjust length from field name semantics |
| `multilineText` | `string` | `.AsString(4000).Nullable()` | Use max 4000 or `AsString(int.MaxValue)` for unlimited |
| `email` | `string` | `.AsString(300).Nullable()` | |
| `url` | `string` | `.AsString(2048).Nullable()` | |
| `phoneNumber` | `string` | `.AsString(50).Nullable()` | |
| `richText` | `string` | `.AsString(int.MaxValue).Nullable()` | HTML/markdown content |
| `number` | `int` / `double` / `decimal` | `.AsInt32()` / `.AsDouble()` / `.AsDecimal(18,4)` | Use `int` when `precision == 0`, `double` when `precision >= 1`, `decimal` for financial |
| `currency` | `decimal` | `.AsDecimal(18,2).Nullable()` | |
| `percent` | `double` | `.AsDouble().Nullable()` | Stored as 0–100 |
| `duration` | `int` | `.AsInt32().Nullable()` | Stored as seconds |
| `rating` | `int` | `.AsInt32().Nullable()` | Use `max` from field options for validation |
| `checkbox` | `bool` | `.AsBoolean().NotNullable().WithDefaultValue(false)` | Always not-nullable with default false |
| `date` | `DateTime` | `.AsDate().Nullable()` | Use `DateTime` property, store as date |
| `dateTime` | `DateTime` | `.AsDateTime().Nullable()` | |
| `singleSelect` | `string` or `RefListEnum?` | `.AsInt64().Nullable()` (RefList) or `.AsString(100).Nullable()` | Prefer RefList enum if choices are stable; column suffix `Lkp` |
| `multipleSelects` | `string` | `.AsString(1000).Nullable()` | Store as comma-separated string; no RefList |
| `barcode` | `string` | `.AsString(200).Nullable()` | |
| `attachment` | — | **SKIP** | Cannot be meaningfully migrated |
| `collaborator` | — | **SKIP** | Maps to Shesha user, handle separately |
| `multipleCollaborators` | — | **SKIP** | |

## Relationship fields

| Airtable type | Inverse type | Shesha pattern |
|---|---|---|
| `singleRecordLink` (A→B) | any | FK property on A: `public virtual B Prop { get; set; }` + FK column `PropId` on `Rs_A` |
| `multipleRecordLinks` (A→B) | `singleRecordLink` (B→A) | One-to-many; FK column on `Rs_A` pointing to `Rs_B`; `IList<A>` collection on B entity |
| `multipleRecordLinks` (A→B) | `multipleRecordLinks` (B→A) | M:M; junction table `Rs_A_Bs` in migration; `IList<B>` on A entity; `IList<A>` on B entity; **no junction entity class** |
| `multipleRecordLinks` (A→B) | none/null | Treat as one-to-many with FK on A; add `BId` column to `Rs_A` |

## RefList (singleSelect) naming

When a `singleSelect` field has known stable choices, create a C# enum:

```csharp
public enum RefListRs{EntityName}{FieldName}
{
    Choice1 = 1,
    Choice2 = 2,
}
```

Column in migration uses suffix `Lkp`:
```csharp
.WithColumn("StatusLkp").AsInt64().Nullable()
```

Property in entity:
```csharp
public virtual RefListRsEntityStatus? Status { get; set; }
```

## Length guidelines by field semantics

| Pattern | Max length |
|---|---|
| Name, title, label | 200 |
| Code, prefix, symbol, key | 50–100 |
| URL, path | 500–2048 |
| Description, summary | 2000 |
| Notes, requirements, comments | 4000 |
| Free-form long text | `int.MaxValue` |

## Skip these field types

Always skip (computed, system, or unmappable):
`formula`, `rollup`, `lookup`, `count`, `autoNumber`, `createdTime`, `lastModifiedTime`,
`createdBy`, `lastModifiedBy`, `externalSyncSource`, `button`, `attachment`,
`collaborator`, `multipleCollaborators`
