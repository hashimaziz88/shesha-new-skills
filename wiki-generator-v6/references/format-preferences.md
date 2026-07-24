# Format Preferences

This file controls how the wiki output looks and reads.
Edit any value here — changes apply on the next generation run.
No other file needs to be touched.

---

## OUTPUT FORMAT

### Wiki destination default
When Option 4 is triggered without a specified destination, default to:
- [ ] Ask the user each time (recommended while team is testing)
- [ ] Local .md file
- [ ] ADO Wiki git push
- [ ] ADO CLI

**Current setting: Ask the user each time**

---

## PROSE STYLE

### Tone
- [ ] Formal — full sentences, passive voice acceptable, no contractions
- [ ] Neutral — clear and direct, minimal personality
- [ ] Conversational — plain English, contractions allowed, "you" voice

**Current setting: Neutral**

### Sentence length
- [ ] Short — max ~15 words per sentence, prefer bullet points
- [ ] Medium — mix of short and medium sentences, bullets for lists only
- [ ] Long-form — flowing paragraphs, bullets only for genuine lists

**Current setting: Medium**

### Person / voice
- [ ] Second person — "you can configure this by..."
- [ ] Third person — "developers can configure this by..."
- [ ] Impersonal — "this is configured by..."

**Current setting: Second person**

---

## SECTION FORMATTING

### Code block language hints
Always include language hints on fenced code blocks:
- C# → ```csharp
- Bash / shell → ```bash
- JSON → ```json
- PowerShell → ```powershell
- SQL → ```sql
- Plain text / unknown → ```text

**Current setting: Always include (mandatory)**

### Table style
- [ ] Every column has a header row
- [ ] Align columns with spaces (readable in raw Markdown)
- [ ] Compact — no extra spacing

**Current setting: Header row always, compact**

### Callout style (ADO Wiki)
Use ADO-flavoured callouts, not plain blockquotes:
```
> [!NOTE]       ← informational
> [!WARNING]    ← something to watch out for
> [!IMPORTANT]  ← must not be missed
> [!TIP]        ← optional improvement
```

**Current setting: ADO callouts always — plain blockquotes never**

---

## SECTION PRESENCE

Toggle sections on or off for this team's wiki pages.
Mark with [x] to include, [ ] to exclude.

- [x] Learning Objectives
- [x] Overview
- [x] Setup & Installation
- [x] Architecture & Components (with Mermaid diagram)
- [x] API Reference — namespace view
- [x] API Reference — scenario view
- [x] Lifecycle Map
- [x] Complexity Hotspots
- [x] Design Decisions
- [x] Changelog
- [x] Dead Code Report
- [x] Security Findings (only appears if secrets detected)
- [x] Coverage Gaps
- [ ] Glossary (off by default — enable if the codebase has domain-specific terms)
- [ ] Known Issues (off by default — enable if team wants to track them in the wiki)

---

## DIAGRAM PREFERENCES

### Architecture diagram orientation
- [ ] Top-down (TD)
- [ ] Left-right (LR)

**Current setting: Top-down**

### Mermaid diagram detail level
- [ ] High — every node and edge including permissions
- [ ] Medium — AppServices, Entities, and API endpoints only
- [ ] Low — top-level layers only, no individual nodes

**Current setting: Medium**

### Coupling hotspot threshold
Nodes with a mean CA activation generation at or above this value are flagged
as complexity hotspots in the Architecture section:

**Current setting: 3**
(lower = more nodes flagged, higher = only the most coupled nodes flagged)

---

## API REFERENCE PREFERENCES

### Example request/response format
- [ ] Real-looking JSON payloads (Claude infers from field names and types)
- [ ] Placeholder structure only (shows shape, not fake data)
- [ ] Omit examples — signature table only

**Current setting: Placeholder structure only**

### Command/Query label style
- [ ] Badge inline with endpoint name: `CompleteOrder` `[CMD]`
- [ ] Separate column in the parameters table
- [ ] Callout below the signature

**Current setting: Badge inline**

---

## DEAD CODE REPORT PREFERENCES

### Severity threshold
Only include nodes in the Dead Code Report if they meet this criteria:
- [ ] Any node never activated in any CA run
- [ ] Only nodes in user-defined namespaces (exclude auto-generated Shesha CRUD)
- [ ] Only AppService methods and API endpoints (skip entities and repositories)

**Current setting: Only nodes in user-defined namespaces**

### False positive disclaimer style
- [ ] Short — one-line note at the top of the section
- [ ] Full — paragraph explaining all known false positive categories

**Current setting: Full**

---

## CHANGELOG PREFERENCES

### Date format
- [ ] ISO 8601: 2024-03-15
- [ ] Long form: 15 March 2024
- [ ] Relative: 3 months ago (not recommended for committed docs)

**Current setting: ISO 8601**

### Version prefix
- [ ] Semantic version: v2.1.0
- [ ] Sprint number: Sprint 42
- [ ] Date only: no version label
- [ ] Both: v2.1.0 / Sprint 42

**Current setting: Semantic version**

---

## HOW TO CHANGE A SETTING

1. Open this file
2. Move the `[x]` or change the "Current setting:" line
3. Save — no other file needs to change
4. The next wiki generation or inspect run will use the new setting

To add a new preference category, follow the same pattern:
- Options as checkboxes
- "Current setting:" line at the bottom of each group
- Plain English description of what it controls
