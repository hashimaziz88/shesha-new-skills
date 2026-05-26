# v7 Component Styling System

Shesha v7 containers (and some other components) use per-breakpoint style blocks instead of the `style` JS expression prop. This covers the full block structure, common patterns, and migration from v6.

---

## v6 vs v7

| | v6 | v7 |
|---|---|---|
| How styled | `"style": "return { backgroundColor: '#fff', ... }"` | `"desktop": { "background": {...}, "border": {...}, ... }` |
| Breakpoints | Single style for all | Separate `desktop` / `tablet` / `mobile` keys |
| Version field | 1–6 | 7+ |
| Works with | `container`, some old components | `container` (v7+), newer components |

Always apply the same block to all three breakpoints unless you have viewport-specific layout differences.

---

## Full v7 style block

```json
{
  "border": {
    "hideBorder": false,
    "radiusType": "all",
    "borderType": "all",
    "border": {
      "all": { "width": 1, "color": "#e5e7eb", "style": "solid" },
      "top": {}, "bottom": {}, "left": {}, "right": {}
    },
    "radius": { "all": 12 }
  },
  "background": {
    "type": "color",
    "color": "#ffffff",
    "repeat": "no-repeat",
    "size": "auto",
    "position": "center",
    "gradient": { "direction": "to right", "colors": {} },
    "url": "",
    "storedFile": { "id": null },
    "uploadFile": null
  },
  "font": {
    "color": "#1a1a1a",
    "type": "Segoe UI",
    "align": "left",
    "size": 14,
    "weight": "400"
  },
  "dimensions": {
    "width": "100%",
    "height": "auto",
    "minHeight": "0px",
    "maxHeight": "auto",
    "minWidth": "0px",
    "maxWidth": "100%"
  },
  "shadow": {
    "offsetX": 0,
    "offsetY": 1,
    "color": "rgba(0,0,0,0.06)",
    "blurRadius": 4,
    "spreadRadius": 0
  },
  "stylingBox": "{\"paddingTop\":\"24\",\"paddingBottom\":\"24\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}",
  "enableStyleOnReadonly": false,
  "flexDirection": "column",
  "direction": "vertical",
  "justifyContent": "flex-start",
  "alignItems": "stretch",
  "flexWrap": "nowrap",
  "gap": "0",
  "overflow": true
}
```

---

## `stylingBox` encoding

`stylingBox` is a **JSON-string** (not a nested object). Values are strings even for numbers.

```json
"stylingBox": "{\"paddingTop\":\"24\",\"marginLeft\":\"-32\"}"
```

Supported keys: `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`, `marginTop`, `marginBottom`, `marginLeft`, `marginRight`. These are the only keys — do NOT put `textTransform`, `color`, or other CSS in `stylingBox`.

---

## Per-side borders (`borderType: "custom"`)

To set only some sides (e.g. left accent + bottom rule):

```json
"border": {
  "hideBorder": false,
  "radiusType": "all",
  "borderType": "custom",
  "border": {
    "all": { "width": 1, "color": "#e5e7eb", "style": "none" },
    "top": {},
    "bottom": { "width": 1, "color": "#e5e7eb", "style": "solid" },
    "left": { "width": 4, "color": "#fa8c16", "style": "solid" },
    "right": {}
  },
  "radius": { "all": 0 }
}
```

- Set `borderType: "custom"` (not `"all"`) to activate per-side overrides.
- Empty `{}` on a side means "no border on that side."
- `all` acts as the fallback for sides that aren't explicitly overridden; when `borderType: "custom"`, per-side entries take precedence.

---

## Design token set (base-project-details baseline)

| Role | Value |
|---|---|
| Card surface | `#ffffff` |
| Page background | `#f3f4f6` |
| Header strip bg | `#f8fafc` |
| Section divider bg | `#f9fafb` |
| Border / divider | `#e5e7eb` |
| Light rule | `#f0f0f0` |
| Brand accent | `#fa8c16` |
| Ink (primary text) | `#111827` |
| Body text | `#1a1a1a` |
| Muted (labels) | `#6b7280` |
| Section heading | `#374151` |
| Card border radius | `12` |
| Sub-card radius | `8` |
| Card shadow | `offsetY:1, blur:4, color:rgba(0,0,0,0.06)` |
| Sub-card shadow | `offsetY:1, blur:3, color:rgba(0,0,0,0.05)` |

---

## Common patterns

### White card sub-container
```json
"border": { "borderType": "all", "border": { "all": { "width":1, "color":"#e5e7eb", "style":"solid" }, ... }, "radius": { "all": 8 } },
"background": { "type": "color", "color": "#ffffff" },
"shadow": { "offsetX":0, "offsetY":1, "color":"rgba(0,0,0,0.05)", "blurRadius":3, "spreadRadius":0 },
"stylingBox": "{\"paddingTop\":\"12\",\"paddingBottom\":\"12\",\"paddingLeft\":\"16\",\"paddingRight\":\"16\"}"
```

### Tinted header strip (full-bleed)
```json
"background": { "type": "color", "color": "#f8fafc" },
"border": { "borderType": "custom", "border": { "all": { "style": "none" }, "bottom": { "width":1, "color":"#e5e7eb", "style":"solid" }, ... } },
"stylingBox": "{\"paddingTop\":\"20\",\"paddingBottom\":\"20\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}"
```
Root container must have `pt=0, pl=0, pr=0` so header spans full card width.

### Left accent (branded title container)
```json
"border": { "borderType": "custom", "border": { "all": { "style": "none" }, "left": { "width":4, "color":"#fa8c16", "style":"solid" }, ... } },
"stylingBox": "{\"paddingLeft\":\"16\",\"paddingTop\":\"4\",\"paddingBottom\":\"4\"}"
```

### Toolbar row
```json
"background": { "type": "color", "color": "#ffffff" },
"border": { "borderType": "custom", "border": { "top": { "width":1, "color":"#e5e7eb", "style":"solid" }, "bottom": { "width":1, "color":"#f0f0f0", "style":"solid" }, ... } },
"direction": "horizontal",
"justifyContent": "flex-end",
"alignItems": "center",
"gap": "8",
"stylingBox": "{\"paddingTop\":\"12\",\"paddingBottom\":\"12\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}"
```

---

## font.color on text components

`text` components expose `fontSize` and `fontWeight` as **direct props** (not inside `desktop`). For **color**, set `desktop.font.color`:

```json
{
  "type": "text",
  "fontSize": "text-xs",
  "fontWeight": "500",
  "desktop": {
    "font": { "color": "#6b7280", "type": "Segoe UI", "size": 11, "weight": "500" }
  },
  "tablet": { "font": { ... } },
  "mobile": { "font": { ... } }
}
```

Note: `fontSize` as a direct prop uses Tailwind class strings (`"text-xs"`, `"text-2xl"`), while `desktop.font.size` is a number (`11`, `24`). Both need to be set if you want consistent rendering across all contexts.

---

## Migrating v6 → v7

1. Increment `version` to `7`.
2. Remove `style` JS expression prop.
3. Add `desktop`, `tablet`, `mobile` blocks (same object for all three at first; adjust per-breakpoint later if needed).
4. Move any margin/padding values from the old `style` return into `stylingBox`.
5. Move `backgroundColor` → `background.color`, `borderRadius` → `border.radius.all`, `boxShadow` → `shadow.*`.
6. Remove `shadowStyle` if present (v6 relic).
