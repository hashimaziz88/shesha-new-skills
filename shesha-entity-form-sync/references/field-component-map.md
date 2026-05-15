# Field → Component Mapping

## C# type → Shesha component type

| C# type / annotation | Component type | Key config |
|---|---|---|
| `string [StringLength ≤ 200]` | `textField` | — |
| `string [StringLength > 200]` or multilineText | `textArea` | `rows: 3` |
| `bool` | `checkbox` | — |
| `DateTime?` | `datePicker` | `dateFormat: "DD/MM/YYYY"` |
| `int?` or `double?` | `numberField` | — |
| `RefListRs*?` (enum) | `dropdown` | `referenceListId: { module, name }` |
| FK navigation property (single entity) | `entityPicker` | `entityType`, `displayProperty` |
| `IList<Entity>` (FK-inverse or M:M collection) | `dataTable` | `entityType`, filter by FK or junction |

## Component JSON templates

### §1 textField

```json
{
  "id": "{uuid}",
  "type": "textField",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "validate": { "required": {true|false} },
  "hidden": false,
  "readOnly": false
}
```

### §2 textArea

```json
{
  "id": "{uuid}",
  "type": "textArea",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "rows": 3,
  "validate": { "required": false },
  "hidden": false
}
```

### §3 checkbox

```json
{
  "id": "{uuid}",
  "type": "checkbox",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "hidden": false
}
```

### §4 datePicker

```json
{
  "id": "{uuid}",
  "type": "datePicker",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "dateFormat": "DD/MM/YYYY",
  "showTime": false,
  "validate": { "required": false },
  "hidden": false
}
```

### §5 numberField

```json
{
  "id": "{uuid}",
  "type": "numberField",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "validate": { "required": false },
  "hidden": false
}
```

### §6 dropdown (RefList)

The `referenceListId` module is always `"Shesha.RequirementsStudio"`.
The name is the enum class name with the `RefListRs` prefix removed (e.g. `RefListRsStatus` → `"RsStatus"`).

```json
{
  "id": "{uuid}",
  "type": "dropdown",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "referenceListId": {
    "module": "Shesha.RequirementsStudio",
    "name": "{RsEnumName}"
  },
  "validate": { "required": false },
  "hidden": false
}
```

**RefList name map for this project:**

| C# enum | referenceListId.name |
|---|---|
| `RefListRsStatus` | `RsStatus` |
| `RefListRsReleaseStatus` | `RsReleaseStatus` |
| `RefListRsDevOpsStatus` | `RsDevOpsStatus` |
| `RefListRsCodeStatus` | `RsCodeStatus` |
| `RefListRsLicensingModel` | `RsLicensingModel` |
| `RefListRsEntityType` | `RsEntityType` |
| `RefListRsViewType` | `RsViewType` |
| `RefListRsMockupStatus` | `RsMockupStatus` |
| `RefListRsRequirementType` | `RsRequirementType` |
| `RefListRsServiceType` | `RsServiceType` |
| `RefListRsServiceCrudAction` | `RsServiceCrudAction` |
| `RefListRsEndpointType` | `RsEndpointType` |
| `RefListRsRequestType` | `RsRequestType` |
| `RefListRsResponseType` | `RsResponseType` |
| `RefListRsResponseCode` | `RsResponseCode` |
| `RefListRsHttpMethod` | `RsHttpMethod` |
| `RefListRsJobType` | `RsJobType` |
| `RefListRsConfigurationType` | `RsConfigurationType` |
| `RefListRsConfigValueType` | `RsConfigValueType` |
| `RefListRsReportType` | `RsReportType` |
| `RefListRsItemType` | `RsItemType` |
| `RefListRsMenuLevel` | `RsMenuLevel` |

### §7 entityPicker (FK navigation property)

`entityType` is the full namespace + class name. `displayProperty` defaults to `name` unless noted.

```json
{
  "id": "{uuid}",
  "type": "entityPicker",
  "name": "{propertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCasePropertyName}",
  "entityType": "Shesha.RequirementsStudio.Domain.{ClassName}",
  "displayProperty": "name",
  "validate": { "required": {true|false} },
  "hidden": false
}
```

**Entity type map:**

| C# navigation type | entityType |
|---|---|
| `BaseProject` | `Shesha.RequirementsStudio.Domain.BaseProject` |
| `ProjectsDefinition` | `Shesha.RequirementsStudio.Domain.ProjectsDefinition` |
| `ModuleDefinition` | `Shesha.RequirementsStudio.Domain.ModuleDefinition` |
| `ReleaseDefinition` | `Shesha.RequirementsStudio.Domain.ReleaseDefinition` |
| `EntityDefinition` | `Shesha.RequirementsStudio.Domain.EntityDefinition` |
| `ViewDefinition` | `Shesha.RequirementsStudio.Domain.ViewDefinition` |
| `ViewRequirement` | `Shesha.RequirementsStudio.Domain.ViewRequirement` |
| `RoleDefinition` | `Shesha.RequirementsStudio.Domain.RoleDefinition` |
| `MenuDefinition` | `Shesha.RequirementsStudio.Domain.MenuDefinition` |
| `ServiceDefinition` | `Shesha.RequirementsStudio.Domain.ServiceDefinition` |
| `ApiDefinition` | `Shesha.RequirementsStudio.Domain.ApiDefinition` |
| `BackgroundJobDefinition` | `Shesha.RequirementsStudio.Domain.BackgroundJobDefinition` |
| `NotificationDefinition` | `Shesha.RequirementsStudio.Domain.NotificationDefinition` |
| `ConfigDefinition` | `Shesha.RequirementsStudio.Domain.ConfigDefinition` |
| `ReportDefinition` | `Shesha.RequirementsStudio.Domain.ReportDefinition` |
| `OtherRequirement` | `Shesha.RequirementsStudio.Domain.OtherRequirement` |
| `RefListDefinition` | `Shesha.RequirementsStudio.Domain.RefListDefinition` |
| `RefListItemDefinition` | `Shesha.RequirementsStudio.Domain.RefListItemDefinition` |

Special display properties:
- `ProjectsDefinition` → `displayProperty: "projectCode"`
- `ServiceDefinition` → `displayProperty: "customServiceName"`

### §8 dataTable (IList<> collection — tab content)

For FK-inverse collections (entity has FK back to the parent):
```json
{
  "id": "{uuid}",
  "type": "dataTable",
  "name": "{collectionPropertyName}",
  "label": "{Display Label}",
  "propertyName": "{camelCaseCollectionName}",
  "entityType": "Shesha.RequirementsStudio.Domain.{ChildClassName}",
  "hidden": false,
  "allowAdd": true,
  "allowDelete": true,
  "allowEdit": true
}
```

### §9 sectionSeparator

```json
{
  "id": "{uuid}",
  "type": "sectionSeparator",
  "name": "sep_{sectionName}",
  "label": "{Section Title}",
  "hidden": false
}
```

### §10 columns (2-column layout)

```json
{
  "id": "{uuid}",
  "type": "columns",
  "name": "cols_{id}",
  "columns": [
    {
      "id": "{left-col-uuid}",
      "flex": 1,
      "components": [ { /* left component */ } ]
    },
    {
      "id": "{right-col-uuid}",
      "flex": 1,
      "components": [ { /* right component */ } ]
    }
  ],
  "hidden": false
}
```

### §11 tabs (for M:M collections)

```json
{
  "id": "{uuid}",
  "type": "tabs",
  "name": "tabs_relationships",
  "tabs": [
    {
      "id": "{tab-uuid}",
      "title": "{Tab Label}",
      "components": [ { /* dataTable for this collection */ } ]
    }
  ],
  "hidden": false
}
```

## Full entity form structure example (ModuleDefinition)

```json
{
  "components": [
    { "type": "sectionSeparator", "label": "Project Context", ... },
    { "type": "columns", "columns": [
        { "components": [{ "type": "entityPicker", "propertyName": "baseProject", "label": "Base Project", "validate": { "required": true }, ... }] },
        { "components": [{ "type": "entityPicker", "propertyName": "project", "label": "Project", "validate": { "required": true }, ... }] }
    ]},
    { "type": "sectionSeparator", "label": "Details", ... },
    { "type": "columns", "columns": [
        { "components": [{ "type": "textField", "propertyName": "name", "label": "Name", "validate": { "required": true }, ... }] },
        { "components": [{ "type": "dropdown", "propertyName": "status", "label": "Status", "referenceListId": { "module": "Shesha.RequirementsStudio", "name": "RsStatus" }, ... }] }
    ]},
    { "type": "textField", "propertyName": "fullname", "label": "Full Name", ... },
    { "type": "columns", "columns": [
        { "components": [{ "type": "checkbox", "propertyName": "hasFrontEnd", "label": "Has Front-End", ... }] },
        { "components": [{ "type": "checkbox", "propertyName": "hasBackEnd", "label": "Has Back-End", ... }] }
    ]},
    { "type": "dropdown", "propertyName": "licensingModel", "label": "Licensing Model", "referenceListId": { "module": "Shesha.RequirementsStudio", "name": "RsLicensingModel" }, ... },
    { "type": "textArea", "propertyName": "description", "label": "Description", ... },
    { "type": "sectionSeparator", "label": "Code Generation", ... },
    { "type": "columns", "columns": [
        { "components": [{ "type": "textField", "propertyName": "namespaceRoot", "label": "Namespace Root", ... }] },
        { "components": [{ "type": "textField", "propertyName": "dbPrefix", "label": "DB Prefix", ... }] }
    ]},
    { "type": "columns", "columns": [
        { "components": [{ "type": "textField", "propertyName": "apiUrlPrefix", "label": "API Url Prefix", ... }] },
        { "components": [{ "type": "textField", "propertyName": "urlSegment", "label": "Url Segment", ... }] }
    ]},
    { "type": "sectionSeparator", "label": "DevOps", ... },
    { "type": "columns", "columns": [
        { "components": [{ "type": "dropdown", "propertyName": "devOpsBoardUrl", "label": "DevOps Board Url", ... }] },
        { "components": [{ "type": "textField", "propertyName": "devOpsArea", "label": "DevOps Area", ... }] }
    ]},
    { "type": "tabs", "tabs": [
        { "title": "Used Modules", "components": [{ "type": "dataTable", "propertyName": "usedModules", "entityType": "Shesha.RequirementsStudio.Domain.ModuleDefinition", ... }] },
        { "title": "Entities", "components": [{ "type": "dataTable", "propertyName": "entitiesInModule", ... }] }
    ]}
  ]
}
```
