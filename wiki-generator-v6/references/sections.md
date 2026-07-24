# Section Writing Guide — Global Format Standard

The discovered wiki (`wiki-Boxfusion_Epm-discovered.md`) is the reference
format. Every option (3, 4, 5, 6, 7) must produce output that matches this
structure exactly. Only the depth of content varies — never the shape.

---

## PAGE HEADER (always present)

```markdown
# {Project Name}

> Last verified: {YYYY-MM-DD} — {source used e.g. "graph.json from dotnet build Release"}
> CODEOWNER: {assign an owner or leave as placeholder}
> Docs source: /docs/wiki/{filename}.md

---
```

---

## SECTION 1 — Learning Objectives

**Opening line**: "After reading this wiki you will be able to:"
**Format**: bulleted list, 4–6 items, each starting with a verb
**Tone**: second person, present tense

```markdown
## Learning Objectives

After reading this wiki you will be able to:

- Understand the full technology stack and module boundaries
- Trace how a {core workflow} flows from {start} to {end}
- Know the actual API base paths and local service URLs
- Identify which parts of the codebase have the highest coupling scores
- Set up the backend for local development from a clean machine
```

---

## SECTION 2 — Overview

**Opening**: one paragraph, plain English, what it does and why it exists
**Tech stack**: inline in prose, key technologies bolded
**Companion modules**: mention if present
**API styles**: mention REST, GraphQL, SignalR if present
**End with**: namespace root and solution file path

```markdown
## Overview

{Project} is a **{framework} .NET 8 backend** for {business domain}. {one sentence
on what organisations use it for}. {one sentence on key capabilities}.

A companion **{Module}** module provides {brief description}.

The backend exposes both a **REST API** ({description}) and a **GraphQL API**.
{Background jobs} run via **{tool}**. {Real-time} uses **{tool}**.

**Namespace root**: `{Company.Project}`
**Solution file**: `{path/to/Solution.sln}`
**Full setup guide**: `{path/to/README.md}` (primary reference — this wiki does not duplicate it)
```

---

## SECTION 3 — Setup & Installation

**Pattern**: reference the README as primary source, summarise key points only
**Include**: prerequisites table, quick start code block, local service URLs table, key appsettings table
**Never**: duplicate the full README content

```markdown
## Setup & Installation

> [!NOTE]
> The canonical step-by-step setup instructions live in `{README path}`.
> This section summarises the key points and adds context not in the README.

### Prerequisites

| Prerequisite | Version | Notes |
|---|---|---|
| .NET SDK | 8.0+ | `dotnet --version` to confirm |
| SQL Server | 2019+ or Azure SQL | Developer edition works |
| Visual Studio | 2022+ | Or VS Code with C# extension |
| Node.js | 18+ | Frontend only |

### Quick start

\`\`\`bash
# steps here
\`\`\`

### Local service URLs

| Service | URL |
|---|---|
| REST API | http://localhost:{port} |
| Swagger UI | http://localhost:{port}/swagger |
| GraphQL | http://localhost:{port}/ui/playground |
| Hangfire | http://localhost:{port}/hangfire |

### Key appsettings

| Key | Purpose |
|---|---|
| `ConnectionStrings:Default` | SQL Server connection string |
| `App:ServerRootAddress` | API host base URL |
| `Authentication:JwtBearer:SecurityKey` | JWT signing key — never commit |

> [!WARNING]
> Never commit real connection strings, JWT keys, or passwords.
```

---

## SECTION 4 — Architecture & Components

**Always leads with**: technology stack table
**Then**: ABP module graph table (if Shesha/ABP project)
**Then**: DDD layer overview table
**Then**: Mermaid architecture diagram
**Then**: key entity descriptions (paragraph per entity, bold name)

```markdown
## Architecture & Components

After reading this section you will understand all {N} application layers...

### Technology stack

| Concern | Technology |
|---|---|
| Runtime | .NET 8, ASP.NET Core |
| App framework | ABP Framework |
| Rapid dev platform | Shesha Framework |
| ORM | **NHibernate** (not Entity Framework Core) |
| Database | SQL Server |
...

> [!NOTE]
> The ORM is **NHibernate**, not EF Core. Do not use `DbContext` patterns.

### ABP module graph

| Module class | Project | Role |
|---|---|---|
...

### DDD layer overview

| Layer | Project | What lives here |
|---|---|---|
...

### Architecture diagram

:::mermaid
graph TD
  ...
:::

### Key entities

**`EntityName`** — description of purpose, key fields, relationships.
```

---

## SECTION 5 — API Reference — Namespace View

**Authentication block first** (always)
**Then**: one subsection per AppService, named `### \`Namespace\` — \`ClassName\``
**Table format per service**: `| Method | Verb | End-goal | Notes |`
**CQS badge**: inline in method name cell — `\`MethodName\`` `[CMD]` or `[QRY]`
**⚠️ smell flag**: prefix method name with ⚠️ if a smell was detected

```markdown
## API Reference — Namespace View

After reading this section you will know the URL pattern, authentication
requirement, and behaviour of every custom AppService method.

> [!NOTE]
> **API prefix**: all routes follow `/api/v1/{Project}/[controller]`.
> Shesha auto-generates standard CRUD endpoints for every entity — not listed here.

### Authentication

All endpoints require a JWT Bearer token:
\`\`\`text
Authorization: Bearer {token}
\`\`\`

---

### `{Namespace}` — `{ServiceName}`

{One sentence describing what this service manages.}

| Method | Verb | End-goal | Notes |
|---|---|---|---|
| `MethodNameAsync` `[CMD]` | POST | {inferred end-goal} | {what it does} |
| `MethodNameAsync` `[QRY]` | GET | {inferred end-goal} | {what it does} |
| ⚠️ `GenericName` `[QRY]` | GET | {goal} | Generic name — verify intent |
```

---

## SECTION 6 — API Reference — Scenario View

**Groups by user goal**, not by namespace
**Format per goal**: h3 heading = goal, then a numbered steps table
**Include retract, configure, manage permissions patterns if present**

```markdown
## API Reference — Scenario View

Groups operations by user goal. Use this when tracing a user action end-to-end.

### Goal: "{User-facing goal description}"

| Step | Operation | Type |
|---|---|---|
| 1 | {what happens} | `{MethodName}` `[QRY]` |
| 2 | {what happens} | Shesha CRUD on `{Entity}` `[CMD]` |
```

---

## SECTION 7 — Lifecycle Map

**State table first**, then flow diagram
**State table columns**: Stage | Entity | Key field | Who/What triggers it
**Mermaid diagram**: uses decision diamonds for approval gates, parallel branches for sub-workflows

```markdown
## Lifecycle Map

After reading this section you will be able to trace a {thing} from creation
through to {end state}...

> [!NOTE]
> Verify exact state machine transitions in the Shesha admin panel
> (Admin → Workflows) before using for compliance purposes.

### State table

| Stage | Entity | Key field | Who/What triggers it |
|---|---|---|---|
...

### Flow diagram

:::mermaid
graph TD
  A[Created] --> B[...]
  ...
:::
```

---

## SECTION 8 — Complexity Hotspots

**Always includes**: count of nodes above threshold, total node/edge count
**Table columns**: Score | Type | Node | Why it matters
**Ends with**: [!NOTE] explaining what coupling score means and does NOT mean
**Smells table**: separate subsection below hotspot table

```markdown
## Complexity Hotspots

After reading this section you will know which nodes lie on the most paths...

{N} nodes exceeded the coupling threshold of 3.0 (mean CA activation generation
≥ 3, from {N} nodes with {N} edges). Top 20 listed by score.

### Top hotspots

| Score | Type | Node | Why it matters |
|---|---|---|---|
| 4.07 | AppServiceMethod | `MethodName` | {reason} |
...

> [!NOTE]
> Scores reflect graph topology. A score ≥ 3.0 means this node lies on the
> shortest path between many others. It does **not** mean the code is buggy —
> it means changes here deserve extra test coverage and careful review.

### Code smells ({N} detected)

| Node | Namespace | Smell | Recommended fix |
|---|---|---|---|
| ⚠️ `Name` | `Namespace` | {smell description} | {fix} |
```

---

## SECTION 9 — Design Decisions

**Format**: bold numbered label, then prose paragraph
**Pattern**: Decision → Rationale → Trade-off
**Always end with**: trade-off sentence

```markdown
## Design Decisions

**D1 — {Short title}**
{What the decision is}. {Why it was made}. Trade-off: {what you give up}.

**D2 — {Short title}**
...
```

---

## SECTION 10 — Changelog

**Format**: reverse chronological, `### YYYY-MM-DD — branch/version`
**If no CHANGELOG.md**: include [!NOTE] saying so, derive from git commits

```markdown
## Changelog

> [!NOTE]
> No CHANGELOG.md found. Entries below sourced from recent git commits.
> Add a `CHANGELOG.md` at the repo root to maintain this going forward.

### YYYY-MM-DD — `branch-name`

- feat: ...
- fix: ...
- patch: ...
```

---

## SECTION 11 — Dead Code Report

**Always opens with**: [!WARNING] false positive disclaimer
**False positive categories specific to Shesha**: list all four
**Table columns**: Node | Type | Assessment
**Assessment column**: starts with "Alive —" or "Investigate —" not just the reason
**Ends with**: [!NOTE] listing what IS in the live set (not dead)

```markdown
## Dead Code Report

> [!WARNING]
> **False positive disclaimer — read before acting on this list.**
>
> Known false positive categories:
> - **Audit log entities** — written by framework event handlers
> - **Workflow definition entities** — registered by class identity
> - **Flattened view entities** — activated by LINQ projections / SQL views
> - **DTOs / setting entities** — bound by model binders / Shesha settings API

| Node | Type | Assessment |
|---|---|---|
| `Name` | DomainEntity | Alive — {reason} |
| `Name` | DomainEntity | Investigate — {reason} |

> [!NOTE]
> `{NodeA}`, `{NodeB}`, and `{NodeC}` are NOT in the dead list —
> the CA reached them via navigation-property edges.
```

---

## SECTION 12 — Coverage Gaps

**Format**: [!WARNING] header, then table
**Table columns**: Gap | Root cause | How to fill
**Always include**: auto-generated CRUD gap, frontend gap

```markdown
## Coverage Gaps

> [!WARNING]
> The following aspects could not be fully documented from available sources.

| Gap | Root cause | How to fill |
|---|---|---|
| **Auto-generated CRUD endpoint routes** | Shesha dynamic API | Open Swagger UI at `/swagger` on a running instance |
| **`EpmPermissions` constant values** | Not extracted by reflection | Read the permissions source file directly |
| **Workflow state transitions** | Configured at runtime in admin panel | Export from Admin → Workflows |
| **Frontend** | React/Next.js not analysed | Run `/wiki-generator` option 4 against frontend source |
```

---

## FORMAT RULES (apply to all sections)

- All tables use `|---|` alignment rows (no padding)
- All code is in fenced blocks with language hint
- All callouts use ADO syntax `> [!NOTE]`, `> [!WARNING]`
- No YAML front matter
- No HTML tags
- CQS badges always inline: `\`MethodName\`` `[CMD]` or `[QRY]`
- Smell warnings always use ⚠️ prefix on the method name cell
- Section separator: `---` between major sections
- Every section opens with a one-sentence learning objective

---

## SECTION — Roles & Permissions

**Source**: generator-memory.md Section 1.
**If empty**: declare Coverage Gap: "Add role definitions to generator-memory.md Section 1."

**Format**:
```markdown
## Roles & Permissions

After reading this section you will know who can do what in this system.

> [!NOTE]
> Role definitions sourced from generator memory. Verify against Shesha admin panel
> (Admin → User Management → Roles) for current permission assignments.

| Role | Description | Can Edit? | Can Approve? | Restrictions |
|------|-------------|-----------|--------------|--------------|
| {Role} | {description} | Yes/No | Yes/No | {any limits} |

### Permission constants
Defined in `{PermissionsClassName}`. Values:
| Constant | String value | Used on |
|----------|-------------|---------|
| `{NAME}` | `"{value}"` | `{MethodName}` |
```

---

## SECTION — Validation Rules

**Source**: generator-memory.md Section 2.
**If empty**: declare Coverage Gap: "Add validation rules and error messages to generator-memory.md Section 2."

**Format**:
```markdown
## Validation Rules

After reading this section you will know what the system rejects and why.

### {Entity or Feature name}

| Error message | Cause | Solution |
|---------------|-------|---------|
| `"{exact message}"` | {what triggers it} | {how to fix} |

> [!NOTE]
> Error messages are exact strings from the source. If a message appears different
> in the running system, check for localisation or version differences.
```

---

## SECTION — Glossary

**Source**: generator-memory.md Section 5 (term mappings) + reflection (entity/method names).
**If Section 5 empty**: generate code-terms only (entity names, method names, permission strings).
**If Section 5 populated**: merge user-facing terms with code terms.

**Format**:
```markdown
## Glossary

User-facing terms mapped to their code equivalents, plus key technical terms.

| Term | Definition | Code equivalent |
|------|-----------|----------------|
| {User term} | {plain English definition} | `{EntityName}` or `{MethodName}` |
| {Code term} | {what it is technically} | — |
```

**Glossary generation rules**:
1. Start with all entity names from reflection — every `DomainEntity` node becomes a row
2. For each entity, write a one-line definition from its field names and CA relationships
3. Add all AppService method names that are entry points (ApiEndpoint nodes)
4. Overlay Section 5 mappings — if a user term maps to a code term, merge into one row
5. Add any domain terms from Section 3 (Domain Context) that are not already in the list
6. Sort alphabetically — user-facing terms first within each letter group
7. Maximum 50 rows — prioritise by risk score descending if list would exceed 50

---

## SECTION — Complexity Hotspots (updated with risk score)

The existing hotspot section format is unchanged except:

- Table column "Why it matters" is now required, not optional
- For nodes with `riskScore > summary.meanRiskScore × 1.5`:
  Add an expanded paragraph below the table entry explaining:
  - What this node does in business terms (use generator memory Domain Context if available)
  - What other nodes it connects to (from graph edges)
  - What a developer should check before changing it
  - If generator memory is empty: explain structurally only, note that business context
    could be added via Option 8

Example expanded entry:
```markdown
#### `GetReportingTreeDataAsync` — Risk score 6.11

This method is the primary data feed for the performance reporting tree UI. Every time
a user opens the reporting screen, this method is called. It supports lazy expansion
(`isOnExpand = true`) and scoped sub-tree loading (`parentId`).

**Connected to**: `ComponentProgressReport` (SharedType), `Component` (SharedType),
`IComponentsAppService` permission (AuthorisedBy).

**Before changing**: verify the lazy-load contract (`isOnExpand` / `parentId` null handling),
check all callers via the CA propagation in the explorer, and run the reporting tree
UI end-to-end in a test environment. Changes here affect every user's primary workflow.
```

---

## MULTI-PAGE FOLDER FORMAT (Option F)

When the user chooses Option F, generate the wiki as a folder of separate
`.md` files instead of a single document. Follow every rule below exactly.

---

### Folder structure

```
wiki-gen/wikis/wiki-{ProjectName}-{YYYY-MM-DD}/
├── Home.md
├── .order
├── 01-Overview/
│   └── Overview.md
├── 02-Setup/
│   └── Setup.md
├── 03-Architecture/
│   └── Architecture.md
├── 04-Roles-and-Permissions/
│   └── Roles-and-Permissions.md
├── 05-API-Reference/
│   ├── Namespace-View.md
│   └── Scenario-View.md
├── 06-Lifecycle-Map/
│   └── Lifecycle-Map.md
├── 07-Complexity-Hotspots/
│   └── Complexity-Hotspots.md
├── 08-Design-Decisions/
│   └── Design-Decisions.md
├── 09-Validation-Rules/
│   └── Validation-Rules.md
├── 10-Glossary/
│   └── Glossary.md
├── 11-Changelog/
│   └── Changelog.md
└── 12-Dead-Code-Report/
    └── Dead-Code-Report.md
```

---

### Section → file mapping

| Wiki section | Folder | File |
|---|---|---|
| Title + Last verified + CODEOWNER + Learning Objectives + Coverage Gaps + Nav index | root | `Home.md` |
| Overview | `01-Overview/` | `Overview.md` |
| Setup & Installation | `02-Setup/` | `Setup.md` |
| Architecture & Components | `03-Architecture/` | `Architecture.md` |
| Roles & Permissions | `04-Roles-and-Permissions/` | `Roles-and-Permissions.md` |
| API Reference — Namespace View | `05-API-Reference/` | `Namespace-View.md` |
| API Reference — Scenario View | `05-API-Reference/` | `Scenario-View.md` |
| Lifecycle Map | `06-Lifecycle-Map/` | `Lifecycle-Map.md` |
| Complexity Hotspots | `07-Complexity-Hotspots/` | `Complexity-Hotspots.md` |
| Design Decisions | `08-Design-Decisions/` | `Design-Decisions.md` |
| Validation Rules | `09-Validation-Rules/` | `Validation-Rules.md` |
| Glossary | `10-Glossary/` | `Glossary.md` |
| Changelog | `11-Changelog/` | `Changelog.md` |
| Dead Code Report | `12-Dead-Code-Report/` | `Dead-Code-Report.md` |

**Coverage Gaps lives in Home.md** — not a separate page. It belongs next
to the learning objectives so the first thing any developer sees is what
the wiki covers and what it doesn't.

---

### Home.md template

```markdown
# {Project Name}

> Last verified: {YYYY-MM-DD} — {source e.g. "graph-2026-06-18.json from SheshaExplorer"}
> CODEOWNER: {assign an owner}
> Docs source: wiki-gen/wikis/wiki-{ProjectName}-{date}/

---

## Learning Objectives

After reading this wiki you will be able to:

- {verb} {goal}
- {verb} {goal}
- {verb} {goal}
- {verb} {goal}
- {verb} {goal}

---

## Coverage Gaps

> [!WARNING]
> The following aspects could not be fully documented from the available source.

| Gap | Root cause | How to fill |
|---|---|---|
| {gap} | {root cause} | {how to fill} |

---

## Contents

| Section | What it covers |
|---|---|
| [[01-Overview/Overview]] | What this system does and why it exists |
| [[02-Setup/Setup]] | Prerequisites and local development setup |
| [[03-Architecture/Architecture]] | Technology stack, module structure, key entities |
| [[04-Roles-and-Permissions/Roles-and-Permissions]] | Who can do what |
| [[05-API-Reference/Namespace-View]] | All custom AppService methods by namespace |
| [[05-API-Reference/Scenario-View]] | Same methods grouped by user goal |
| [[06-Lifecycle-Map/Lifecycle-Map]] | State machines and approval workflows |
| [[07-Complexity-Hotspots/Complexity-Hotspots]] | High-risk nodes and code smells |
| [[08-Design-Decisions/Design-Decisions]] | Why the code is shaped the way it is |
| [[09-Validation-Rules/Validation-Rules]] | Error messages and business rules |
| [[10-Glossary/Glossary]] | Business terms mapped to code entities |
| [[11-Changelog/Changelog]] | Recent changes |
| [[12-Dead-Code-Report/Dead-Code-Report]] | Unused nodes and investigation candidates |
```

**Internal link format**: ADO Wiki uses `[[Page Name]]` or `[[folder/Page Name]]`
for internal links. Use the path relative to the wiki root, without `.md` extension.

---

### .order file format

Plain text, one entry per line, no extension on page names.
Controls the sidebar order in ADO Wiki.
Sub-pages within a folder inherit the folder's position.

```
Home
01-Overview/Overview
02-Setup/Setup
03-Architecture/Architecture
04-Roles-and-Permissions/Roles-and-Permissions
05-API-Reference/Namespace-View
05-API-Reference/Scenario-View
06-Lifecycle-Map/Lifecycle-Map
07-Complexity-Hotspots/Complexity-Hotspots
08-Design-Decisions/Design-Decisions
09-Validation-Rules/Validation-Rules
10-Glossary/Glossary
11-Changelog/Changelog
12-Dead-Code-Report/Dead-Code-Report
```

---

### Individual page header rule

Every page except Home.md must open with:
1. The section heading as `# {Section Title}` (H1)
2. A one-sentence learning objective: "After reading this section you will..."
3. A `---` separator
4. The section content

Do NOT repeat the project title, Last verified block, or CODEOWNER on individual
pages — those live only in Home.md.

---

### Omit empty pages

If a section has no content and would only declare a Coverage Gap, do NOT create
the page and folder. Instead add the Coverage Gap row to the Home.md Coverage Gaps
table. Only create a page if it has real content to show.

---

### Pushing to ADO Wiki

After generating the folder, tell the user:

```bash
# Clone your ADO wiki repo
git clone https://dev.azure.com/{org}/{project}/_git/{project}.wiki
cd {project}.wiki

# Copy the generated folder contents into the wiki repo root
cp -r wiki-gen/wikis/wiki-{ProjectName}-{date}/. ./

# Commit and push
git add .
git commit -m "docs: wiki update {date} via /wiki-generator"
git push origin wikiMaster
```

> [!NOTE]
> ADO Wiki repos use `wikiMaster` as the default branch name.
> Verify your repo's branch name before pushing.
> The `.order` file must be at the root of the wiki repo for ADO to respect it.
