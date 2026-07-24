# Book Principles for Documentation

Applied to every wiki generation pass and to SheshaExplorer output labels.
Each heading = one source. Principles are actionable, not abstract.

---

## A Philosophy of Software Design — John Ousterhout

1. **Document what isn't obvious from the code.** Never repeat the signature. Explain intent, units, boundary conditions, side effects, and why the code exists.
2. **Deep modules over shallow ones.** The API Reference section's value is its insight-to-length ratio. Cut anything the reader could infer themselves.
3. **Unknown unknowns are the worst complexity.** The Architecture and Dead Code sections exist to eliminate them. If a developer can't tell what code is relevant to their change, the wiki has failed.
4. **Cross-module design decisions belong in a central place.** Generate a "Design Decisions" section for anything that spans more than one layer (e.g., why a DTO is shared between AppService and Controller).
5. **Names are documentation.** When SheshaExplorer reflects a node whose name is too generic (single verbs: `Get`, `Handle`, `Process`, `Do`, `Run`) or misleading, flag it as a naming smell in the Dead Code Report.
6. **CA generation depth = cognitive load proxy.** The mean activation generation of a node across all CA runs is its coupling score. High scores (≥3) should be highlighted in the Architecture section as complexity hotspots.
7. **Information leakage surfaces as SharedType edges.** When two AppService methods share a DTO in a non-obvious way, flag it in Architecture as a potential leakage point.
8. **Consistency reduces cognitive load.** The wiki must use the same term for the same concept throughout. Never use "endpoint" and "action" and "method" interchangeably for the same thing.

---

## Clean Code — Robert C. Martin

1. **Command Query Separation.** Classify every API endpoint as Command (POST/PUT/DELETE — changes state) or Query (GET — returns data). Flag any endpoint that does both (e.g., a GET that modifies state, or a POST that returns computed data as its primary output).
2. **Intention-revealing names.** A name that requires a comment to explain it is a bad name. When SheshaExplorer finds methods whose names don't match their inferred end-goal, flag the discrepancy.
3. **Commented-out code is dead code.** SheshaExplorer's dead code detection should explicitly call out large commented-out blocks as a separate category in the Dead Code Report.
4. **Complexity smells belong in the Dead Code Report.** Nodes are not just dead or alive — they can be *too complex*. Flag AppService methods with >5 parameters or >3 outgoing CA edges as complexity candidates.
5. **Comments explain intent, not mechanics.** The wiki's API Reference should document *why* a method exists and what invariants it maintains, not reproduce its signature.
6. **Don't repeat yourself.** The wiki must not duplicate content from the README. Reference it; don't copy it.
7. **Functions do one thing.** When SheshaExplorer detects an AppService method that calls both a repository AND dispatches to another AppService AND checks a permission, flag it as a candidate for decomposition.

---

## Docs for Developers — Bhatti, Corleissen, Lambourne, Nunez, Waterhouse

1. **Audience first, structure second.** Wiki sections are ordered for two audiences: newcomers first (Overview, Setup), experienced developers second (Architecture, API Reference, Lifecycle Map, Dead Code).
2. **Content types must not be mixed.** Conceptual docs (Architecture), procedural docs (Setup), and reference docs (API Reference) serve different purposes. Never merge them into one section.
3. **API reference leads with authentication and format, then enumerates every resource.** Each endpoint entry must include: route, HTTP verb, permission required, parameters table, example request, example response.
4. **Automate reference generation.** SheshaExplorer is the automation layer. The skill should remind the user to re-run it when assemblies change.
5. **State the most important information first.** Every section opens with one sentence answering "what does this tell me?" before going into detail.
6. **Deprecation is a documentation responsibility.** When the Dead Code Report flags a node, its associated wiki documentation should also receive a `> [!WARNING]` deprecation callout.
7. **Missing content is better declared than absent.** If SheshaExplorer cannot reach a DLL, the wiki section should say "Coverage incomplete — DLL path not provided" rather than omitting the section.

---

## Software Engineering at Google — Winters, Manshreck, Wright

1. **Documentation is like code: it needs owners.** Every generated wiki page should include a CODEOWNER line and a "Last verified" date.
2. **Optimize for the reader.** The wiki is written once and read hundreds of times. Every word that costs the reader time is a defect.
3. **WHO, WHAT, WHEN, WHERE, WHY.** Use this as a self-check for each section: does it answer all five? Missing answers = incomplete documentation.
4. **Source control the docs.** The publishing instructions should default to Option B (git-backed wiki), not Option A (UI paste). Treat wiki commits like code commits.
5. **Automate enforcement.** SheshaExplorer's JSON export enables a CI pipeline check: if the DLL graph has changed since the last wiki commit, fail the pipeline and prompt a wiki update.
6. **Separate reference, conceptual, and tutorial docs.** Do not put step-by-step instructions inside the Architecture section. Do not put conceptual explanations inside the API Reference.
7. **Stale docs are as harmful as no docs.** Add a "Last verified" metadata line to the top of every generated wiki page: `> _Last verified: {date} against DLL build {hash}_`.

---

## The Product is Docs — Christopher Gales & Splunk Documentation Team

1. **Scenario-driven structure.** The Lifecycle Map should be organised by user goal (e.g., "Complete a Work Order") not by controller or namespace. Each goal entry lists the endpoints that serve it.
2. **Learning objectives.** Each section opens with what the reader will be able to do after reading it. E.g., "After this section you will understand how orders flow from creation to completion."
3. **Technical verification.** The Setup & Installation section's steps should be marked with a verification status: ✅ verified, ⚠️ unverified, ❌ known issue.
4. **Coverage gaps are explicit.** When SheshaExplorer cannot fully reflect an assembly, add a "Coverage Gaps" callout listing what could not be discovered and why.
5. **Documentation decisions.** When the skill makes a structural choice (e.g., grouping by namespace vs. by end-goal), add a brief note explaining why, so the human maintaining the wiki understands the logic.
6. **Audience goals differ.** The Lifecycle Map serves the debugging/tracing audience. The Dead Code Report serves the refactoring audience. The Architecture diagram serves the onboarding audience. Write to each.
7. **Docs should live as close to the code as possible.** Recommend placing the wiki source `.md` file inside the repo at `/docs/wiki/` and syncing to ADO Wiki via CI, not maintaining it manually.
