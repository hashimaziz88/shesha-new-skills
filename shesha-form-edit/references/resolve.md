# Resolve — module, entity, form lookup with confidence

Where the skill turns a user's partial reference ("the member form", "the Member entity", "the membership module") into a concrete record. Used in Steps 1-5 of SKILL.md.

---

## Module resolution

Order of precedence:

1. **User-supplied** `module` arg matches exactly → done.
2. **API exact match** — `GET /api/services/Shesha/Module/GetAll`, filter where `name === user-input`.
3. **Semantic match** — case-insensitive substring or normalized similarity. Threshold: **score ≥ 0.7**. If 0 matches above threshold OR more than 1 → fail with disambiguation list.

### Preflight checks on the resolved module

- `isEnabled === true`
- `isEditable === true`

If either fails → block with a clear error. Disabled / non-editable modules are common in deployed environments; surfacing the exact reason saves the user a debugging session.

### Disambiguation

When the resolver returns multiple candidates ≥ threshold, present up to 5 via `AskUserQuestion`:

> Multiple modules match `<input>`. Which did you mean?
> - PBF.MembershipManagement
> - PBF.ClaimsManagement
> - ... (up to 5)

---

## Entity resolution

Entities in Shesha use full namespaces (e.g. `PBF.MembershipManagement.Domain.Domain.Member`). Users typically supply the short name (`Member`).

Order of precedence:

1. **User-supplied** full namespace matches a known entity → done.
2. **API exact match** — search known entities by short name (last segment of namespace) — case-insensitive.
3. **Semantic match** — same as module, threshold **score ≥ 0.9** (stricter — wrong entity binds wrong data, fail loudly).

If exact match isn't found AND no semantic match ≥ 0.9 → fail with "Did you mean..." surfacing up to 5 candidates.

### Entity discovery endpoint

```
GET /api/services/app/EntityConfig/GetAll?MaxResultCount=200
```

Returns a list with `friendlyName`, `className`, `namespace`, `fullClassName`, `module: { name }`. Cache the response under `.claude/cache/shesha-form-edit/entities/<module>.summary.md` (TTL 24h).

The Shesha-Mcp-Server uses Claude Haiku for the semantic match step; the skill can substitute a simple normalized similarity (lowercased, hyphens/dots stripped, Levenshtein distance) — adequate at the 0.9 threshold.

### Entity metadata

Once the full class name is known, fetch the property catalog per [api.md §10](api.md). Filter out `suppress: true` and `isFrameworkRelated: true` properties before presenting to the LLM / using for field generation — see [standards.md](standards.md) "Framework property filter".

The metadata DTO carries relationships explicitly:
- `references[]` — this entity points to another (one-to-one or many-to-one, FK out). Drives **EntityPicker / Autocomplete** selection.
- `referencedBy[]` — another entity points to this (often one-to-many). Drives **child-table embedding** on details forms.

Use these instead of inferring relationships from property names.

---

## Form resolution

### When user gives id

Use `GET /FormConfiguration/Get?id=<id>` directly. Skip the rest.

### When user gives `module + name`

`GET /FormConfiguration/GetByName?module=<module>&name=<name>` — see [api.md §3](api.md). Returns the form record including markup. **Exact match only.** If `result` is null, the form doesn't exist.

### When user gives partial / fuzzy reference ("the member form")

1. List all forms in the module: `GetAll?Filter={"==":[{"var":"module.name"},"<module>"]}` — see [api.md §13](api.md).
2. Filter by name substring of the user's reference (lowercase + kebab-case input first).
3. Apply suffix-aware ranking: forms whose name ends in `-details`, `-table`, `-create` etc. count as anchors; prefer the closest template match implied by the user's verb.

### Confidence handling for forms

- **Single exact match** → use silently.
- **Multiple matches** (or no exact match, several fuzzy) → present up to 5 via `AskUserQuestion` and let the user pick.
- **No matches** → ask the user to provide the id or confirm the module / name.

### Update operations: enforce exact match

The MCP `update_form_configuration` refuses to update a near-match form. The skill should mirror this: when editing, **never silently target a form whose name doesn't exactly match the user's input** (after both have been kebab-normalised). Always confirm.

---

## Name generation (for new forms)

When the user describes a new form without giving a name, derive one:

```
function generateName({ entity, formType, descriptor }) {
  const base = entity ? toKebab(entity) : null;
  const suffix = SUFFIX_MAP[formType] || '';   // see templates.md
  let candidate = base ? `${base}${suffix}` : (descriptor || formType);
  if (descriptor && descriptor !== formType) candidate = `${candidate}-${toKebab(descriptor)}`;
  return ensureUnique(candidate);              // append -2, -3, ... up to 100
}
```

Validate against the form-name regex from [standards.md](standards.md) before proceeding.

### `toKebab` rules

- PascalCase / camelCase: `LoanApplication` → `loan-application` (inject hyphen before each uppercase except the first).
- Space-separated: `Loan Application` → `loan-application`.
- snake_case: `loan_application` → `loan-application`.
- Already kebab: pass through.

### `ensureUnique`

Query `GetAll` filtered by module + name prefix. Find the highest existing suffix (`-2`, `-3`, ...) and bump.

---

## Confidence thresholds (summary)

| What | Threshold | On miss |
|---|---|---|
| Module name match | ≥ 0.7 | Fail with disambiguation list (≤ 5) |
| Entity match | ≥ 0.9 | Fail with "did you mean" list (≤ 5) |
| Form match (read) | exact OR user-confirmed | Ask |
| Form match (update) | exact only | Refuse; ask user |

---

## Cache strategy

- Entity metadata: `metadata/<entity>.{raw.json,summary.md}` — TTL 24h.
- Module list: `modules/<backend-host>.{raw.json,summary.md}` — TTL 1h (modules can be enabled/disabled while developer works).
- Form list per module: `forms/<module>.{raw.json,summary.md}` — TTL 15min (forms change frequently during development).
- `--refresh-cache` ignores all TTLs.

Distill via `node scripts/summarize.js`. Skill reads `.summary.md` by default; falls back to raw JSON when summary is insufficient.
