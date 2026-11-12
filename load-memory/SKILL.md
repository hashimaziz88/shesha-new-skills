---
name: load-memory
description: >
  Loads the Obsidian memory vault into the current session's context, so Claude
  can see everything previously learned across all sessions and projects
  instead of only what the per-prompt UserPromptSubmit memory check surfaced.
  Trigger phrases include "/load-memory", "load your memory", "load the vault",
  "what do you remember", "recall everything about this project", "pull in
  memory before we start".

  Use this at the START of a session (especially a session that was already
  running before the memory hooks were installed, or one where you want full
  recall rather than per-prompt hints), or any time recall seems incomplete.

  Two phases: an optional CATCH-UP pass that runs the memory extractor over
  recent session transcripts so nothing said in a still-running session is
  left unextracted, then a LOAD pass that prints the vault's notes into
  context. Read-only with respect to the project; it only writes to the vault
  and the extractor's cursor-state file.
---

# Load Memory

Pulls the persistent memory vault into this conversation.

## When to use

- Start of a session where you want full recall, not just per-prompt hints.
- A session that was **already open** before the memory hooks were installed
  (its earlier turns were never extracted).
- Recall seems wrong or incomplete — the per-prompt check said "No" for
  something you're sure was discussed before.
- Before a task that depends on prior decisions ("how did we decide to handle
  X?").

## How to run it

The script lives at `~/.claude/hooks/load_memory.py`. Always show the command
preview block before running it (per the user's global instruction), then run:

**Default — load the vault only (fast, no API calls):**

```
python ~/.claude/hooks/load_memory.py
```

**Full — catch up unextracted sessions first, then load:**

```
python ~/.claude/hooks/load_memory.py --catch-up
```

`--catch-up` invokes the memory extractor repeatedly (one `claude -p` call per
pass, up to 12 passes per session) for every transcript touched in the last 3
days, until each one's cursor reaches the end of its transcript. That costs
real usage against the subscription, so only use it when the vault is actually
behind — mention that to the user before running it.

**Useful flags:**

| Flag | Purpose |
|---|---|
| `--catch-up` | Extract un-processed session content before loading |
| `--days N` | Catch-up window (default 3) |
| `--project NAME` | Only load notes whose frontmatter `project` matches |
| `--limit N` | Max notes printed per folder (default 15) |
| `--chars N` | Max body characters per note (default 600) |

On a large vault, prefer `--project <current project>` plus a modest `--limit`
so you load what's relevant rather than everything.

## After loading

State plainly what was loaded — note count per category, and anything directly
relevant to the task at hand. Then use it: if a loaded note contradicts what
you were about to do, follow the note (or say why it no longer applies). Do not
just acknowledge that memory was loaded and then ignore it.

If the vault is empty or missing, say so — it populates automatically via the
`Stop` hook as sessions run, so an empty vault on a fresh install is expected,
not a failure.

## How it relates to the hooks

This skill is the **manual, full-recall** path. The automatic paths are:

- `UserPromptSubmit` → `memory_context_checker.py` — per-prompt "have I seen
  this before?" check (keyword prefilter, then one LLM judgment call).
- `Stop` → `memory_extractor.py` — extracts new transcript content into the
  vault after every turn, tracked by a per-session line cursor.
- `Stop` → `log-session.js` — session logging (fails silently by design).
- `PreToolUse` → `failure_clarification_guard.py` — the "stuck agent" guard
  (see below).

This skill reads the same vault those hooks maintain, so it reflects
everything they have captured.

## Bundled hook scripts (current layout)

These scripts live where `~/.claude/settings.json` points, in
`~/.claude/hooks/`. This section documents that existing setup. The files are
not moved or copied here; reorganizing them into this skill folder is deferred.

| Script | Event (settings.json) | Model (config key) | Purpose |
|---|---|---|---|
| `memory_context_checker.py` | `UserPromptSubmit` | `claude-haiku-5-5` (`checker`) | Per-prompt recall check against the vault |
| `memory_extractor.py` | `Stop` | `claude-haiku-5-5` (`extractor`) | Extracts new transcript content into the vault; line-cursor state |
| `log-session.js` | `Stop` | none | Session logging; errors are swallowed (`|| true`) |
| `load_memory.py` | manual (this skill) | none (`--catch-up` uses `extractor`) | Loads the vault; `--catch-up` runs the extractor |
| `check_prereqs.py` | manual / setup | tests every configured model | Checks prerequisites for the memory tooling |
| `failure_clarification_guard.py` | `PreToolUse` | `claude-haiku-5-5` (`guard`) | Detects a stuck or looping agent and asks the user for clarification |
| `memory_config.json` | read by the scripts | — | Holds `vault_path` and the `models` block |

### Choosing models

Each LLM-calling hook reads its model from `memory_config.json` -> `models`
(`extractor`, `checker`, `guard`), so swapping a model is a config edit, not a
code edit. If a key is missing the script uses its built-in default.
`fallback` is passed as `--fallback-model` when it differs from the main model
(the CLI rejects identical ones). After changing models, run
`python ~/.claude/hooks/check_prereqs.py` -- it test-calls every configured model.

All three default to Haiku: a side-by-side test on a real ~12K-char transcript
slice gave equivalent extraction quality to Sonnet at ~14x lower cost and
similar latency, and the checker/guard sit on the hot path where speed matters.

### failure_clarification_guard.py

Runs before every tool call. It is silent unless the recent transcript looks
like a struggle:

1. **Trigger:** at least 2 failure-keyword hits in the last 20 transcript
   lines (`error`, `failed`, `denied`, `ENOENT`, `timed out`, and similar), or
   the same tool called 3+ times back to back.
2. **Judgment:** one headless `claude -p` call decides whether a human should
   be interrupted, and returns `{"needs_clarification", "question"}`.
3. **Action:** if yes, a Windows input box asks the question. The answer, or a
   note that none was given, goes back to Claude as a `PreToolUse` deny reason.

It fails open. Any parse, CLI, or unexpected error leaves the tool call
allowed, so the guard cannot block a session by breaking. Logs go to
`~/.claude/hook-logs/failure_clarification_guard.log`.

Do not treat the popup answer as a standing instruction. It applies to the
moment it was asked.
