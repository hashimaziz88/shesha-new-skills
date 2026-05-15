# Container / card / columns / tabs

Layout components. All keep `editMode: "inherited"` or omit it (no interactive surface).

---

## container

Layout wrapper. Children go in `components: []`. Direction defaults to column.

```json
{
  "id": "...",
  "type": "container",
  "label": "Personal Info",
  "direction": "vertical",
  "components": [ /* children */ ],
  "desktop": {
    "dimensions": { "width": "100%" },
    "flexDirection": "column"
  }
}
```

Per-breakpoint settings live under `desktop` / `tablet` / `mobile` keys.

Use containers as semantic divs for grouping related rows (consents block, action row, footer row). See [layout.md](layout.md) for the full house pattern.

---

## card

Shesha's card component — a bordered, rounded, optionally-shadowed white box. **Children do NOT go in `components`** — they go in `content.components`. The card has two slots:

```json
{
  "id": "...",
  "type": "card",
  "propertyName": "myCard",
  "componentName": "myCard",
  "parentId": "...",
  "header": {
    "id": "...",
    "components": []          // usually empty for full-page forms
  },
  "content": {
    "id": "...",
    "components": [ /* the actual children */ ]
  }
}
```

**Common bug**: pushing children directly onto `card.components` and watching them silently disappear from the rendered output. Walk + push always go through `card.content.components`.

When walking the tree: recurse into both `header.components` and `content.components`. When updating ids: both slots' nested `id` keys must be regenerated coherently with their children's `parentId`.

The card's outer width defaults to its parent's width. To constrain it, set `desktop.dimensions.maxWidth` on the card itself, or wrap it in a fixed-max-width inner container.

---

## columns

Two-up / three-up layouts. `columns` array has child slots:

```json
{
  "id": "...",
  "type": "columns",
  "columns": [
    { "id": "...", "flex": 12, "components": [ /* left */ ] },
    { "id": "...", "flex": 12, "components": [ /* right */ ] }
  ],
  "gutterX": 8,
  "gutterY": 8
}
```

**Total `flex` must be 24** across direct columns. (`12+12`, `8+8+8`, `6+6+6+6`, `16+8`.)

For a simple inline text + link row, prefer a sub-`container` with `flexDirection: "row"` and `alignItems: "baseline"` — wraps cleaner on narrow viewports than a `columns` does.

---

## tabs

```json
{
  "id": "...",
  "type": "tabs",
  "tabs": [
    {
      "id": "...",
      "key": "personal",
      "title": "Personal",
      "components": [ /* tab content */ ]
    },
    {
      "id": "...",
      "key": "business",
      "title": "Business",
      "components": [ /* ... */ ],
      "hidden": { "_mode": "code", "_code": "data.accountType !== 'PBF'" }
    }
  ],
  "defaultActiveKey": "personal"
}
```

Per-tab `hidden` lets you conditionally show tabs (uses the IPropertySetting wrapper — see [form-shape.md](form-shape.md)).
