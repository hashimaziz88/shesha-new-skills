#!/usr/bin/env python3
"""Pre-install check for the Claude Code memory-hook system.

Answers one question: can this machine actually run these hooks, and what's
missing? Read-only -- it inspects and reports, it never installs or edits.

Run:  python check_prereqs.py
Exit: 0 = ready (or ready with warnings), 1 = at least one blocker
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
SETTINGS = CLAUDE_DIR / "settings.json"
PROJECTS_DIR = CLAUDE_DIR / "projects"

blockers = []
warnings = []
notes = []


def configured_models() -> list:
    """Distinct models from ~/.claude/hooks/memory_config.json -> models,
    in config order. Falls back to the hooks' built-in defaults."""
    defaults = ["claude-sonnet-5-5", "claude-haiku-5-5"]
    try:
        cfg = json.loads((CLAUDE_DIR / "hooks" / "memory_config.json").read_text(encoding="utf-8"))
        models = [str(m).strip() for m in ((cfg or {}).get("models") or {}).values() if str(m).strip()]
    except (OSError, ValueError, TypeError, AttributeError):
        models = []
    return list(dict.fromkeys(models or defaults))


def check(label: str, ok: bool, detail: str, blocking: bool = True) -> None:
    mark = "PASS" if ok else ("FAIL" if blocking else "WARN")
    print(f"[{mark}] {label}: {detail}")
    if not ok:
        (blockers if blocking else warnings).append(f"{label}: {detail}")


def main() -> int:
    print("=== Claude Code memory-hook prerequisites ===\n")

    # 1. Python version (hooks use f-strings, pathlib, dict ordering)
    v = sys.version_info
    check("Python 3.8+", v >= (3, 8), f"found {v.major}.{v.minor}.{v.micro} at {sys.executable}")

    # 2. claude CLI on PATH -- required: the hooks call it headlessly instead of
    #    using an ANTHROPIC_API_KEY, so it must be resolvable by absolute path
    #    or PATH from a hook subprocess.
    claude_path = shutil.which("claude")
    check("claude CLI on PATH", bool(claude_path), claude_path or "not found -- install Claude Code and ensure `claude` resolves")

    # 3. claude CLI version
    if claude_path:
        try:
            r = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=60)
            check("claude --version", r.returncode == 0, (r.stdout or r.stderr).strip()[:120])
        except (OSError, subprocess.TimeoutExpired) as e:
            check("claude --version", False, f"could not run: {e}")

    # 4. Headless mode + the exact flags the hooks pass. This is the real test:
    #    if this works, hooks can call the model with no API key, on the
    #    existing subscription login.
    #    Tests every distinct model the hooks are configured to use
    #    (memory_config.json -> models), so a bad model name fails here
    #    instead of silently inside a hook.
    if claude_path:
        for model in configured_models():
            label = f"headless `claude -p` with hook flags [{model}]"
            try:
                r = subprocess.run(
                    ["claude", "-p", "Reply with exactly: ok",
                     "--output-format", "json",
                     "--safe-mode",
                     "--model", model,
                     "--system-prompt", "You are a plain text assistant. Answer concisely.",
                     "--allowedTools", "",
                     "--strict-mcp-config",
                     "--no-session-persistence",
                     "--max-budget-usd", "0.50"],
                    capture_output=True, text=True, timeout=180
                )
                if r.returncode == 0:
                    payload = json.loads(r.stdout)
                    result = str(payload.get("result", "")).strip()
                    ok = bool(result) and not payload.get("is_error")
                    check(label, ok, f"returned {result!r}")
                    notes.append(
                        "{}: call cost ~{:.3f} USD-equivalent; repeat calls with identical flags "
                        "hit the 1h prompt cache and cost less.".format(
                            model, float(payload.get("total_cost_usd") or 0))
                    )
                else:
                    check(label, False, f"exit {r.returncode}: {(r.stderr or r.stdout or '')[:200]}")
            except subprocess.TimeoutExpired:
                check(label, False, "timed out after 180s")
            except (OSError, json.JSONDecodeError) as e:
                check(label, False, f"failed: {e}")

    # 5. Auth style. An API key works too, but the whole point of this design is
    #    riding the subscription login, so report which one is in play.
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    creds = CLAUDE_DIR / ".credentials.json"
    if has_key:
        notes.append("ANTHROPIC_API_KEY is set -- calls will bill per-token to that key, not the subscription.")
    elif creds.exists():
        notes.append("Subscription OAuth login detected (.credentials.json) -- no API key needed.")
    else:
        warnings.append("No API key and no .credentials.json -- run `claude login` first.")
        print("[WARN] auth: no API key and no .credentials.json found -- run `claude login`")

    # 6. ~/.claude writable (hooks, logs, state all live here)
    try:
        CLAUDE_DIR.mkdir(parents=True, exist_ok=True)
        probe = CLAUDE_DIR / ".prereq_write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        check("~/.claude writable", True, str(CLAUDE_DIR))
    except OSError as e:
        check("~/.claude writable", False, f"{CLAUDE_DIR}: {e}")

    # 7. settings.json present and valid. Invalid JSON silently disables EVERY
    #    setting in the file, so this must be checked before editing it.
    if SETTINGS.exists():
        try:
            data = json.loads(SETTINGS.read_text(encoding="utf-8"))
            check("settings.json valid JSON", True, f"{SETTINGS} ({len(json.dumps(data))} bytes parsed)")
            existing = list((data.get("hooks") or {}).keys())
            notes.append(f"Existing hook events already configured: {existing or 'none'} -- MERGE, never overwrite.")
            if data.get("disableAllHooks"):
                check("hooks not globally disabled", False, "disableAllHooks is true -- hooks will not run")
            else:
                check("hooks not globally disabled", True, "disableAllHooks not set")
        except json.JSONDecodeError as e:
            check("settings.json valid JSON", False, f"{SETTINGS} is malformed ({e}) -- fix before editing")
    else:
        notes.append(f"No settings.json yet at {SETTINGS} -- it will be created.")
        print(f"[PASS] settings.json: absent, will be created at {SETTINGS}")

    # 8. Transcripts directory -- the extractor reads session JSONL from here.
    if PROJECTS_DIR.exists():
        try:
            count = sum(len(list(p.glob("*.jsonl"))) for p in PROJECTS_DIR.iterdir() if p.is_dir())
            check("session transcripts readable", True, f"{count} transcript(s) under {PROJECTS_DIR}")
        except OSError as e:
            check("session transcripts readable", False, f"{PROJECTS_DIR}: {e}")
    else:
        check("session transcripts readable", False,
              f"{PROJECTS_DIR} missing -- run at least one Claude Code session first", blocking=False)

    # 9. Clarification popup backend (PreToolUse guard only; optional).
    if sys.platform == "win32":
        ps = shutil.which("powershell") or shutil.which("pwsh")
        check("PowerShell for clarification popup", bool(ps), ps or "not found -- popup will fail (guard still blocks safely)", blocking=False)
    else:
        notes.append("Non-Windows platform: the PreToolUse popup uses PowerShell and will not work as-is. "
                     "Replace ask_popup() with zenity/osascript, or accept that it always reports 'no answer'.")

    print()
    if notes:
        print("--- Notes ---")
        for n in notes:
            print(f"  * {n}")
        print()
    if warnings:
        print("--- Warnings (non-blocking) ---")
        for w in warnings:
            print(f"  ! {w}")
        print()
    if blockers:
        print("--- BLOCKERS (must fix before installing) ---")
        for b in blockers:
            print(f"  X {b}")
        print("\nRESULT: NOT READY")
        return 1

    print("RESULT: READY TO INSTALL")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
