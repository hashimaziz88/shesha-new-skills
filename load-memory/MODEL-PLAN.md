# Model plan for the memory hooks

Which Claude model each memory hook script uses, why, and how to change it.

## Current assignment

| Script | Hook event | Config key | Model | Blocks the user? |
|---|---|---|---|---|
| `memory_context_checker.py` | `UserPromptSubmit` | `checker` | `claude-haiku-5-5` | Yes, runs before every reply |
| `failure_clarification_guard.py` | `PreToolUse` | `guard` | `claude-haiku-5-5` | Yes, holds the tool call (only when the session looks stuck) |
| `memory_extractor.py` | `Stop` | `extractor` | `claude-haiku-5-5` | Mostly no, runs after the reply |
| `check_prereqs.py` | manual | n/a | Test-calls every configured model | n/a |
| `load_memory.py` | manual (`/load-memory`) | n/a | None (`--catch-up` runs the extractor) | n/a |
| `log-session.js` | `Stop` | n/a | None | n/a |

## How models are chosen

Models are read at runtime from `~/.claude/hooks/memory_config.json`:

```json
{
  "vault_path": "<your vault path>",
  "models": {
    "extractor": "claude-haiku-5-5",
    "checker": "claude-haiku-5-5",
    "guard": "claude-haiku-5-5",
    "fallback": "claude-haiku-5-5"
  }
}
```

- Each script calls `resolve_model(key, default)`. If the key is missing or the config is invalid, the script uses its built-in default.
- `fallback` is passed as `--fallback-model` only when it differs from the script's main model, because the CLI rejects identical ones. With every key on Haiku, no fallback is active. Set `"fallback": "claude-sonnet-5-5"` to get a backup when Haiku is overloaded.
- After changing any model, run `python ~/.claude/hooks/check_prereqs.py`. A bad model name then fails there, instead of silently inside a hook.
- Each script passes the same flags on every call so the CLI's 1-hour prompt cache stays warm. Change only the model, never the system prompt.

## Why Haiku for all three

The selection criteria were how often the script runs, whether it blocks the user, and how much quality matters.

**Pricing** per 1M tokens, input / output. These figures come from secondary sources; check them against Anthropic's pricing page.

| Model | Price | Relative |
|---|---|---|
| Haiku 5.5 | $0.10 / $0.50 (prompts ≤100K tokens) | 1x |
| Sonnet 5.5 | $2 / $10 | ~20x |
| Opus 5.5 | $4 / $20 | ~40x |

Every hook prompt stays under 100K tokens; the extractor caps new content at 12,000 characters per call. Haiku always gets its lower rate.

**Measured results.** All runs used the hooks' exact `claude -p` flags on Claude Code CLI 2.1.322.

- **Context checker latency:** the same prompt was run through the real script, twice per model.

  | Model | Run 1 | Run 2 | Average |
  |---|---|---|---|
  | `claude-opus-4-5` (original) | 11.8s | 11.5s | ~11.7s |
  | `claude-haiku-5-5` | 4.4s | 5.1s | ~4.8s |

  Haiku is about 2.4x faster, with the same "seen before" verdict from both models. Most of the remaining ~4.8s is CLI startup, not model time.

- **Extractor quality:** both models extracted the same real ~12K-character transcript slice.

  | Model | Time | Cost | Valid JSON | Notes |
  |---|---|---|---|---|
  | `claude-haiku-5-5` | 10.8s | $0.0043 | yes | 9 |
  | `claude-sonnet-5-5` | 9.3s | $0.0609 | yes | 6 |

  Both caught the same key items, including an explicit user instruction to remember. Haiku added a few extra notes, one of them slightly noisy. Haiku costs about 14x less at similar speed, so it was chosen over the Sonnet the plan originally proposed.

- **Stuck-agent guard:** this is a simple yes/no "should I interrupt the human?" call on the hot path. If the guard errors, it lets the tool call through, so a wrong judgment costs at most an extra popup or a missed one.

## When to move up a model

- **Extractor → `claude-sonnet-5-5`:** if the vault fills with noisy or duplicate notes, or explicit "remember X" instructions are missed. Only quality problems in this script are worth paying more to fix.
- **Checker or guard:** keep these on Haiku. The latency cost is paid on every prompt or tool call.

## Known follow-up

The extractor doesn't check existing notes before writing, so near-duplicates appear (e.g. two "vault location" notes). A dedupe pass against existing note titles would improve recall quality more than a larger model would.
