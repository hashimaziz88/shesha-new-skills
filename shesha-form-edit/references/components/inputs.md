# Input components — text, number, date, checkbox, file, validation

For dropdown / radio / checkboxGroup / refListStatus → [dropdowns.md](dropdowns.md).
For autocomplete / entityPicker → [selectors.md](selectors.md).

All interactive inputs require `editMode: "editable"`. See [edit-mode.md](edit-mode.md).

---

## textField

```json
{
  "id": "...",
  "type": "textField",
  "propertyName": "firstName",
  "label": "First Name",
  "validate": { "required": true, "maxLength": 100 },
  "placeholder": "Jane",
  "size": "middle",
  "editMode": "editable",
  "parentId": "..."
}
```

Variants: `textArea` (multiline), `passwordCombo` (password + confirm).

---

## numberField

```json
{
  "id": "...",
  "type": "numberField",
  "propertyName": "capacity",
  "label": "Capacity",
  "min": 0,
  "max": 10000,
  "step": 1,
  "precision": 0,
  "editMode": "editable"
}
```

---

## dateField / timePicker / calendar

```json
{
  "id": "...",
  "type": "dateField",
  "propertyName": "startsAt",
  "label": "Starts At",
  "showTime": true,
  "format": "YYYY-MM-DD HH:mm",
  "validate": { "required": true },
  "editMode": "editable"
}
```

---

## checkbox / switch / threeStateSwitch

```json
{
  "id": "...",
  "type": "checkbox",
  "propertyName": "popiaConsent",
  "label": "POPIA consent",
  "editMode": "editable"
}
```

`threeStateSwitch` adds an "indeterminate" state — value is `true | false | null`.

---

## fileUpload / attachmentsEditor / imagePicker

```json
{
  "id": "...",
  "type": "fileUpload",
  "propertyName": "coverImage",
  "label": "Cover Image",
  "ownerType": "PBF.MembershipManagement.Domain.Domain.Event",
  "ownerName": "CoverImage",
  "editMode": "editable"
}
```

`ownerType` + `ownerName` link uploads to a `StoredFile` property on the entity (the framework wires the FK).

---

## Validation patterns

`validate` is a sub-object on input components:

```json
"validate": {
  "required": true,
  "minLength": 3,
  "maxLength": 100,
  "min": 0,
  "max": 1000,
  "regExp": "^[A-Z]{2}\\d{4}$",
  "validator": "value && value.startsWith('PBF')",
  "message": "Custom message shown when invalid"
}
```

`validator` is a JS expression (same script context as embedded scripts; see [scripts.md](scripts.md)) — must return truthy for valid. Invalid → AntD shows `validate.message`.

For complex business rules across fields, use **FluentValidation** on the .NET side (see the `shesha-fluent-validators` skill in the shesha-developer plugin) rather than per-component validators. UI validators can't enforce server-side invariants reliably.

### `validate.required` is the canonical shape

Some legacy forms have `required: true` at the component root. Prefer `validate: { required: true }` (matches the MCP transformer's output and the AntD form runtime expectation). `scripts/autofix.js` normalises root-level `required: true` into `validate.required` automatically.

### Regex escaping pitfall

`validate.regExp` is a string that becomes a JS `RegExp`. Backslashes need single escaping for the regex but JSON requires double escaping. So `^\d{10}$` is written as `"^\\d{10}$"` in JSON, which the runtime then parses to `^\d{10}$`.

### Date formats

`dateField.dateFormat` (Shesha default `"DD/MM/YYYY"`) controls display. Internally the value is a moment object; serialise via `formSettings.onPrepareSubmitData` if the server expects ISO. For date-only fields, set `showTime: false`.
