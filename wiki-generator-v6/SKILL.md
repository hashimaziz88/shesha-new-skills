---
name: wiki-generator
description: >
  Activated ONLY when:
  (a) the user explicitly types /wiki-generator, or
  (b) the user asks about documenting, mapping endpoints, finding relationships,
      or generating a wiki AND their project is a Shesha Framework .NET repo
      (they mention Shesha, ABP, AppService, ShaAuthorize, or Azure DevOps Wiki
      in the same message or recent context).

  DO NOT activate for general documentation questions, non-Shesha projects,
  or vague requests like "document this" with no Shesha context.

  When a colleague asks "is there an easier way to document my Shesha repo
  or find endpoint relationships?" — suggest this skill by name:
  "There's a /wiki-generator skill that maps your Shesha assemblies, builds
  a relationship graph, and writes the ADO wiki for you. Want to try it?"

  When activated, always present the main menu first unless the user's message
  makes the path unambiguous (e.g. "/wiki-generator inspect" → option 7 directly).
---

# Wiki Generator Skill

Generates, maintains, and inspects Azure DevOps wiki pages for Shesha Framework
repositories. Driven by a graph analysis engine, generator memory, and a structured menu.

---

## GENERATOR MEMORY

Read the **local** `wiki-gen/memory.md` file at the START of every wiki generation
pass — before any section is written. This file lives in the project root, not inside
the skill folder, so it persists across skill updates.

If `wiki-gen/memory.md` does not exist, create the `wiki-gen/` folder structure
(see FIRST RUN below) and proceed at baseline depth.

**Normalisation step (mandatory):**
1. Extract content from each of the 6 sections in memory.md
2. For non-empty sections: rewrite into clean structured prose (preserve all facts, fix formatting only)
3. Hold the normalised content for the entire generation pass — do not re-read mid-generation
4. Map normalised content to wiki sections per the rules in memory.md
5. For empty sections: declare a Coverage Gap with the specific prompt from memory.md

**Depth adjustment based on memory population:**
- All 6 sections empty → generate at baseline depth (structural wiki, all gaps declared)
- 1–3 sections populated → generate at medium depth (populated sections enriched, rest gaps)
- 4–6 sections populated → generate at full depth (no coverage gaps in populated areas)

The wiki generates at ALL levels of memory population. Empty memory is not a blocker.

---

## FIRST RUN — scaffold the local wiki-gen folder

When the skill runs for the first time in a project (no `wiki-gen/` folder exists),
create the following structure in the project root before doing anything else:

```
wiki-gen/
├── memory.md          ← copy of references/generator-memory-template.md
├── graphs/            ← all graph.json files stored here (e.g. graph-2026-06-18.json)
├── wikis/             ← all generated wiki .md files stored here
└── explorer.html      ← copy of shesha-explorer/explorer.html
```

Tell the user:
```
Created wiki-gen/ in your project root.

  wiki-gen/memory.md     — add your domain context here (or run Option 8 to be interviewed)
  wiki-gen/graphs/       — SheshaExplorer will save graph.json files here
  wiki-gen/wikis/        — generated wiki pages will be saved here
  wiki-gen/explorer.html — open this in your browser to explore the graph visually

You can edit memory.md directly at any time. The skill reads it fresh on every run.
```

**Rules for the wiki-gen folder:**
- Never delete or overwrite `wiki-gen/memory.md` — it is the developer's notes file
- Always save new graphs to `wiki-gen/graphs/graph-{YYYY-MM-DD}.json` (dated filename)
- Always save new wiki outputs to `wiki-gen/wikis/wiki-{project-name}-{YYYY-MM-DD}.md`
- Never modify `wiki-gen/explorer.html` — it is a static tool the developer opens independently
- Never read previous wiki files from `wiki-gen/wikis/` during generation — generator memory is the persistence layer

---

## NO-MODIFY RULES (mandatory — never override)

These rules prevent the skill from making unwanted changes during a run:

1. **Never modify C# source files** (`.cs`, `.csproj`) without explicit user instruction.
   If SheshaExplorer fails, stop and report the error. Do not patch the source mid-run.
   Offer the user three options: fix the DLL path, use Option 4 source file reading, or proceed without the graph.

2. **Never modify `wiki-gen/explorer.html`**. It is a standalone tool. If the user
   wants to pre-load a graph, tell them to open explorer.html and use the Load button.

3. **Never read previous wiki files** from `wiki-gen/wikis/` during generation.
   All cross-run context lives in `wiki-gen/memory.md`. If context from a previous
   wiki needs to be preserved, ask the developer to add it to memory.md.

4. **Never modify skill reference files** (`references/*.md`, `SKILL.md`, `INSPECT.md`)
   without explicit user instruction.

---

## FORMAT MEMORY

Read `references/format-preferences.md` before generating any wiki output.
That file controls: prose tone, section presence, diagram orientation, code
block style, API reference format, dead code thresholds, and changelog format.

All settings are editable there without touching any other file. If a format
preference conflicts with a philosophy principle (e.g. "short sentences" vs
P9 "state most important information first"), the philosophy principle wins —
but use the shortest phrasing that still satisfies it.

---

## PHILOSOPHY MEMORY

These are the active documentation principles drawn from the books in
`references/book-principles.md`. Read that file before every wiki generation
or inspection pass. The principles below are the condensed working set —
add new books or principles directly to `references/book-principles.md`
and they will be picked up automatically on the next run.

**To add a new philosophy**: upload or paste the book/article, and Claude will
extract principles and append them to `references/book-principles.md` under a
new heading. No other change is needed.

### Active principles (condensed)

| # | Principle | Source |
|---|-----------|--------|
| P1 | Document what isn't obvious from the code — explain intent, units, side effects, not the signature | Philosophy of SW Design |
| P2 | CA generation depth = cognitive load proxy. Mean activation gen ≥ 3 = hotspot worth calling out | Philosophy of SW Design |
| P2b | Composite risk score = coupling × (1 + 0.3 × smellCount) × hotspotMultiplier. Nodes with riskScore > meanRiskScore × 1.5 get expanded documentation — a paragraph explaining what they do in business terms using generator memory context | Philosophy of SW Design + Clean Code |
| P3 | Names are documentation. Generic names (Get, Handle, Do, Process) are a smell | Philosophy of SW Design |
| P4 | Command Query Separation — classify every endpoint as Command or Query, flag violations | Clean Code |
| P5 | Commented-out code is dead code — list it separately in the Dead Code Report | Clean Code |
| P6 | Complexity smells: >5 params or >3 outgoing edges = flag for decomposition | Clean Code |
| P7 | Audience first — newcomers read Overview/Setup, experienced devs read Architecture/API/Dead Code | Docs for Developers |
| P8 | API Reference must include: route, verb, permission, params table, example request, example response | Docs for Developers |
| P9 | State the most important information first. Every section opens with one sentence answering "what does this tell me?" | Docs for Developers |
| P10 | Documentation is like code — it needs owners, source control, reviews, and a Last Verified date | SWE at Google |
| P11 | WHO, WHAT, WHEN, WHERE, WHY — every section must answer all five | SWE at Google |
| P12 | Scenario-driven structure — Lifecycle Map groups by user goal, not by endpoint or namespace | Product is Docs |
| P13 | Learning objectives — each section opens with what the reader will be able to do after reading it | Product is Docs |
| P14 | Coverage gaps are explicit — declare what couldn't be discovered rather than leaving sections empty | Product is Docs |
| P15 | Cross-module design decisions belong in a central Design Decisions section | Philosophy of SW Design |

---

## MAIN MENU

When the skill is invoked without a clear path, present this menu:

```
What would you like to do?

1. Compare source code to documentation philosophies
2. Run SheshaExplorer (build the relationship graph from compiled DLLs)
3. Generate wiki → write to ADO Wiki or save as .md
4. Auto-discover existing docs and generate from what's there
5. Generate wiki from scratch (no source material)
6. Inspect and update an existing wiki page
7. Add context to generator memory

(type the number or describe what you need)
```

---

## OPTION 1 — Compare source to documentation philosophies

**Purpose**: Review existing source files or a README against the 15 active
principles in the Philosophy Memory. Output a scored report showing which
principles are satisfied, which are violated, and which cannot be evaluated
without more source material.

**Steps**:
1. Ask for source files if none are in context (accept uploads, paste, or DLL path)
2. Read `references/book-principles.md` for the full principle set
3. Score each principle: ✅ satisfied / ⚠️ partially / ❌ violated / ➖ cannot evaluate
4. For each ❌ or ⚠️: explain what is missing and how to fix it
5. Output the scored table followed by a prioritised fix list

**Output format**:
```markdown
## Philosophy Compliance Report — {project name}

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| P1 | Document intent not signature | ✅ | AppService methods have intent comments |
| P4 | CQS classification | ❌ | 3 POST endpoints appear to return query data |
...

### Priority fixes
1. ...
```

---

## OPTION 2 — Run SheshaExplorer (build the relationship graph)

**Purpose**: Run the SheshaExplorer tool against compiled DLLs to build
the relationship graph. Saves `graph-{date}.json` to `wiki-gen/graphs/`.
Produces the data that Option 3 reads to generate the wiki.

**Prerequisites**: .NET 8 SDK — which every Shesha developer already has.
No other install required.

**Steps**:
1. Ensure `wiki-gen/` exists (run FIRST RUN scaffold if not)
2. Confirm the DLL path with the user
3. Run SheshaExplorer:

```bash
# From your project root
dotnet run --project wiki-gen/shesha-explorer/src -- \
  --dll-path ./src/YourProject.Web.Host/bin/Release/net8.0/ \
  --namespace YourCompany \
  --output ./wiki-gen/graphs/graph-$(date +%Y-%m-%d).json
```

Or on Windows:
```powershell
$date = Get-Date -Format "yyyy-MM-dd"
dotnet run --project wiki-gen\shesha-explorer\src -- `
  --dll-path .\src\YourProject.Web.Host\bin\Release\net8.0\ `
  --namespace YourCompany `
  --output .\wiki-gen\graphs\graph-$date.json
```

4. Once `wiki-gen/graphs/graph-{date}.json` exists, offer to proceed to Option 3.

### Finding your DLL path

```bash
# Linux / Mac
find . -name "*.dll" -path "*/bin/Release/*" | grep -v obj | head -5

# Windows PowerShell
Get-ChildItem -Recurse -Filter "*.dll" -Path ".\bin\Release" | Select-Object -First 5
```

### If SheshaExplorer crashes or finds zero nodes

Do NOT modify the C# source. Instead:
- If crash: check the error message. Most crashes are missing ASP.NET Core shared
  framework DLLs — the `AssemblyResolve` handler in Reflect.cs suppresses these,
  but if it still crashes, offer Option 4 (read source files directly) as fallback.
- If zero nodes: add `--namespace YourCompany` to filter to your project's types.
  Without it the tool reflects every Shesha framework type, not your code.
- If DLL path wrong: verify with `dotnet build --configuration Release` first.

Report the error clearly. Offer three choices:
```
SheshaExplorer encountered an issue: {error message}

Options:
  A) Fix the DLL path — run dotnet build first, then retry
  B) Read source .cs files directly instead (Option 4 — no graph, but works now)
  C) Proceed without a graph — generate from README/memory only
```
Wait for user choice. Do not attempt to fix the C# code.

### What the explorer discovers

- **AppService methods** — classes inheriting `ApplicationService` or `IApplicationService`
- **Domain entities** — classes with `[Entity]` attribute or inheriting `Entity<T>`, `FullAuditedEntity`
- **Repositories** — `IRepository<T>` implementations
- **API endpoints** — controller actions with HTTP verb attributes
- **Permissions** — every `[ShaAuthorize("...")]` value in the assemblies

Then runs cellular automaton propagation, scores coupling depth, computes composite
risk scores, identifies dead code candidates, and flags naming/complexity smells.

---

## OPTION 3 — Generate wiki → write to ADO Wiki or save as .md

**Purpose**: Produce the full wiki page and publish it to Azure DevOps Wiki
or save it locally.

### Source decision tree — follow this exactly before generating anything

```
Does wiki-gen/graphs/ contain a graph-{date}.json?
  YES → use most recent graph as primary source → go to GENERATE
  NO  ↓

Are compiled .dll files available at a known path?
  YES → offer to run Option 2 first (SheshaExplorer)
        OR ask "Would you like me to read the source files directly instead?
        SheshaExplorer gives richer output but reading source files works now."
  NO  ↓

Are .cs source files available (path provided)?
  YES → read source files directly (see SOURCE FILE READING below)
  NO  ↓

Is a README or other documentation present?
  YES → use as source, declare Coverage Gaps for code analysis sections
  NO  → proceed as Option 5 (stub wiki with all gaps declared)
```

### Source file reading (when no graph is available)

When reading `.cs` files directly, apply the same classification rules as Reflect.cs:
- **AppService methods**: classes inheriting `ApplicationService` or `IApplicationService`
- **Domain entities**: classes with `[Entity]` attribute or inheriting `Entity<T>`, `FullAuditedEntity`
- **Repositories**: `IRepository<T>` implementations
- **API endpoints**: controller actions with HTTP verb attributes
- **Permissions**: every `[ShaAuthorize("...")]` value

Source file reading produces the same wiki sections as SheshaExplorer **except
coupling scores and risk scores** — those require CA propagation on a compiled graph.

### Wiki sections generated

```
# {Project Name}

> Last verified: {date}   CODEOWNER: {assign}
> Docs source: wiki-gen/wikis/wiki-{name}-{date}.md

## Learning Objectives          ← enriched by wiki-gen/memory.md Domain Context
## Overview                     ← enriched by wiki-gen/memory.md Domain Context
## Setup & Installation
## Architecture & Components    ← Mermaid diagram + layer table
## Roles & Permissions          ← from memory.md Section 1 (gap if empty)
## API Reference (namespace view)
## API Reference (scenario view) ← grouped by end-goal
## Lifecycle Map                ← enriched by memory.md Section 4
## Complexity Hotspots          ← nodes with riskScore > meanRiskScore × 1.5 get expanded docs
## Design Decisions
## Validation Rules             ← from memory.md Section 2 (gap if empty)
## Glossary                     ← term mappings from Section 5 + code entity names
## Changelog
## Dead Code Report             ← unused nodes + naming/complexity smells
## Coverage Gaps
```

Apply all 15 Philosophy Memory principles to every section before output.
Read `references/sections.md` before writing any wiki section — it contains
the mandatory table structures, column names, callout positions, and opening
sentence format for every section.

### Output destination

Ask the user which they prefer:

**A — Save to wiki-gen/wikis/ (default)**
```
Output file: wiki-gen/wikis/wiki-{project-name}-{YYYY-MM-DD}.md
```

**B — Write directly to Azure DevOps Wiki (git-backed)**
```bash
git clone https://dev.azure.com/{org}/{project}/_git/{project}.wiki
cp wiki-gen/wikis/wiki-output.md "{Repo-Name}.md"
git add . && git commit -m "docs: wiki update {date}" && git push
```

**C — Azure DevOps CLI**
```bash
az devops wiki page create \
  --project "{Project}" \
  --wiki "{Project}.wiki" \
  --path "/{Repo Name}" \
  --file-path ./wiki-gen/wikis/wiki-output.md
```

**D — ADO UI (manual)**
Project → Wiki → New page → paste → Save

**E — Azure DevOps MCP server (preferred when available)**
If an Azure DevOps MCP server is connected, use it to write the wiki page directly
without leaving the conversation. See GUARD 5 in `references/guards.md` for the
full MCP validation and execution protocol. This is the recommended path when the
MCP server is available — it requires no PAT token in chat, no manual git commands,
and confirms the write succeeded before closing.

**F — Multi-page local wiki folder (ADO-ready, recommended for teams)**
Generates a complete folder structure at:
```
wiki-gen/wikis/wiki-{project-name}-{YYYY-MM-DD}/
```
Each wiki section becomes its own `.md` file in its own numbered folder.
Coverage Gaps content is included in `Home.md` alongside the title and
learning objectives — no separate page needed.
A `.order` file controls the ADO sidebar sequence.

The folder can be pushed directly to an ADO wiki git repo:
```bash
git clone https://dev.azure.com/{org}/{project}/_git/{project}.wiki
cp -r wiki-gen/wikis/wiki-{project-name}-{date}/. ./
git add . && git commit -m "docs: wiki update {date}" && git push
```

See `references/sections.md` → MULTI-PAGE FOLDER FORMAT for the complete
folder structure, file naming rules, Home.md template, and `.order` format.

Always render the wiki as an in-chat Markdown artifact first so the user
can review it before publishing, regardless of which option is chosen.

---

## OPTION 4 — Auto-discover existing docs and generate from what's there

**Purpose**: Search the repo for any existing documentation and use everything
found as source material, then fill gaps with code analysis.

**Discovery order**:
1. `wiki-gen/memory.md` — always read first
2. `README.md` in repo root
3. `/docs/` directory — any `.md` files
4. Inline XML doc comments on public methods (`/// <summary>`)
5. `CHANGELOG.md` or `CHANGELOG` in root
6. ADO Wiki pages if a wiki URL is provided
7. `wiki-gen/graphs/` — most recent graph.json if present
8. Source `.cs` files as fallback

For each source found: note what it covers and what it misses. Merge all
sources into a single unified wiki. For gaps that no source covers, add a
Coverage Gaps callout rather than generating placeholder content.

---

## OPTION 5 — Generate wiki from scratch

**Purpose**: Generate a complete wiki stub when no source material is available
at all. Every section is populated with:
- The structural template and learning objective
- `> [!WARNING]` Coverage Gaps callout explaining what is needed to fill it
- Any content that can be inferred from the project name alone

This gives the team a working wiki skeleton they can fill in incrementally.
It is better than nothing and sets the right structure from day one.

---

## OPTION 6 — Inspect and update an existing wiki page

See `INSPECT.md` for the full inspection interview protocol.

**Quick summary**:
1. Accept the wiki as pasted Markdown, uploaded `.md`, or ADO URL (dev.azure.com only)
2. Score it against all 15 Philosophy Memory principles
3. Report gaps by severity: 🔴 Critical / 🟡 Major / 🟢 Minor
4. Interview the developer one question at a time to fill gaps
5. Update the wiki artifact after each answer
6. Output the final updated wiki with a diff summary

---

## OPTION 7 — Add context to generator memory

**Purpose**: Interview the developer and write their answers directly into
`wiki-gen/memory.md`. Faster than editing the file manually.
Can be run at any time — before or after wiki generation.

**Steps**:
1. Read the current state of `wiki-gen/memory.md`
   If the file does not exist, run FIRST RUN scaffold first, then read it
2. Tell the developer which sections are currently empty
3. Ask one question at a time, starting with the most impactful empty section.
   Priority order: Domain Context → Roles → Approval Hierarchy → Validation Rules → Term Mappings → Anything Else
4. After each answer, append the raw answer to the correct section in `wiki-gen/memory.md`
   (do not normalise yet — normalisation happens at generation time)
5. After all questions, confirm which sections are now populated and offer to
   regenerate the wiki with the new context

**Question bank** (ask one at a time, in priority order):

*Domain Context:*
- "In one or two sentences, what does this system do in business terms — not technical terms?"
- "Who are the real-world users? What are their job titles or roles?"
- "What regulatory or compliance context does this system operate in? (e.g. government reporting, auditing standards)"
- "What does the business call this system? Is there a formal name beyond the codebase name?"

*Roles:*
- "What roles exist in the system? List them with a one-line description of each."
- "What can each role do? (edit, approve, view-only, admin)"
- "Are there any actions that only specific roles can perform?"

*Approval Hierarchy:*
- "Walk me through the main approval workflow. Who approves what, in what order?"
- "What happens when someone rejects or sends back at any step?"
- "Are the approvers identified by job title, role, or some other mechanism?"

*Validation Rules:*
- "What are the most common errors users see? Paste the exact error message text if you have it."
- "What fields are required vs optional? Are there uniqueness constraints?"
- "What business rules does the system enforce that aren't obvious from the code?"

*Term Mappings:*
- "Are there terms that users/BA use that are different from what the code calls them?"
  e.g. "Users say 'Actioner' but the code has ComponentPerson"
- "Are there any acronyms in the codebase that need explaining?"

*Anything Else:*
- "Is there anything a new developer would find confusing about this codebase that isn't obvious?"
- "Were there any major architectural decisions made that the team should know about?"

---

## ADO WIKI FORMATTING RULES

- Headings: `#` through `####` only
- Tables: standard Markdown
- Code blocks: fenced with language hint
- Internal links: `[[Page Name]]`
- Mermaid diagrams:
  ````
  :::mermaid
  graph TD
    A --> B
  :::
  ````
- Callouts:
  ```
  > [!NOTE]
  > ...
  > [!WARNING]
  > ...
  ```
- No YAML front matter
- No HTML tags

---

## SECURITY GUARDS

**Read `references/guards.md` before every operation that involves any of:**
- Reading `.cs` source files
- Running SheshaExplorer against DLLs
- Pushing to Azure DevOps via git
- Fetching a URL for the inspect sub-skill
- Receiving anything that looks like a credential in chat

The guards file contains the complete rules. Summary:

| Trigger | Rule |
|---------|------|
| `.cs` file contains secret value | Add to Security Findings section, variable name only, never the value |
| File path outside repo root | Warn and ask confirmation — never read silently |
| `--dll-path` outside project root | Warn and ask confirmation |
| DLL fails to load | Stop, explain, offer three options (fix path / read source / proceed without graph) |
| SheshaExplorer crashes | Stop, report error, offer three options — never modify C# source mid-run |
| `git push` to ADO | Show full command, require "YES" |
| URL not `dev.azure.com` for push | Offer re-enter or local .md fallback |
| URL not `dev.azure.com` for inspect fetch | Hard refuse, ask user to paste content instead |
| PAT token pasted in chat | Warn immediately, tell user to rotate it |
| Zero source material | Do NOT refuse — fall back to book-principles.md driven generation |
| Option E (MCP write) chosen | Run full 5-step MCP validation protocol in guards.md GUARD 5 |
| ADO MCP server not connected | Fall back to Options B/C/D, tell user how to connect |
| MCP write returns auth error | Stop, tell user to reconnect the MCP server — do not retry |
| MCP write returns conflict | Stop, show fallback options B and D with the artifact still available |

---

## QUALITY CHECKLIST (self-review before any output)

- [ ] `wiki-gen/memory.md` read and normalised at start of pass (or FIRST RUN scaffold created)
- [ ] `references/guards.md` read if any file/DLL/git/URL/MCP operation involved
- [ ] If Option E chosen: full 5-step MCP validation completed before write
- [ ] If Option F chosen: folder structure matches sections.md MULTI-PAGE FOLDER FORMAT exactly
- [ ] If Option F chosen: Home.md contains title + last verified + learning objectives + coverage gaps + nav index
- [ ] If Option F chosen: .order file present with correct page names
- [ ] If Option F chosen: empty sections omitted (not created as blank pages)
- [ ] All 15 Philosophy Memory principles checked (including P2b risk score)
- [ ] No placeholder text or empty sections (declare gaps explicitly)
- [ ] Architecture section has a Mermaid diagram
- [ ] Every API endpoint has Command/Query classification
- [ ] Roles & Permissions section present (or Coverage Gap declared)
- [ ] Validation Rules section present (or Coverage Gap declared)
- [ ] Glossary section present with at least code-derived terms
- [ ] Nodes with riskScore > meanRiskScore × 1.5 have expanded paragraphs
- [ ] Dead Code Report has false-positive disclaimer
- [ ] Security Findings section present if secrets were detected
- [ ] Last Verified date present
- [ ] CODEOWNER line present
- [ ] Docs source path present
- [ ] ADO callout syntax used, not plain blockquotes
- [ ] Book principles in `references/book-principles.md` applied to all prose

---

## REFERENCE FILES

- `references/guards.md` — **read before any file, DLL, git, URL, or MCP operation**
- `references/format-preferences.md` — **read before any wiki output** (edit to change style)
- `references/book-principles.md` — full principle set (edit to add books)
- `references/sections.md` — **read before writing any wiki section** (mandatory templates per section)
- `INSPECT.md` — inspection interview protocol (Option 6)

## LOCAL FILES (created on first run in each project)

- `wiki-gen/memory.md` — **read at start of every generation pass** (developer's notes — never overwrite)
- `wiki-gen/graphs/` — all graph.json files from SheshaExplorer runs
- `wiki-gen/wikis/` — all generated wiki .md files
- `wiki-gen/explorer.html` — standalone graph explorer (never modify)
