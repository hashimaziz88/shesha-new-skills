# KeyInformationBar

A horizontal banner that shows the most important properties of a record at the top of a details form. Has hard invariants — get them wrong and the bar renders broken or duplicated.

---

## Canonical shape

```json
{
  "id": "...",
  "type": "keyInformationBar",
  "componentName": "memberKeyInfo",
  "label": "",
  "hideLabel": true,
  "stylingBox": "{\"paddingTop\":12,\"paddingBottom\":12}",
  "components": [
    {
      "id": "...",
      "type": "container",
      "flexDirection": "column",
      "textAlign": "center",
      "dimensions": { "width": "200px" },
      "components": [
        {
          "id": "...",
          "type": "text",
          "content": "Member ID",
          "font": { "weight": "bold", "size": 12 }
        },
        {
          "id": "...",
          "type": "textField",
          "propertyName": "memberRef",
          "editMode": "readOnly",
          "hideLabel": true
        }
      ]
    },
    /* up to 2 more columns */
  ]
}
```

---

## Invariants

1. **Max 3 properties** — more than 3 collapses on mobile and creates visual clutter. Pick the highest-signal ones (Status, Reference Number, Tier).
2. **Children forced `editMode: "readOnly"`** — KeyInformationBar is a display widget, not an editing widget. The MCP transformer overrides any other editMode on children.
3. **Children forced `hideLabel: true`** — labels appear above each value as a separate `<text>` element (see canonical shape above). The component itself's label would duplicate.
4. **Each property is wrapped in its own column container** — `width: 200px`, centered text, column flex direction. Don't put bare text fields directly in `keyInformationBar.components`.
5. **Label `<text>` element uses `font.weight: "bold"`** — small, bold caption above the value.

---

## When to use

- Details forms with 3+ properties that matter at-a-glance (Status, Reference, Tier).
- Dashboards as a "current state" banner.

## When NOT to use

- Forms with <3 important properties — use inline text instead.
- Forms with many equally-important properties — use a normal field group with proper labels.
- Anywhere editing is expected — KeyInformationBar is read-only by contract.

---

## Pairing with `refListStatus`

For reference-list-typed display values (Status, etc.), use `refListStatus` instead of `textField` as the value component:

```json
{
  "id": "...",
  "type": "refListStatus",
  "propertyName": "status",
  "hideLabel": true,
  "module": "Shesha",
  "referenceListName": "MemberStatus",
  "showIcon": true
}
```

Note: `refListStatus` uses **flat keys** (`module`, `referenceListName`) — see [dropdowns.md](dropdowns.md).
