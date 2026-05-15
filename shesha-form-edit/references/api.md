# Shesha Form API — Recipes

All curl recipes assume `$BASE_URL` and `$ACCESS_TOKEN` are set. On Windows, substitute `%BASE_URL%`/`%ACCESS_TOKEN%` for cmd or `$env:BASE_URL`/`$env:ACCESS_TOKEN` for PowerShell.

> **Routing namespace varies by Shesha build.** Always probe before assuming:
> - `FormConfiguration/*`, `Metadata/*`, `ReferenceList/*` consistently live under `/api/services/Shesha/`.
> - `Module/*`, `User/*`, `EntityConfig/*`, `Session/*` may live under `/api/services/app/` OR `/api/services/Shesha/` depending on the build.
> - If a 404 hits, swap `Shesha` ↔ `app` before assuming the endpoint doesn't exist. See [debug.md](debug.md) row 33.

---

## 1. Resolve base URL

Order of precedence:

1. `src/PBF.MembershipManagement.Web.Host/Properties/launchSettings.json` → `profiles.Project.applicationUrl`
2. `src/PBF.MembershipManagement.Web.Host/appsettings.json` → `Kestrel:Endpoints:Http:Url`
3. Fallback: `http://localhost:21021`

Strip trailing slash.

---

## 2. Authenticate

```bash
curl -s -X POST "$BASE_URL/api/TokenAuth/Authenticate" \
  -H "Content-Type: application/json" \
  -d '{"userNameOrEmailAddress":"admin","password":"123qwe"}'
```

ABP wraps responses; expect:

```json
{
  "result": {
    "accessToken": "eyJ...",
    "encryptedAccessToken": "...",
    "expireInSeconds": 86400,
    "expireOn": "...",
    "userId": 1,
    "personId": "...",
    "resultType": 1
  },
  "targetUrl": null,
  "success": true,
  "error": null,
  "unAuthorizedRequest": false,
  "__abp": true
}
```

Some Shesha builds return the token at the **root** instead. Try both:

```bash
TOKEN=$(curl ... | jq -r '.result.accessToken // .accessToken')
```

If both are null, the credentials are wrong (or the user is locked) — surface the raw response.

---

## 3. Resolve form id by name (when user gave module + name)

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetByName" \
  --data-urlencode "module=PBF.MembershipManagement" \
  --data-urlencode "name=member-create" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Response (ABP envelope):

```json
{
  "result": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "module": { "name": "PBF.MembershipManagement", "id": "..." },
    "name": "member-create",
    "label": "Member - Create",
    "markup": "{...stringified form JSON...}",
    "modelType": "PBF.MembershipManagement.Domain.Domain.Member",
    "versionNo": 1,
    "versionStatus": 3
  },
  "success": true
}
```

Extract `result.id` → `$FORM_ID`. Note: `GetByName` already includes `markup`, so if you used this endpoint you can skip Step 4.

If `result` is null, the form doesn't exist under that module/name. Stop and tell the user.

---

## 4. Fetch form JSON by id

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o /tmp/form-current.json
```

This endpoint returns the **raw markup as a file download** (`application/json` with `Content-Disposition: attachment`). The file content **is** the form JSON (already parsed as an object — no string wrapping). Read it with `JSON.parse`.

If you need the wrapping DTO (with id, name, modelType etc.) instead, use `Get` — `GET /api/services/Shesha/FormConfiguration/Get?id=$FORM_ID` — which returns the ABP envelope.

---

## 5. Push edited markup — UpdateMarkup (preferred)

`PUT /api/services/Shesha/FormConfiguration/UpdateMarkup`

DTO (`FormUpdateMarkupInput`):

```ts
{
  id: string,           // form Guid (required)
  markup?: string,      // stringified form JSON
  access?: number,      // RefListPermissionedAccess (optional)
  permissions?: string[] // optional
}
```

Build the body via Node so the markup string is properly JSON-escaped. Don't try to construct it inline in bash — escaping nested JSON-in-JSON manually is a footgun.

```bash
node -e "
const fs = require('fs');
const tree = JSON.parse(fs.readFileSync('/tmp/form-edited.json', 'utf8'));
const body = JSON.stringify({
  id: process.env.FORM_ID,
  markup: JSON.stringify(tree)
});
fs.writeFileSync('/tmp/update-markup-body.json', body);
" 

curl -s -X PUT "$BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/update-markup-body.json
```

Successful response: HTTP 200 with `{ "result": null, "success": true, ... }`. The endpoint returns `void`.

On error, ABP returns:

```json
{
  "result": null,
  "success": false,
  "error": { "code": 0, "message": "...", "details": "..." },
  "unAuthorizedRequest": false
}
```

Surface `error.message` and `error.details` to the user and stop.

---

## 6. Push edited markup — ImportJson (multipart upload)

`POST /api/services/Shesha/FormConfiguration/ImportJson` with `multipart/form-data`. Use this when you specifically need to mimic the designer's "upload JSON" button.

DTO (`ImportFormJsonInput`):

```ts
{
  ItemId: string,    // form Guid
  file: File         // the form JSON as a file upload, field name MUST be lowercase "file"
}
```

```bash
# /tmp/form-edited.json contains the stringified-or-tree form JSON.
# If your edits are an object (parsed tree), stringify first; the API expects the file content
# to be a JSON document representing the form markup.

curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/ImportJson" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "ItemId=$FORM_ID" \
  -F "file=@/tmp/form-edited.json;type=application/json"
```

Successful response: HTTP 200 with `{ "result": { ...FormConfigurationDto... }, "success": true }`. The DTO contains the updated form record.

Field name **must be `file`** (lowercase) — see `ImportFormJsonInput.File` `[BindProperty(Name = "file")]`.

---

## 7. (Optional) Create a new form

`POST /api/services/Shesha/FormConfiguration/Create`

DTO (`CreateFormConfigurationRequest`):

```ts
{
  moduleId: string,        // module Guid (required)
  name: string,            // unique within module
  label?: string,
  description?: string,
  modelType?: string,      // entity full name
  generationLogicTypeName?: string,
  templateId?: string,     // copy from another form
  markup?: string          // initial markup; can be set later via UpdateMarkup
}
```

```bash
curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/Create" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleId": "...module-guid...",
    "name": "member-quickview",
    "label": "Member - Quick View",
    "modelType": "PBF.MembershipManagement.Domain.Domain.Member"
  }'
```

To resolve `moduleId`, query `GET /api/services/Shesha/Module/GetAll` with bearer token and pick the module by `name`. Check `isEnabled === true` and `isEditable === true` before attempting any write — see [resolve.md](resolve.md). Form creation will fail server-side if either is false.

### 7a. Resolve module by name (with preflight)

```bash
curl -s -G "$BASE_URL/api/services/Shesha/Module/GetAll" \
  --data-urlencode "MaxResultCount=500" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `result.items[]` with `{ id, name, friendlyName, isEnabled, isEditable, ... }`. Match by exact `name`, then check both preflight booleans before proceeding.

### 7b. Resolve entity full-name from short name

```bash
curl -s -G "$BASE_URL/api/services/app/EntityConfig/GetAll" \
  --data-urlencode "MaxResultCount=500" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `result.items[]` with `{ id, className, namespace, fullClassName, module: { name } }`. Match by `className` (case-insensitive). Cache the response per backend host (TTL 24h).

### 7c. List reference lists (for dropdown / radio / checkboxGroup)

```bash
curl -s -G "$BASE_URL/api/services/Shesha/ReferenceList/GetAll" \
  --data-urlencode "MaxResultCount=500" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `result.items[]` with `{ id, name, module: { name } }`. Required for validating `referenceListId: { name, module }` shape on dropdown-family components.

---

## 8. List forms in a module (browsing)

`GET /api/services/Shesha/FormConfiguration/GetAll?Filter={...}` — ABP `GetAll` with paging. Easier:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetAll" \
  --data-urlencode "MaxResultCount=200" \
  --data-urlencode 'Filter={"and":[{"==":[{"var":"module.name"},"PBF.MembershipManagement"]}]}' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `result.items[]` with `{ id, name, label, module: {...} }`.

### 8a. Search forms by suffix / fuzzy name (complementary-form discovery)

For finding `{entity}-details*`, `{entity}-create*`, etc. — used by [templates.md](templates.md) and [resolve.md](resolve.md):

```bash
# Suffix-tolerant: name LIKE 'member-details%'
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetAll" \
  --data-urlencode 'Filter={"and":[{"==":[{"var":"module.name"},"PBF.MembershipManagement"]},{"like":[{"var":"name"},"member-details%"]}]}' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Pick the candidate without an `additional-descriptor` first (e.g. `member-details` beats `member-details-for-mvp`). Rank by suffix-exactness first, then by similarity to the user's hint.

---

## 9. Common errors

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing / expired token | Re-run Step 2 |
| `403 Forbidden` | User lacks `app:Configurator` permission | Login as admin (default has it) |
| `Form is not editable` | Module is read-only or imported-only | Module must have `IsEditable=true`; check `frwk.modules.is_editable` |
| `Module is null` | Form's module reference is broken | Reload the form, check `result.module` is populated |
| `Markup is not valid JSON` | The string you sent isn't parseable | Re-stringify; ensure no truncation in the curl `-d @file` form |
| Empty `result` from GetByName | Form doesn't exist under that name/module | Verify via `GetAll` |
| `result: null` on UpdateMarkup but `success: true` | Normal — endpoint returns void | No action |

---

## 10. Fetch entity metadata (`/Metadata/Get`)

Used by Step 1.5 of the skill to validate `propertyName` references against the actual entity. Try the `app` namespace first; fall back to `Shesha` if it 404s:

```bash
# Primary
curl -s -G "$BASE_URL/api/services/app/Metadata/Get" \
  --data-urlencode "container=PBF.MembershipManagement.Domain.Domain.Member" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Fallback (older / different routing)
curl -s -G "$BASE_URL/api/services/Shesha/Metadata/Get" \
  --data-urlencode "container=PBF.MembershipManagement.Domain.Domain.Member" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Expected response (ABP envelope; relevant fields):

```json
{
  "result": {
    "containerName": "PBF.MembershipManagement.Domain.Domain.Member",
    "entityFullName": "PBF.MembershipManagement.Domain.Domain.Member",
    "properties": [
      {
        "path": "firstName",
        "name": "firstName",
        "label": "First Name",
        "dataType": "string",
        "required": false,
        "readOnly": false,
        "referenceListName": null,
        "referenceListModule": null,
        "entityType": null
      }
    ]
  }
}
```

Save raw response to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json`, then distill:

```bash
node .claude/skills/shesha-form-edit/scripts/summarize.js \
  .claude/cache/shesha-form-edit/metadata/Member.raw.json \
  --type metadata \
  --out .claude/cache/shesha-form-edit/metadata/Member.summary.md
```

Validation pass: for every input component in the edit, confirm `propertyName` matches a `properties[].path` (top-level only — nested-path validation is out of scope). Mismatches must be surfaced to the user before push.

**TTL**: 24 hours. Use `--refresh-cache` to force a re-fetch + re-distill. Invalidate manually after running new migrations or model-type changes.

---

## 11. Round-trip verify (post-push)

Step 8 of the skill. Re-fetch the form just pushed and diff against the markup we sent:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  > /tmp/form-after.json
```

Then in Node:

```js
const sent = JSON.parse(fs.readFileSync('/tmp/form-sent.json', 'utf8'));
const after = JSON.parse(JSON.parse(fs.readFileSync('/tmp/form-after.json', 'utf8')).result.markup);
// Walk both trees in component-id order; surface any property whose value differs.
```

For anonymous forms, also confirm the envelope: re-fetch via `GetByName` and assert `result.access === 5`. The `Create` endpoint may not honor `access` on initial create; on mismatch, call `UpdateMarkup` once more with `access: 5, permissions: []` and re-verify.

Common server normalizations to ignore (not bugs): re-ordered keys inside an object, whitespace inside string-encoded `stylingBox` values, `null` → `undefined` collapsing on optional fields. Anything else — surface to the user.

---

## 12. Browser smoke via the playwright skill

Step 9 of the skill. Invoke as:

```
Skill(skill="playwright", args="<directive>")
```

### Authentication: log in via the form, NOT via localStorage injection

> **Do not** try to inject `accessToken` into `localStorage` before navigating. Most Shesha builds wire auth through the **`auth-login`** form's `Sign In` action which sets multiple storage keys (token + refresh token + user descriptor) AND triggers a `Session/GetCurrentLoginInformations` bootstrap. Hand-setting one key leaves the SPA stuck on `Initializing…`.

**Correct flow** for any `/dynamic/...` route:

1. Navigate to **`<FRONTEND_URL>/login`** (most projects have this as a redirect → `/no-auth/<module>/auth-login`). If `/login` 404s, fall back to the explicit `/no-auth/<module>/auth-login` for the project's module.
2. Fill the email + password inputs with the project's test credentials (default `admin@shesha.io` / `123qwe` — but see "Credential gotcha" below).
3. Click the form's submit button (typically `button:has-text("Login")` or `button[type="submit"]`).
4. Wait for redirect OFF the login route (`waitForFunction(() => !location.pathname.includes('auth-login') && !location.pathname.includes('/login'))`).
5. Now navigate to the target `/dynamic/...` form.

**Credential gotcha:** the Shesha backend's `TokenAuth/Authenticate` accepts a `userName` (e.g. `admin`) OR an email. The frontend `auth-login` form may bind to a property called `userNameOrEmailAddress` but render an `Email address` input with **client-side email-regex validation** that rejects bare usernames. Always pass an email format. The default admin in most local-dev Sheshas has an email like `admin@shesha.io` — confirm by querying `User/GetAll` and reading the row with `roleNames` containing `ADMIN`. If that user has `emailAddress: null`, ask the user for working test credentials rather than guessing.

### Directive template

> Open `<FRONTEND_URL>/<TARGET_PATH>` in a fresh browser context.
> If `<TARGET_PATH>` starts with `/dynamic/...`, **log in first**:
>   - Navigate to `<FRONTEND_URL>/login` (fall back to `/no-auth/<module>/auth-login`).
>   - Wait for the email input to render. Fill `admin@shesha.io` / `123qwe` (or the credentials the user provided).
>   - Click the submit button. Wait until `location.pathname` no longer contains `auth-login` or `/login`.
> If `<TARGET_PATH>` starts with `/no-auth/...`, no login needed.
> Set any required preconditions (e.g. `localStorage.selectedTier = "<id>"`) AFTER login but BEFORE navigating to the target form.
> Navigate to the target. Wait for `.sha-form` selector or 5s timeout.
> Capture: full-page screenshot, all console messages level `error` or `warning`, all network responses with `status >= 400`.
> Then click the primary action button (if any) and capture again.
> Report: a one-paragraph summary, screenshot paths, and any captured errors / 4xx-5xx network responses verbatim.

### Frontend URL detection

The PBF project has two front-end apps:
- `adminportal/` — typical dev port `http://localhost:3000`
- `publicportal/` — typical dev port `http://localhost:3001`

Read the actual port from `<app>/.env*` (e.g. `PORT=3001`) or `<app>/package.json` `scripts.dev`. Anonymous forms (`access: 5`) usually live in `publicportal`; authenticated forms in `adminportal`. If neither is running, skip the smoke step and warn the user.

### Failure handling

Any captured error → consult [debug.md](debug.md) before guessing. Never silently re-edit and re-push. If the smoke step itself errors out (browser can't connect), warn the user and offer to skip via `--no-browser`.
