# Form shape, skeleton, and IPropertySetting wrapper

The structural foundation. Read this first when authoring or validating any form JSON.

---

## Top-level form JSON

After `JSON.parse(markup)`:

```json
{
  "components": [
    { "id": "...", "type": "...", "propertyName": "...", "...": "..." },
    { "id": "...", "type": "container", "components": [ ... ] }
  ],
  "formSettings": {
    "modelType": "PBF.MembershipManagement.Domain.Domain.Member",
    "layout": "horizontal",
    "labelCol": { "span": 8 },
    "wrapperCol": { "span": 16 },
    "colon": true,
    "size": "middle",
    "access": 3,
    "permissions": []
  }
}
```

- `components` is a **nested tree** — containers, tabs, columns, cards have their own `components: []` (or in card's case, `content.components`). Walk recursively.
- `formSettings.modelType` is the entity full name. Reference-list dropdowns and entity pickers silently fail to bind if this is wrong — keep it in sync with the actual entity binding.
- `formSettings.layout`: `"horizontal"` (default — labels left of inputs) | `"vertical"` (labels above). Setting `"inline"` rarely produces what users expect; use a `container` with horizontal direction instead.
- Empty form is `{ "components": [], "formSettings": { "modelType": "..." } }`. Don't push `null` or `""`.

---

## Component skeleton

Every component has:

```json
{
  "id": "uuid-v4-string",
  "type": "textField",
  "propertyName": "firstName",
  "label": "First Name",
  "parentId": "uuid-of-parent-or-'root'"
}
```

- `id` — unique GUID. **Stable; never regenerate on existing components.** When cloning, deep-clone with new ids; never touch originals.
- `type` — must match a known component type from the clean-form-config index (`node scripts/components-index.js` lists them).
- `propertyName` — for **input** components, the entity property to bind. **camelCase** (`firstName`); the underlying entity is PascalCase (`FirstName`); the framework maps automatically. Don't double-case.
- `parentId` — `'root'` for top-level, otherwise the parent container's id. Every child's `parentId` must reference an `id` that exists in the tree. After moving components, sweep to verify.
- `label` — display label. Hidden if `hideLabel: true`.

---

## IPropertySetting wrapper

Many string/number/boolean properties accept either a **plain value** or a **wrapped JS expression**:

```json
"hidden": false                                                       // plain
"hidden": { "_mode": "value", "_value": false }                       // wrapped, equivalent
"hidden": { "_mode": "code", "_code": "data.accountType !== 'PBF'" }  // runtime JS
```

When `_mode === "code"`, `_code` is evaluated at runtime against the script context (see [scripts.md](scripts.md)). Use this for dynamic visibility, dynamic enabled, dynamic default values, dynamic labels.

When you write a wrapped value, **always include `_mode`** — bare `{ _value: ... }` won't be recognized.

When editing existing markup: keep wrappers when present. Only convert to wrapped form when the user is asking for runtime behavior.

---

## Anonymous-access (`access: 5`)

`formSettings.access = 5` makes the form reachable without login (login, register, OTP pages). Served at `/no-auth/<module>/<form>`. Authenticated forms (`access: 3` default) live at `/dynamic/<module>/<form>`.

The `Create` endpoint may not honour `access` on initial create. After `POST /Create`, immediately call `PUT /UpdateMarkup` with `access: 5, permissions: []` to lock it in. Verify by re-fetching `GetByName` and checking `result.access === 5`.

---

## `formSettings` deep dive

| Field | Type | Notes |
|---|---|---|
| `modelType` | string | Entity full namespace. Empty for non-entity-bound forms (dashboards, settings). |
| `dataLoaderType` | `"gql" \| "entity" \| "custom" \| "none"` | `"gql"` is the modern default for entity forms; `"none"` skips data loading entirely (dashboards, login). |
| `dataSubmitterType` | same enum | Set to `"none"` when the form's submit goes through custom buttons / API calls. |
| `dataLoadersSettings` | object | Per-loader-type config. `{ gql: { endpointType: "default" } }` is the standard. |
| `dataSubmittersSettings` | object | Same shape. The default `dynamicEndpoint` is `"    return data?.id ? form.defaultApiEndpoints.update : form.defaultApiEndpoints.create"`. |
| `layout` | `"horizontal" \| "vertical" \| "inline"` | `"horizontal"` (default). Avoid `"inline"`. |
| `labelCol` / `wrapperCol` | `{ span: number }` | AntD column grid for label vs input. Default `{ span: 8 } / { span: 16 }`. |
| `colon` | bool | Whether labels render with trailing `:`. |
| `size` | `"small" \| "middle" \| "large"` | Component density. |
| `access` | int | `3` = authenticated (default); `5` = anonymous (`/no-auth/...`). See above. |
| `permissions` | string[] | Permission names; ALL must be granted for the user to view the form. |
| `version` | int | Schema version. MCP default `7`. Don't lower. |
| `onBeforeDataLoad` / `onAfterDataLoad` / `onPrepareSubmitData` / `onBeforeSubmit` / `onSubmitSuccess` / `onSubmitFailed` | string (JS body) | Lifecycle hooks. See [../lifecycle.md](../lifecycle.md). |

### Form record metadata (NOT formSettings)

`module`, `name`, `type`, `frontEnd`, `label`, `description`, `versionNo`, `versionStatus` live on the form **record** (the `FormConfigurationDto` envelope) — not in markup. Don't include them in `formSettings`.

`versionStatus` enum: `1=Draft, 2=ReadyForReview, 3=Live, 4=Retired`. UpdateMarkup is permitted in any state, but tools that publish forms to production should be checked against the lifecycle.

## When in doubt

- The authoritative valid-keys-per-type list lives in the **`shesha-developer:clean-form-config`** skill's `assets/groups/*.json`. Inspect via `node scripts/components-index.js <type>` (e.g. `dropdown`, `entityPicker`). If you're about to write a key that isn't in the index, you're probably wrong.
- For component-defaults to mirror the MCP transformer output, see `assets/component-defaults.json`.
- For component types not covered in any reference file (kanban, charts, queryBuilder, themeEditor, mainMenuEditor, processMonitor, kpi-style cards), inspect an existing form that uses them — the designer's output is canonical.
