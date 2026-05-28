# Seed catalog — `assets/templates/` + `assets/patterns/`

Two folders, two purposes. **`scripts/scaffold.js` reads `templates/` automatically — you don't need to manually copy seeds.**

`scaffold.js` resolves seeds in this order: `templates/primary/<name>.json` → `templates/examples/<name>.json` → `templates/<name>.json` (legacy). Add new seeds wherever fits; the resolver finds them.

---

## `assets/templates/primary/` — the canonical 3 (used most often)

Foundational seeds for the CRUD trinity. Together they cover ~70% of real-world Shesha form work. If a user request maps to one of these, prefer it over an "example" seed.

| Template | Use when | What scaffold.js does |
|---|---|---|
| `primary/details.json` | View/edit one record | Substitutes placeholders, id-remaps, splices generated input components into `__SLOT_FIELDS__` container. Keeps Notes tab last; gates Edit/Save/Cancel by `form.formMode`. |
| `primary/table.json` | List/browse records | Substitutes placeholders, id-remaps, appends generated data columns after the action column inside `datatable.items[]`. Wires Add button to `{entity}-create` and action column to `{entity}-details`. Empty state, striped rows, frozen headers, hover highlight. |
| `primary/create.json` | Add a new record (dialog) | Substitutes placeholders, id-remaps, splices generated input components into `__SLOT_FIELDS__`. No Save/Cancel buttons (the dialog adds them). `onSubmitSuccess` navigates to `{entity}-details`. |

These are battle-tested and styled by the design-token pass. Don't hand-edit during a scaffold run. If an invariant is wrong, fix the seed and bump `_template.version`.

---

## `assets/templates/examples/` — specialised + enterprise patterns

Seven seeds covering enterprise / government workflow shapes that don't fit the CRUD trinity. Each is opinionated — copy as a starting point, then mutate per project.

| Template | Use when | Entity-bound? | Notes |
|---|---|---|---|
| `examples/wizard.json` | Multi-step application / KYC / onboarding | yes | Layout-polish sections become wizard steps. Submit navigates to `{entity}-details`. |
| `examples/approval-flow.json` | Submit → review → approve/reject | yes | KeyInfoBar + 3 tabs (Request Details / Comments / History) + Approve/Reject/Request-Changes toolbar wired to `/api/services/app/{Entity}/Approve` and `/Reject`. |
| `examples/audit-trail.json` | Change-history page for an entity | yes | Wraps `EntityHistory/GetAuditTrail`. Filter row, paginated diff table, Export-to-Excel. |
| `examples/citizen-profile.json` | Self-service profile / "My Account" | yes | 4 tabs (Profile / Documents / Applications / History) + Edit/Save/Cancel toolbar gated by `form.formMode`. |
| `examples/document-submission.json` | KYC docs / required-doc checklist | yes | 3 example doc cards (ID / Address / Supporting) using `fileUpload` + `attachmentsEditor`. Submit-for-Review POSTs to `/api/services/app/{Entity}/SubmitDocuments`. |
| `examples/dashboard-departmental.json` | Departmental landing page with KPIs | no (entity optional) | 4 KPI statistic cards (TODO endpoints), recent-activity entity-table, quick-action row. |
| `examples/reports-printable.json` | Printable A4 report with signature block | no (entity optional) | Org logo + meta + title + summary + detail table + Prepared/Reviewed/Approved signatures + Print/PDF buttons. |

When you ship a new specialised seed, drop it in `examples/` and the resolver picks it up automatically — only declare it in `scripts/scaffold.js`'s `TEMPLATES` registry if it needs different pipeline flags (e.g., `entityBound`, `sectionsBecomeSteps`).

---

## `assets/patterns/` — copy-and-edit reference forms

Real-form seeds for cases scaffold.js doesn't cover. Copy into your edit, run the id-remap pass (`scaffold.js`'s `idRemap` function is the reference impl), then mutate.

| Pattern | Use for | Notes |
|---|---|---|
| `auth-login.json` | Login, register, forgot-password, OTP, branded confirmation — any anonymous auth-style page | Outer container → card → image (logo) → inner container → fields → primary action → footer link row. PBF-branded; swap logos and copy as needed. Set `formSettings.access = 5` for anonymous pages. |
| `dashboard.json` | Logged-in landing pages, entity-bound dashboards with a summary card + nested datalist + conditional empty state | Welcome banner + action row + entity-bound `subscriptionCard` (with `dataTableContext` + sub-form-renderer `datalist`) + `noSubscriptionCard` empty state gated on `data?.hasSubscription`. Strong reference for "summary card + items list" layouts. Note the `onBeforeDataLoad` pattern for hydrating from multiple `http.get` calls. |

---

## What belongs where

| Belongs in `templates/primary/` | Belongs in `templates/examples/` | Belongs in `patterns/` |
|---|---|---|
| The canonical CRUD trinity — details / table / create | Specialised parameterised seeds (wizard, approval, audit, dashboard, etc.) | Non-parameterised reference forms (auth-login, dashboard.json) |
| Used by ~70% of scaffold runs | Used for enterprise / gov workflow shapes | Copied + edited by hand |
| Read + transformed by scaffold.js | Read + transformed by scaffold.js | Not driven by scaffold.js |

## What does NOT belong in either

- Project-tied row templates (e.g. `tier-benefit-row`) — those go in `.claude/cache/shesha-form-edit/seeds/`.
- One-off PUT bodies, builder scripts, scratch JSON — those go in `.claude/cache/shesha-form-edit/_archive/`.
- Forms that only work because of project-specific entity binding — keep in `seeds/`.

## Promoting / adding seeds

**`seeds/` → `patterns/`**: scrub project-specific entity refs (or tag them as "replace this with your entity"), confirm the structure has been used at least twice in different projects, add a row to the patterns table above.

**`examples/` → `primary/`**: a seed graduates to `primary/` only after it's used heavily across multiple projects AND is structurally CRUD-like enough to belong with the trinity. Most seeds should stay in `examples/` — that folder is the right home for opinionated, project-shaped templates.

**Adding a brand-new template**: drop the file directly in `templates/examples/<name>.json`. The resolver finds it automatically. Required steps:

1. Parameterise every entity-tied identifier with `__PLACEHOLDER__` strings (`__ENTITY__`, `__ENTITY_KEBAB__`, `__ENTITY_PRETTY__`, `__ENTITY_PRETTY_PLURAL__`, `__MODULE__`, `__MODEL_TYPE__`).
2. If the seed needs field extraction, mark the target container with `propertyName: "__SLOT_FIELDS__"`.
3. Add an entry to `scripts/scaffold.js`'s `TEMPLATES` registry with the right flags:
   - `entityBound` — true if the template requires a resolved entity (Metadata fetch + field extraction).
   - `fieldsSlot` — the slot marker (or `null` if no field extraction).
   - `polish` — true to run `layout-polish.js` (section clustering + 2-col pairing).
   - `keyInfoBar` — true to inject a KeyInformationBar above `validationErrors`.
   - `sectionsBecomeSteps` — true to convert layout-polish output into wizard steps (only useful for wizard-shaped templates).
4. Add a row to the table above.
5. Update `SKILL.md` and `cheatsheet.md` §1 (template selection matrix).
