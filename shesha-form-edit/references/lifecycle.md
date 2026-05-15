# Form lifecycle hooks

Hooks defined on `formSettings` that fire at specific points in the form's life. Use when the user asks for behavior outside the component tree (init from URL params, derived fields, transform-before-submit, navigate-after-save).

---

## Hook reference

| Hook | When it fires | Must return | Common uses |
|---|---|---|---|
| `onBeforeDataLoad` | Before the data loader runs | nothing | Seed fields from `form.formArguments` / `pageContext` |
| `onAfterDataLoad` | After data is fetched and bound | nothing | Compute derived fields; cross-fetch related data |
| `onPrepareSubmitData` | Just before submit's payload is built | the payload object | Transform / enrich / strip fields |
| `onBeforeSubmit` | Right before submit API call | `true` to proceed, `false` to cancel | Last-mile validation; user confirmation |
| `onSubmitSuccess` | After save success | nothing | Navigate; show toast; clear context |
| `onSubmitFailed` | After save error | nothing | Custom error UI; log |

Hooks are **string properties** on `formSettings`. The framework wraps the string into a function; you write the function body.

---

## Script context inside lifecycle hooks

Same script context as embedded scripts ([components/scripts.md](components/scripts.md)). Hooks additionally expose:

- `form.formArguments` — URL query parameters as an object (e.g. `?id=abc` → `{ id: "abc" }`)
- For `onPrepareSubmitData`: the parameter is the proposed payload; mutate or replace, then return.
- For `onBeforeSubmit`: returning `false` (or a Promise resolving to `false`) cancels the submit.
- For `onSubmitSuccess` / `onSubmitFailed`: the response / error object is accessible via the framework but typically you re-read `data.*` instead.

---

## Canonical patterns

### Seed from URL params

```js
// formSettings.onBeforeDataLoad
form.setFieldsValue({ ...form.formArguments });
```

Use when the form receives parameters via `?paramName=value` query string (e.g. landing pages, dialogs opened with context).

### Compute derived fields after load

```js
// formSettings.onAfterDataLoad
try {
  const age = moment().diff(moment(data.dateOfBirth), 'years');
  setFormData({ values: { age }, mergeValues: true });
} catch (err) { /* ignore */ }
```

### Strip-and-transform before submit

```js
// formSettings.onPrepareSubmitData (arg: proposed payload)
const out = { ...arguments[0] };
delete out._computedField;
if (out.dateOfBirth) out.dateOfBirth = moment(out.dateOfBirth).toISOString();
return out;
```

### Last-mile confirmation

```js
// formSettings.onBeforeSubmit
return new Promise(resolve => {
  if (!data.acceptTerms) {
    message.error('You must accept the terms');
    return resolve(false);
  }
  resolve(true);
});
```

### Navigate after create success

```js
// formSettings.onSubmitSuccess
application.navigator.navigateToForm(
  { name: 'member-details', module: 'PBF.MembershipManagement' },
  { id: data.id }
);
```

### Custom error UI

```js
// formSettings.onSubmitFailed
const msg = arguments[0]?.response?.data?.error?.message ?? 'Save failed';
message.error(msg, 5);
```

---

## When to use hooks vs action chains

- **Action chains** ([action-chains.md](action-chains.md)) — explicit user-triggered flows tied to a button or interaction.
- **Lifecycle hooks** — implicit behavior tied to the form's data flow.

A "Save" button on a details form normally uses `actionName: "Submit"`; the post-save navigation lives in `formSettings.onSubmitSuccess`, not on the button's `onSuccess`. Putting it on the button works but breaks if the user submits via Enter or another path.

For dialog-style create forms with framework-added Save/Cancel buttons (no custom buttons authored), lifecycle hooks are the only available extension point.

---

## Default `onBeforeDataLoad` from MCP transformer

When the MCP scaffolds a new form, it injects:

```
    form.setFieldsValue({...form.formArguments});
```

(leading whitespace preserved). The skill should mirror this for new entity-bound forms that may be opened with URL parameters — it's harmless when there are no params and useful when there are.

---

## Async safety

All hooks are awaited. Wrap network calls in `try/catch`. Returning a rejected Promise is treated the same as throwing.

```js
// onAfterDataLoad
try {
  const res = await http.get('/api/services/app/Member/GetTier', { params: { id: data.id } });
  setFormData({ values: { tier: res.data.result }, mergeValues: true });
} catch (err) {
  // soft fail — don't block the form
}
```
