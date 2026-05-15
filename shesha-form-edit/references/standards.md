# Canonical standards

The non-derivable rules — load these on any form work. Order: read [form-shape.md](components/form-shape.md) first for structure, then this file for canonical rules.

---

## Form naming

**Regex** (kebab-case, must start with letter): `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`

Fail-fast: validate the proposed name against this regex **before** any LLM/API work. Reject malformed names with a clear error.

### Name composition

```
{entity-kebab}-{form-type-suffix}[-{additional-descriptor}]
```

| Form type | Suffix |
|---|---|
| details | `-details` |
| table | `-table` |
| create | `-create` |
| dashboard | `-dashboard` |
| dialog | `-dialog` |
| custom (entity action) | `-{action}` (e.g. `-merge`, `-convert`) |
| custom (non-entity) | descriptive base name (e.g. `dashboard`, `auth-login`) |

**Entity base name**: convert the entity class PascalCase to kebab-case (`LoanApplication` → `loan-application`).

**`additional-descriptor`**: ONLY add for variants, role-specific forms, or special-purpose forms (e.g. `customer-details-for-accountmanager`, `member-create-for-mvp`). NEVER append `-default` or any redundant descriptor to standard forms.

### Uniqueness

Name must be unique within the module. On collision when creating, auto-increment with `-2`, `-3`, …, up to 100. If still colliding, surface to user.

---

## Module preflight

Before any create / update operation, the module must be:

- **Found** — exact or high-confidence match (≥0.9 similarity).
- **`isEnabled === true`** — disabled modules cannot host forms.
- **`isEditable === true`** — read-only / imported modules reject writes.

Block early with a clear error if any check fails.

---

## Form-vs-entity binding

A form is **entity-bound** (`formSettings.modelType` set, `dataLoaderType: "gql"` or similar) when it represents a business object. Otherwise it has `modelType` empty / null and `dataLoaderType: "none"`.

| Should the form be entity-bound? | YES | NO |
|---|---|---|
| CRUD on one record | ✓ | |
| List/table of entity records | ✓ | |
| Fields auto-load/save to entity | ✓ | |
| Represents a business object | ✓ | |
| Third-party API data | | ✓ |
| Static info / help page | | ✓ |
| Aggregated dashboard (multiple sources) | | ✓ |
| Settings/configuration screen | | ✓ |
| Contact / feedback (data sent elsewhere) | | ✓ |
| Custom API with no canonical entity | | ✓ |

---

## Framework property filter

When introspecting entity metadata to drive field selection: **exclude** any property where `suppress === true` or `isFrameworkRelated === true`. These are audit / system fields (`CreationTime`, `CreatorUserId`, etc.) that should never appear on user-facing forms.

---

## Global object dereferencing — common LLM-hallucination fix

Inside any `_code` script string, references to top-level globals must NOT be doubled:

| Wrong | Right |
|---|---|
| `form.form.formMode` | `form.formMode` |
| `data.data.status` | `data.status` |
| `globalState.globalState.X` | `globalState.X` |

`scripts/autofix.js` applies a regex pass (`\b(form|data|globalState)\.\1\.` → `\1.`) recursively on every `_code` string. Run it before validation.

---

## IPropertySetting

Most `hidden` / `disabled` / `default` / `label` style properties accept three forms:

```json
"hidden": false                                                          // plain
"hidden": { "_mode": "value", "_value": false }                          // wrapped
"hidden": { "_mode": "code", "_code": "return data.accountType !== 'PBF';" }  // runtime JS
```

- Always include `_mode` when wrapping. Bare `{ _value: ... }` is not recognised.
- For runtime expressions: prefer `_mode: "code"` with `_code` that **explicitly `return`s** a value. Helper attributes like `hideWhen="<expr>"` in legacy XML map to `{ _mode: "code", _code: "return <expr>;" }`.
- `_code` is evaluated against the script context — see [components/scripts.md](components/scripts.md).

---

## Reference list & form id shapes — `{ name, module }` objects

These four properties take **object** shape, never a string and never a Guid:

| Component | Property | Shape |
|---|---|---|
| dropdown / radio / checkboxGroup | `referenceListId` | `{ "name": "PaymentStatus", "module": "Shesha" }` |
| subForm | `formId` | `{ "name": "address-edit", "module": "Shesha" }` |
| datatable / datalist (form-template row) | `formId` | `{ "name": "...", "module": "..." }` |
| Show Dialog action arguments | `formId` | `{ "name": "...", "module": "..." }` |

**Exception: `refListStatus`** — uses flat keys `module` + `referenceListName`. Different shape — don't conflate. See [components/dropdowns.md](components/dropdowns.md).

`scripts/validate.js` enforces both shapes.

---

## `required: true` is sugar for `validate.required`

When authoring: prefer setting `validate: { required: true }` directly on the component. If a legacy `required: true` key is present, normalise it to `validate.required` and delete `required` (mirrors the MCP transformer behaviour). See [components/inputs.md](components/inputs.md).

---

## `stylingBox` is a JSON string, not an object

Most styling subkeys (`border`, `background`, `font`, `dimensions`, `shadow`) are objects nested under `desktop`/`tablet`/`mobile`. **`stylingBox` is the exception** — it is stored as a JSON-encoded string:

```json
"stylingBox": "{\"paddingTop\":16,\"paddingBottom\":16,\"marginLeft\":\"auto\"}"
```

If you compute `stylingBox` as an object, `JSON.stringify` it before persisting. `scripts/autofix.js` does this automatically.

---

## Styling sanitiser — never null sub-keys

If `desktop` / `tablet` / `mobile` exist on a component, their `border`, `background`, `font`, `dimensions`, `shadow` sub-keys **must be non-null objects**. The frontend crashes (`Cannot read properties of null`) on `null` here.

Default fillers (mirror MCP `initialStyles`):

```json
{
  "border": { "hideBorder": false, "radiusType": "all", "borderType": "all",
    "border": { "all": { "width": "1px", "style": "solid", "color": "#d9d9d9" } },
    "radius": { "all": 8 } },
  "background": { "type": "color", "color": "#ffffff",
    "repeat": "no-repeat", "size": "cover", "position": "center" },
  "font": { "color": "#000", "type": "Arial", "align": "left",
    "size": 14, "weight": "400" },
  "dimensions": { "height": "32px", "width": "100%",
    "minHeight": "0px", "minWidth": "0px", "maxWidth": "100%", "maxHeight": "100%" },
  "shadow": { "offsetX": 0, "offsetY": 0, "color": "#000000",
    "blurRadius": 0, "spreadRadius": 0 }
}
```

`scripts/autofix.js` walks the tree and fills any missing sub-keys.

---

## actionOwner inside DataTableContext

Buttons / filters / action columns nested inside a `dataTableContext` that target the context (e.g. `Refresh table`, `Toggle Advanced Filter`, `Toggle Columns Selector`, `Export to Excel`) must reference the context's `id` as `actionOwner`, not its `componentName`.

Authoring shortcut: write `actionOwner` as the context's `componentName` (readable), and let `scripts/autofix.js` rewrite to the `id` recursively across `actionConfiguration`, `onSuccess`, and `onFail`.

---

## Data-table action-column navigation

In a `dataTable` action column with `actionName: "Navigate"`, set `navigationType: "form"` (not `"url"`) in `actionArguments`. The MCP transformer rewrites this silently; the skill must produce the correct shape directly.

---

## Canonical CSS classes (allowlist)

Container `className` values must come from this list — see [`assets/css-classes.json`](../assets/css-classes.json):

- Page chrome: `sha-page`, `sha-page-title`, `sha-page-heading`, `sha-page-content`
- Index tables: `sha-index-table-full`, `sha-index-table-control`, `index-table-controls-left`, `index-table-controls-right`, `sha-index-toolbar`

Other classes are project-specific and may or may not be honoured. When in doubt, omit `className` and lean on the styling object.

---

## Quote escaping in scripts

Inside `_code` strings (and `style` attributes when sourced from XML originally), use **`&quot;`** for double quotes, never `\"`. The XML transformer normalises this; if you ever paste markup that came from a Shesha export, expect `&quot;` and don't "fix" it.

In hand-written JSON, normal JS escaping (`\"`) is fine — but if the value is used inside an HTML/XML-rendered attribute, prefer string concatenation or template literals that avoid embedded quotes.

---

## What the skill is allowed to change in `formSettings`

Default: **don't touch `formSettings`** unless the user's requirement specifically asks for it. The MCP enforces this implicitly by never touching settings during XML→JSON for unchanged forms.

Permitted touches:
- `modelType` — only when the user is changing the form's entity binding.
- `access` — anonymous form gotcha (see [components/form-shape.md](components/form-shape.md)).
- `dataLoaderType` / `dataSubmitterType` — only when switching between bound / unbound flows.
- Lifecycle hooks (`onBeforeDataLoad`, `onAfterDataLoad`, `onPrepareSubmitData`, `onBeforeSubmit`, `onSubmitSuccess`, `onSubmitFailed`) — when the user explicitly asks for that lifecycle behaviour. See [lifecycle.md](lifecycle.md).

Everything else (layout, labelCol, wrapperCol, size, colon, permissions, version) — preserve.

---

## "Don't gold-plate" meta-rule

Verbatim from the MCP `FORM_DESIGN_AND_XML_SYSTEM_PROMPT`:

> Do not make it overly complicated, if not requested to do so and does not enhance the user experience.

Applies to the skill at every step: don't introduce abstractions (extra containers, wrapper components, custom scripts) the user didn't ask for. When in doubt, mirror the closest existing form and stop.
