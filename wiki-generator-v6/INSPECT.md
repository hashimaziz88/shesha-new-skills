---
name: wiki-inspect
description: >
  Run a documentation inspection interview against an existing wiki page or set of
  documentation. Use this sub-skill when the developer says "inspect my docs",
  "review the wiki", "check the documentation", "update the wiki", "audit the docs",
  or "run inspect". Also triggers when a wiki page is pasted or uploaded and the user
  asks whether it is complete, accurate, or up to date. The output is a structured
  list of gaps, stale sections, and questions the developer answers to produce an
  updated wiki page. This skill requires NO source code — it works from the existing
  documentation alone.
parent_skill: wiki-generator
---

# Wiki Inspect Sub-Skill

Runs a structured interview against existing documentation to find gaps, staleness,
and inaccuracies. The developer answers questions; Claude updates the wiki in place.

No assemblies, no source code, no SheshaExplorer run required — though if any of
those are available, incorporate them automatically.

---

## Step 1 — Ingest the existing documentation

Before doing anything, read `references/format-preferences.md`. The updated
wiki output must match the team's current format settings — not Claude's defaults.

Accept the wiki in any of these forms:
- Pasted Markdown in the conversation
- An uploaded `.md` file
- A URL to an ADO wiki page (fetch it)
- "The wiki we just generated" (use the artifact from this session)

If none are provided, ask: "Please paste your current wiki page, upload the `.md`
file, or share the ADO Wiki URL."

---

## Step 2 — Score each section against the book principles checklist

Before asking any questions, silently evaluate each section against these criteria
(drawn from `references/book-principles.md`). Produce an internal gap list, then
present it as the opening of your inspection report.

### Section scoring criteria

For each section present in the wiki, check:

| Check | Principle source |
|-------|-----------------|
| Does it open with a learning objective sentence? | Product is Docs |
| Does it answer WHO, WHAT, WHEN, WHERE, WHY? | SWE at Google |
| Is the most important information in the first paragraph? | Docs for Developers |
| Are content types separated (no procedure inside reference)? | Docs for Developers |
| Is there a "Last verified" date? | SWE at Google |
| Is there a CODEOWNER assigned? | SWE at Google |
| Does the API Reference include example request + response per endpoint? | Docs for Developers |
| Does the API Reference classify each endpoint as Command or Query? | Clean Code |
| Is the Lifecycle Map grouped by user goal, not by endpoint? | Product is Docs |
| Does the Architecture section reference a Mermaid diagram? | wiki-generator skill |
| Does the Dead Code Report have a false-positive disclaimer? | wiki-generator skill |
| Are there any obviously stale dates or version numbers? | SWE at Google |
| Are there any empty placeholder cells in tables? | General quality |
| Are there any sections that just say "TBD" or "_(add manually)_"? | General quality |
| Does the Overview answer "what problem does this solve"? | Philosophy of SW Design |

### Gap severity levels

- 🔴 **Critical** — section missing entirely, or contains wrong information
- 🟡 **Major** — section present but incomplete (missing required field)
- 🟢 **Minor** — section present and complete but could be improved

---

## Step 3 — Present the inspection report

Format:

```
## Wiki Inspection Report

**Inspected:** {wiki title or "untitled"}
**Date:** {today}
**Sections found:** {list}
**Overall completeness:** {X/15 checks passing}

### 🔴 Critical gaps
{list}

### 🟡 Major gaps
{list}

### 🟢 Minor improvements
{list}

---
Ready to update? I'll ask you {N} questions to fill the gaps.
```

If there are no gaps, say so and offer to re-run SheshaExplorer to check for
drift between the docs and the current assemblies.

---

## Step 4 — Run the inspection interview

Ask questions **one at a time**, in severity order (critical first).
Do NOT ask more than one question per message.
After each answer, immediately update the relevant wiki section in a running
artifact and confirm the update before moving to the next question.

### Question bank — draw from this list based on what gaps were found

**Overview gaps:**
- "What problem does {project name} solve? One sentence for a developer who has never seen it."
- "What is the target deployment environment? (Azure, on-prem, hybrid?)"
- "What version of Shesha Framework does this project use?"

**Setup gaps:**
- "Are the setup steps in the wiki still accurate? Any prerequisites changed recently?"
- "What environment variables are required that aren't listed?"
- "Is there a database backup/seed file needed for local setup?"

**Architecture gaps:**
- "What external services does this system depend on? (e.g., Azure Service Bus, SQL Server, third-party APIs)"
- "Are there any architectural decisions that aren't obvious from the code — e.g., why a particular pattern was chosen?"
- "Has the layer structure changed since the wiki was written? Any new services or removed modules?"

**API Reference gaps:**
- "For endpoint `{name}`: what does a successful request look like? Can you paste an example JSON body?"
- "For endpoint `{name}`: what does a successful response look like?"
- "Are there any endpoints in the wiki that no longer exist in the codebase?"
- "Are there any new endpoints not yet in the wiki?"

**Lifecycle Map gaps:**
- "Walk me through the most important business workflow in this system. What is the end goal, and which endpoints are involved in sequence?"
- "Are there any workflows in the wiki that have changed?"

**Design Decisions gaps:**
- "What was the most important architectural decision made in the last 6 months that isn't documented?"
- "Why was {pattern/approach} chosen over the obvious alternative?"

**Dead Code gaps:**
- "Has anything in the Dead Code Report been investigated? What was the outcome?"
- "Are there any false positives in the report — code flagged as dead that is actually used?"

**Changelog gaps:**
- "What changed in the last release that isn't reflected in the Changelog?"

**General staleness:**
- "When was the wiki last updated? Is there anything obviously out of date?"
- "Who owns this wiki? Should we add them as CODEOWNER?"

---

## Step 5 — Produce the updated wiki

After all critical and major gaps are resolved:

1. Output the full updated wiki as a Markdown artifact
2. Show a diff summary: what changed (added / updated / removed sections)
3. Update the "Last verified" date to today
4. Remind the developer to commit the updated file to the ADO wiki git repo:

```bash
# Commit the updated wiki
git clone https://dev.azure.com/{org}/{project}/_git/{project}.wiki
cp updated-wiki.md "{Repo-Name}.md"
git add . && git commit -m "docs: wiki inspection update {date}" && git push
```

---

## Inspection quality checklist (self-review before presenting report)

- [ ] `references/guards.md` checked — URL validated as dev.azure.com if fetching
- [ ] Scored all sections present in the input wiki
- [ ] Did not invent gaps that don't exist
- [ ] Critical gaps are genuinely missing information, not style preferences
- [ ] Questions are specific to the actual content (not generic)
- [ ] One question asked at a time during interview phase
- [ ] Updated artifact reflects every answer given
- [ ] "Last verified" date updated in output
- [ ] False-positive disclaimer present in Dead Code Report
- [ ] Book principles applied to all rewritten prose
- [ ] Security Findings section preserved if it existed in the original wiki
