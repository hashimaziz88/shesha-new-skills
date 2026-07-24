# Generator Memory

This file is read before every wiki generation pass. Paste notes as messy as you like —
the skill will normalise them into the four categories below before injecting into the wiki.

If a section is empty the wiki still generates, but that section will declare a Coverage Gap
instead of filled content. Fill in what you have; leave blank what you don't.

---

## HOW TO ADD CONTEXT

**Option A — Edit this file directly**
Paste notes under the relevant section heading below. No formatting required.
The messier the better — the skill will clean it up.

**Option B — Via the skill menu**
Choose Option 8 ("Add context to generator memory") in the /wiki-generator menu.
The skill will ask you targeted questions and write the answers here automatically.

---

## SECTION 1 — User Roles and Permission Matrices

_Who can do what in this system. Paste role names, what they can see, what they can edit,
what they can approve. Can come from a BA doc, a training manual, a Confluence page,
an email — anything._

_Example of acceptable input:_
_"Admin can do everything. M&E can only view and approve at QA level 3. Auditor is read only."_

<!-- PASTE NOTES BELOW THIS LINE -->


<!-- END SECTION 1 -->

---

## SECTION 2 — Validation Rules and Error Messages

_The exact error messages users see, what causes them, and how to fix them.
Paste from test scripts, BA acceptance criteria, user complaints, Jira tickets,
or any source that lists what the system rejects and why._

_Example of acceptable input:_
_"If you try to publish a report that's already published you get
'Performance report is already published'. Happens when admin double-clicks."_

<!-- PASTE NOTES BELOW THIS LINE -->


<!-- END SECTION 2 -->

---

## SECTION 3 — Domain Context

_What this system is FOR in business terms. Who uses it in the real world,
what problem it solves, what industry or regulatory context it operates in,
what the business calls things (not what the code calls them)._

_Example of acceptable input:_
_"Government performance reporting system. Used by SA public sector departments
to track quarterly KPIs against their Annual Performance Plans. Submitted to
National Treasury. Audited by AGSA (Auditor General)."_

<!-- PASTE NOTES BELOW THIS LINE -->


<!-- END SECTION 3 -->

---

## SECTION 4 — Approval Hierarchy and Workflows

_The organisational structure that the workflows implement. Who approves what,
in what order, what titles/roles are involved, what happens on rejection.
Can be a flow diagram description, a table, or just free text._

_Example of acceptable input:_
_"Planning goes: Strategic Unit -> DDG -> Chief Director -> DG -> done.
QA has 6 levels. Level 1 is line manager. Level 5 is M&E. Level 6 is internal audit.
Anyone can send back which resets to the reporter."_

<!-- PASTE NOTES BELOW THIS LINE -->


<!-- END SECTION 4 -->

---

## SECTION 5 — Term Mappings (user-facing ↔ code)

_Terms the business uses that don't obviously match the code entity names.
Paste pairs: "what users call it" = "what the code calls it"_

_Example:_
_Portfolio of Evidence = StoredFile_
_Actioner = ComponentPerson_
_RAG Status = RAGValue field on ComponentProgressReport_

<!-- PASTE NOTES BELOW THIS LINE -->


<!-- END SECTION 5 -->

---

## SECTION 6 — Anything Else

_Anything that doesn't fit above — architectural decisions the team made and why,
known bugs or workarounds, things that are confusing about the codebase,
context a new developer would need that isn't in the code._

<!-- PASTE NOTES BELOW THIS LINE -->


<!-- END SECTION 6 -->

---

## NORMALISATION RULES (for the skill — do not edit)

When this file is read, the skill must:

1. Extract content from each section between the comment markers
2. Ignore empty sections — do not generate placeholder content for them
3. For non-empty sections, rewrite the content into clean structured prose
   before injecting it into the wiki — preserve all facts, fix formatting only
4. Map normalised content to wiki sections:
   - Section 1 (Roles) → new **Roles & Permissions** wiki section + API Reference permission column
   - Section 2 (Validation) → new **Validation Rules** wiki section
   - Section 3 (Domain Context) → enriches **Overview** and **Learning Objectives**
   - Section 4 (Approval Hierarchy) → enriches **Lifecycle Map** state table and flow diagram
   - Section 5 (Term Mappings) → **Glossary** wiki section
   - Section 6 (Anything Else) → enriches **Design Decisions** and **Coverage Gaps**
5. Sections 1–4 empty → declare Coverage Gap in that wiki section with specific prompt:
   "Add [Role definitions / Validation rules / Domain context / Approval hierarchy]
    to generator-memory.md Section [N] to fill this gap."
6. Section 5 empty → Glossary section shows only code-derived terms (entity names,
   method names, permission strings) without user-facing term mappings
7. Section 6 empty → no effect on output
8. Never expose raw notes content in the wiki — always normalise first
9. This normalisation pass happens ONCE before any section is written,
   not section by section during generation
