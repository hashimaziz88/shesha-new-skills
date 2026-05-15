# editMode, visibility, enabled, permissions

---

## editMode rule (non-negotiable)

**Every interactive component must have `editMode: "editable"`.** That includes `textField`, `textArea`, `numberField`, `dateField`, `dropdown`, `radio`, `checkbox`, `switch`, `button`, `link`, `autocomplete`, `entityPicker`, file uploaders.

If you omit `editMode` (or set it to `"inherited"`) on a form whose effective mode resolves to read-only — which happens for forms with `dataLoaderType: "none"`, public/anonymous pages, or details views — the component renders but won't accept input or clicks. Symptom: "looks fine but the field is greyed out / button does nothing." Fix is always the same: set `editMode: "editable"` explicitly.

Pure visual components — `text`, `image`, `container`, `columns`, `card` — keep `editMode: "inherited"` or omit it. They have no interactive surface.

When validating an edit: walk the tree and assert that every node whose `type` is in the interactive list has `editMode === "editable"`. Treat a missing or non-editable mode as a bug, not a styling choice.

---

## Visibility / enabled — four properties

| Property | Meaning |
|---|---|
| `hidden` | Boolean OR `IPropertySetting` with `_mode: 'code'` returning bool. When true, the component is removed from the DOM. |
| `customVisibility` | Pure JS expression returning bool (legacy form of `hidden`). Prefer `hidden` with the code-mode wrapper for new code. |
| `editMode` | `'editable'` \| `'readOnly'` \| `'inherited'`. **For interactive components, must be `'editable'`** (rule above). |
| `customEnabled` | JS expression returning bool. When false, the component renders but is disabled (greyed out). |

Use `hidden` (with code-mode wrapper) over `customVisibility` for new code — same effect, better DX:

```json
"hidden": {
  "_mode": "code",
  "_code": "formMode === 'create' && !data.parent"
}
```

Interaction rules: `editMode === 'readOnly'` always wins. `editMode === 'editable'` lets `customEnabled` decide. `editMode === 'inherited'` resolves against the form's effective mode and is risky on forms with no data loader (see the editMode rule above).

---

## Conditional containers

A `hidden` container hides itself AND its children. Don't combine with per-child `hidden` unless deliberately layered — the child rules don't override the parent's.

---

## Permissions

```json
"permissions": ["app:Members.View", "app:Members.Edit"]
```

The component is hidden if the user lacks **all** listed permissions. To require ALL, list them. To require ANY, use a single hook permission and group via roles.

Form-level permissions live on the FormConfiguration record itself (set via the designer or the API), not in markup.
