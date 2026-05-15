# button / buttons (toolbar) / link / subForm — actions and configurable-action shape

All interactive — require `editMode: "editable"`.

---

## button (single)

```json
{
  "id": "...",
  "type": "button",
  "label": "Approve",
  "buttonType": "primary",
  "icon": "CheckOutlined",
  "editMode": "editable",
  "actionConfiguration": {
    "actionOwner": "Shesha.Common",
    "actionName": "ExecuteScript",
    "actionArguments": {
      "expression": "try { await http.post('/api/services/PBF.MembershipManagement/Application/Approve', { id: data.id }); message.success('Approved'); } catch (err) { message.error(err?.response?.data?.error?.message ?? 'Failed'); }"
    }
  }
}
```

`actionConfiguration` is the standard configurable-action shape. Common `actionName` values:

| actionName | What it does |
|---|---|
| `ExecuteScript` | Run JS (above example) |
| `Navigate` / `NavigateAction` | Go to URL — `actionArguments: { navigationType: "url", url: "..." }` |
| `ShowDialog` / `ShowModal` | Open modal |
| `Submit` (in form) | Submit the parent form |
| `ExecuteEndpoint` | Call a configured endpoint with mapped args |
| `Sign In` (`actionOwner: "shesha.common"`) | Read form's `userNameOrEmailAddress` + `password`, call `TokenAuth/Authenticate`. After success, `actionResponse.url` holds the Shesha-default landing URL. Compose with `onSuccess` for custom routing. |

### onSuccess / onFail composition

```json
"actionConfiguration": {
  "actionOwner": "shesha.common",
  "actionName": "Sign In",
  "handleSuccess": true,
  "handleFail": true,
  "onSuccess": {
    "_type": "action-config",
    "actionOwner": "shesha.common",
    "actionName": "Execute Script",
    "actionArguments": {
      "expression": "const tier = contexts.appContext.pbfSelectedTier; if (tier) { application.navigator.navigateToUrl('/dynamic/PBF.MembershipManagement/member-registration'); } else { application.navigator.navigateToUrl(actionResponse?.url || '/dynamic/PBF.MembershipManagement/tier-pricing'); }"
    }
  },
  "onFail": {
    "actionOwner": "shesha.common",
    "actionName": "Execute Script",
    "actionArguments": {
      "expression": "if (actionError?.response) { message.error(actionError.response.data.error.details || actionError.response.data.error.message, 5); }"
    }
  }
}
```

`actionResponse` (in `onSuccess`) and `actionError` (in `onFail`) are the globals exposed in those nested scripts.

---

## buttons (toolbar — plural)

`items` array of `{ id, type: 'button' | 'separator' | 'group', ... }`. Each button-typed item carries its own `actionConfiguration`.

---

## link

Inline anchor link — for "Sign in", "Forgot password", "Create one" style links inside a text row. **Not** a button styled as link; the visual rendering and the action wiring are different.

```json
{
  "id": "...",
  "type": "link",
  "propertyName": "signInLink",
  "componentName": "signInLink",
  "label": "link1",
  "hideLabel": true,
  "content": "Sign in",
  "target": "_self",
  "editMode": "editable",
  "actionConfiguration": {
    "_type": "action-config",
    "actionName": "Navigate",
    "actionOwner": "shesha.common",
    "handleSuccess": false,
    "handleFail": false,
    "actionArguments": {
      "navigationType": "url",
      "url": "/no-auth/PBF.MembershipManagement/auth-login"
    }
  }
}
```

Notes:
- The visible text comes from `content`, **not** `label`. `label` is the designer-side caption (kept hidden via `hideLabel: true`).
- `target` is `"_self"` (default) or `"_blank"`.
- `editMode: "editable"` is required, otherwise the click is swallowed.
- Compose with a parent sub-`container` (`flexDirection: "row"`, `alignItems: "baseline"`) when placing inline alongside `text`.

---

## subForm

Embed another form configuration:

```json
{
  "id": "...",
  "type": "subForm",
  "propertyName": "address",
  "formId": { "module": "Shesha", "name": "address-edit" },
  "modelType": "Shesha.Domain.Address",
  "queryParamsExpression": "{ id: data.address?.id }"
}
```

---

## OTP endpoints (auth-flow specific)

For auth/registration flows that use OTP:

| Endpoint | Body |
|---|---|
| `POST /api/services/app/Otp/SendPin` | `{ sendTo, sendType: 1=phone \| 2=email }` |
| `POST /Otp/VerifyPin` | `{ operationId, pin }` |
| `POST /Otp/ResendPin` | `{ operationId }` |

Stash the returned `operationId` between pages via `contexts.appContext.otpOperationId` (NOT `localStorage` — see [shared-state.md](shared-state.md)).

---

## Implicit submit on entity forms

Most member/details forms have an implicit submit button via `formSettings.onSubmit`. Explicit `button` with `actionName: "Submit"` is for custom toolbars.
