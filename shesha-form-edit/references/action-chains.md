# Action chains — canonical patterns

The action catalog and the chain shapes that appear repeatedly across well-built Shesha forms. Load this when wiring buttons, dialogs, submit handlers, or any `actionConfiguration`.

---

## Action structure

```json
{
  "_type": "action-config",
  "actionOwner": "shesha.form" | "shesha.common" | "<contextId>",
  "actionName": "...",
  "actionArguments": { ... },
  "handleSuccess": false,
  "handleFail": false,
  "onSuccess": { /* same shape, omit _type at root */ },
  "onFail":    { /* same shape */ }
}
```

`handleSuccess` / `handleFail` are **booleans that gate** the `onSuccess` / `onFail` nodes. Set to `true` whenever you populate the corresponding handler — leaving them `false` silently disables the chain.

---

## Action catalog by owner

### `shesha.form` (form-scoped)

| `actionName` | Effect |
|---|---|
| `Submit` | Calls form's submit endpoint (`onPrepareSubmitData` → POST/PUT) |
| `Reset` | Reset form values to defaults |
| `Start Edit` | Switch `formMode` from `readonly` to `edit` |
| `Cancel Edit` | Switch back to `readonly`, discard unsaved values |
| `Refresh` | Reload form data via the data loader |
| `Validate` | Run validators; do not submit |

### `shesha.common` (app-scoped)

| `actionName` | `actionArguments` (key fields) |
|---|---|
| `Show Dialog` | `formId: { name, module }, modalTitle, showModalFooter, additionalProperties` |
| `Close Dialog` | (none) |
| `Show Confirmation Dialog` | `title, content, okText, cancelText` |
| `Execute Script` | `expression: "<js>"` |
| `Show Message` | `messageType: "success"|"info"|"warning"|"error", content` |
| `API Call` | `endpoint, method, params, payload` |
| `Navigate` | `navigationType: "url"|"form", url \| formId, queryParams` |

### Inside a `dataTableContext` (`actionOwner: "<contextId>"`)

| `actionName` | Effect |
|---|---|
| `Refresh table` | Re-fetch the context's data |
| `Toggle Advanced Filter` | Show/hide filter panel |
| `Toggle Columns Selector` | Show/hide column visibility selector |
| `Export to Excel` | Download current rows as xlsx |

**Always** write `actionOwner` as the **context's `id`** in the JSON, not its `componentName`. The skill's `scripts/autofix.js` will rewrite name → id when authoring with names is more readable.

---

## Cardinal rule: API Call must handle both success AND failure

The MCP repeats this **three times** in its instructions:

> Always include `handleFail: true` and `handleSuccess: true` with appropriate onFail and onSuccess handlers for API calls!

Every `API Call` action must have both nodes wired — typically a `Show Message` confirmation + a `Refresh` (success) and a `Show Message` error + optional rollback (fail). No exceptions.

---

## Parameter syntax — single vs double braces

| Action | Syntax | Example |
|---|---|---|
| `API Call` `params` / `payload` | single braces `{X}` | `{ "id": "{data.id}" }` |
| `Navigate` `queryParams` | double braces `{{X}}` | `?id={{selectedRow.id}}` |
| `Navigate` `formId.queryParams` | double braces `{{X}}` | `{ "id": "{{data.id}}" }` |

Mixing these produces silent navigation bugs.

---

## Canonical chain library

### 1. Delete row (confirm → API → refresh table)

```json
{
  "_type": "action-config",
  "actionOwner": "shesha.common",
  "actionName": "Show Confirmation Dialog",
  "actionArguments": {
    "title": "Delete record",
    "content": "Are you sure?",
    "okText": "Delete",
    "cancelText": "Cancel"
  },
  "handleSuccess": true,
  "onSuccess": {
    "actionOwner": "shesha.common",
    "actionName": "API Call",
    "actionArguments": {
      "endpoint": "/api/services/app/Member/Delete",
      "method": "DELETE",
      "params": { "id": "{selectedRow.id}" }
    },
    "handleSuccess": true,
    "handleFail": true,
    "onSuccess": {
      "actionOwner": "<datatableContext-id>",
      "actionName": "Refresh table"
    },
    "onFail": {
      "actionOwner": "shesha.common",
      "actionName": "Show Message",
      "actionArguments": { "messageType": "error", "content": "Delete failed" }
    }
  }
}
```

### 2. Add new (dialog → refresh table on submit success)

```json
{
  "_type": "action-config",
  "actionOwner": "shesha.common",
  "actionName": "Show Dialog",
  "actionArguments": {
    "formId": { "name": "member-create", "module": "PBF.MembershipManagement" },
    "modalTitle": "New Member",
    "showModalFooter": true
  },
  "handleSuccess": true,
  "onSuccess": {
    "actionOwner": "<datatableContext-id>",
    "actionName": "Refresh table"
  }
}
```

### 3. Row navigation (table action column → details form)

Use this as the **first column** on every TABLE form's `dataTable.items`:

```json
{
  "id": "...",
  "itemType": "item",
  "columnType": "action",
  "icon": "EyeOutlined",
  "actionConfiguration": {
    "_type": "action-config",
    "actionOwner": "shesha.common",
    "actionName": "Navigate",
    "actionArguments": {
      "navigationType": "form",
      "formId": { "name": "member-details", "module": "PBF.MembershipManagement" },
      "queryParams": { "id": "{{selectedRow.id}}" }
    },
    "handleSuccess": false,
    "handleFail": false
  }
}
```

### 4. Submit a create form → navigate to its details

Set on a Save button OR via `formSettings.onSubmitSuccess`:

```json
"onSubmitSuccess": "    application.navigator.navigateToForm({ name: 'member-details', module: 'PBF.MembershipManagement' }, { id: data.id });"
```

Or as an action chain on a custom Submit button:

```json
{
  "_type": "action-config",
  "actionOwner": "shesha.form",
  "actionName": "Submit",
  "handleSuccess": true,
  "onSuccess": {
    "actionOwner": "shesha.common",
    "actionName": "Navigate",
    "actionArguments": {
      "navigationType": "form",
      "formId": { "name": "member-details", "module": "..." },
      "queryParams": { "id": "{{data.id}}" }
    }
  }
}
```

### 5. Details-form toolbar (Edit / Save / Cancel / Audit Log)

| Button | Visible when | actionOwner | actionName |
|---|---|---|---|
| Edit | `formMode === 'readonly'` | `shesha.form` | `Start Edit` |
| Save | `formMode === 'edit'` | `shesha.form` | `Submit` |
| Cancel | `formMode === 'edit'` | `shesha.form` | `Cancel Edit` |
| Audit Log | always | `shesha.common` | `Show Dialog` with `formId: { name: 'entity-change-audit-log', module: 'Shesha' }`, `additionalProperties: { entityType: '<modelType>', entityId: '{data.id}' }` |

Use the `hidden` IPropertySetting in `_mode: "code"` to gate visibility on `formMode`.

### 6. Sign-In flow (auth-login)

After successful `Sign In`, route based on context:

```json
"onSuccess": {
  "actionOwner": "shesha.common",
  "actionName": "Execute Script",
  "actionArguments": {
    "expression": "const target = contexts.appContext.postLoginRedirect; application.navigator.navigateToUrl(target || actionResponse?.url || '/dynamic');"
  }
}
```

`actionResponse` in `onSuccess` exposes the action's raw response. For `Sign In`, `actionResponse.url` is Shesha's default landing URL.

### 7. OTP flow

| Step | Action |
|---|---|
| Send OTP | `API Call` `POST /Otp/SendPin` with `{ sendTo, sendType: 1|2 }`. `onSuccess`: stash `operationId` to `contexts.appContext.otpOperationId`, navigate to OTP page. |
| Verify | `API Call` `POST /Otp/VerifyPin` with `{ operationId, pin }`. `onSuccess`: navigate to next step (`member-registration`). |
| Resend | `API Call` `POST /Otp/ResendPin` with `{ operationId }`. |

See [components/shared-state.md](components/shared-state.md) for why `appContext` and not `localStorage`.

---

## Conventions

- For **idempotent reads**, you may omit `onSuccess` (data flows back via context).
- For **writes**, ALWAYS wire both branches. The user must know whether the action worked.
- Inline `Execute Script` inside `onSuccess` is fine for routing logic that needs context (e.g. `appContext` checks). Don't put network calls inside `Execute Script` — use a separate `API Call` action so the framework tracks success/fail.
- `Navigate` actions cannot be chained with another `Navigate` after — only one navigation per turn. To chain "navigate then refresh on arrival", set the destination form's `onAfterDataLoad`.

---

## Anti-patterns

| Bad | Why | Fix |
|---|---|---|
| `API Call` with `handleSuccess: false` | Failure silently swallowed | Always set both flags + handlers |
| Using `Navigate` `url` for in-app routes | Hard-codes URL; breaks on module rename | Use `navigationType: "form"` with `formId` object |
| `actionOwner: "indexTable"` (componentName) | Frontend doesn't resolve string names at runtime in JSON | Use the context's `id`; the autofix script resolves names |
| `handleFail: true` with empty `onFail` | Same as no handler | Always provide a `Show Message` fallback |
| Inline navigation inside `Execute Script` for a primary action | Bypasses framework's loading state, breadcrumbs | Use a dedicated `Navigate` action |
