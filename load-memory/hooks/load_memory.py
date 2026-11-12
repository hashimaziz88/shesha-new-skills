#!/usr/bin/env python3
"""Loads the Obsidian memory vault into the current session's context.

Invoked by the /load-memory skill (not by a hook). Two phases:

  1. CATCH-UP (optional, --catch-up): runs memory_extractor.py against recent
     session transcripts until each one's cursor reaches the end, so anything
     said in a still-running session -- or in a session that ran while the
     hooks were misconfigured -- is extracted into the vault before we read it.
  2. LOAD: prints the vault's notes to stdout so they land in Claude's context.

Everything is printed to stdout by design: the skill's job is to pull memory
INTO the conversation, so stdout IS the product.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

# --- Configuration ---
# Default keeps everything under the home directory, no absolute paths baked in.
def resolve_vault_path() -> Path:
    """Vault location, in precedence order — no absolute path is ever baked
    into this source:
      1. CLAUDE_MEMORY_VAULT environment variable
      2. vault_path in ~/.claude/hooks/memory_config.json (read at runtime, so
         it works immediately without restarting Claude Code — the settings.json
         `env` block only reaches hooks spawned after a restart)
      3. ~/claude-memory
    """
    env_path = os.environ.get("CLAUDE_MEMORY_VAULT", "").strip()
    if env_path:
        return Path(env_path)
    try:
        config_file = Path.home() / ".claude" / "hooks" / "memory_config.json"
        if config_file.exists():
            config = json.loads(config_file.read_text(encoding="utf-8"))
            if isinstance(config, dict):
                configured = str(config.get("vault_path", "")).strip()
                if configured:
                    return Path(configured)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass
    return Path.home() / "claude-memory"


VAULT_PATH = resolve_vault_path()
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
EXTRACTOR_PATH = Path.home() / ".claude" / "hooks" / "memory_extractor.py"
STATE_PATH = Path.home() / ".claude" / "hook-logs" / "memory_extractor_state.json"

INDEX_NAME = "Index.md"
MAX_CATCH_UP_PASSES = 12   # per session; each pass = one extractor call
CATCH_UP_WINDOW_DAYS = 3   # only catch up transcripts touched this recently


def vault_folders() -> list:
    """Actual note folders present in the vault, discovered rather than
    hardcoded -- filesystems differ on case (a 'Context' vs 'context' folder
    is the same directory on Windows, two different ones on Linux)."""
    if not VAULT_PATH.exists():
        return []
    try:
        return sorted(p for p in VAULT_PATH.iterdir() if p.is_dir())
    except OSError as e:
        print(f"[load-memory] Could not list vault at {VAULT_PATH}: {e}", file=sys.stderr)
        return []


def strip_frontmatter(content: str) -> tuple:
    """Returns (metadata dict, body). Plain string split, no regex -- avoids a
    backtracking-prone lazy-DOTALL pattern over a whole file body."""
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    meta = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, parts[2].lstrip()


def recent_transcripts(days: int) -> list:
    """(session_id, project_folder_name, mtime, path) for transcripts modified
    within the last `days`, newest first."""
    if not CLAUDE_PROJECTS_DIR.exists():
        return []
    cutoff = datetime.now() - timedelta(days=days)
    found = []
    try:
        project_folders = [p for p in CLAUDE_PROJECTS_DIR.iterdir() if p.is_dir()]
    except OSError as e:
        print(f"[load-memory] Could not list {CLAUDE_PROJECTS_DIR}: {e}", file=sys.stderr)
        return []

    for folder in project_folders:
        try:
            jsonl_files = list(folder.glob("*.jsonl"))
        except OSError:
            continue
        for path in jsonl_files:
            try:
                mtime = datetime.fromtimestamp(path.stat().st_mtime)
            except OSError:
                continue
            if mtime < cutoff:
                continue
            found.append((path.stem, folder.name, mtime, path))

    found.sort(key=lambda row: row[2], reverse=True)
    return found


def transcript_line_count(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def load_cursor(session_id: str) -> int:
    try:
        if STATE_PATH.exists():
            state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(state, dict):
                return int(state.get(session_id, 0))
    except (OSError, json.JSONDecodeError, ValueError, TypeError):
        pass
    return 0


def catch_up_session(session_id: str, cwd: str, transcript: Path) -> str:
    """Repeatedly invokes memory_extractor.py until its cursor reaches the end
    of the transcript (or the pass cap). Reuses the extractor instead of
    duplicating its logic, so extraction has exactly one implementation."""
    total = transcript_line_count(transcript)
    if total == 0:
        return "empty transcript"

    start_cursor = load_cursor(session_id)
    if start_cursor >= total:
        return f"already current ({total} lines)"

    payload = json.dumps({"session_id": session_id, "cwd": cwd})
    passes = 0
    cursor = start_cursor
    while cursor < total and passes < MAX_CATCH_UP_PASSES:
        passes += 1
        try:
            subprocess.run(
                [sys.executable, str(EXTRACTOR_PATH)],
                input=payload, text=True, capture_output=True, timeout=180
            )
        except subprocess.TimeoutExpired:
            return f"timed out after {passes} pass(es) at line {cursor} of {total}"
        except OSError as e:
            return f"could not run extractor: {e}"

        new_cursor = load_cursor(session_id)
        if new_cursor <= cursor:
            return f"stalled at line {cursor} of {total} after {passes} pass(es)"
        cursor = new_cursor

    return f"caught up {start_cursor} to {cursor} of {total} in {passes} pass(es)"


def do_catch_up(days: int) -> None:
    transcripts = recent_transcripts(days)
    if not transcripts:
        print(f"No session transcripts modified in the last {days} day(s).\n")
        return
    print(f"## Catch-up: {len(transcripts)} session(s) touched in the last {days} day(s)\n")
    for session_id, project_folder, mtime, path in transcripts:
        result = catch_up_session(session_id, project_folder, path)
        print(f"- `{session_id[:8]}` ({project_folder}, {mtime:%Y-%m-%d %H:%M}) -- {result}")
    print()


def do_load(project_filter: str, limit_per_folder: int, body_chars: int) -> None:
    folders = vault_folders()
    if not folders:
        print(f"Memory vault is empty or missing at `{VAULT_PATH}` -- nothing to load yet.")
        print("It populates automatically via the Stop hook as sessions run.")
        return

    print(f"# Memory vault loaded from `{VAULT_PATH}`\n")
    total_notes = 0

    for folder in folders:
        try:
            md_files = sorted(folder.glob("*.md"), reverse=True)
        except OSError:
            continue
        if not md_files:
            continue

        notes = []
        for path in md_files:
            try:
                content = path.read_text(encoding="utf-8")
            except OSError:
                continue
            meta, body = strip_frontmatter(content)
            if project_filter and project_filter.lower() not in meta.get("project", "").lower():
                continue
            notes.append((path, meta, body))

        if not notes:
            continue

        shown = notes[:limit_per_folder]
        print(f"## {folder.name} ({len(notes)} note(s), showing {len(shown)})\n")
        for path, meta, body in shown:
            stamp = f"{meta.get('date', '?')} {meta.get('time', '')}".strip()
            project = meta.get("project", "?")
            tags = meta.get("tags", "")
            body_clean = " ".join(body.split())[:body_chars]
            print(f"### {path.stem}")
            print(f"*{stamp} | project: {project} | tags: {tags}*\n")
            print(f"{body_clean}\n")
            total_notes += 1
        print()

    index_path = VAULT_PATH / INDEX_NAME
    if index_path.exists():
        try:
            index_text = index_path.read_text(encoding="utf-8").strip()
            if index_text:
                print("## Index\n")
                print(index_text[:2000])
                print()
        except OSError:
            pass

    print(f"---\n**{total_notes} note(s) loaded into context.**")
    if project_filter:
        print(f"Filtered to notes whose project matches `{project_filter}`.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Load the Claude memory vault into context.")
    parser.add_argument("--catch-up", action="store_true",
                        help="First run the extractor over recent sessions so nothing is left unextracted.")
    parser.add_argument("--days", type=int, default=CATCH_UP_WINDOW_DAYS,
                        help=f"Catch-up window in days (default {CATCH_UP_WINDOW_DAYS}).")
    parser.add_argument("--project", default="",
                        help="Only show notes whose frontmatter project matches this substring.")
    parser.add_argument("--limit", type=int, default=15,
                        help="Max notes printed per folder (default 15).")
    parser.add_argument("--chars", type=int, default=600,
                        help="Max body characters per note (default 600).")
    args = parser.parse_args()

    if args.catch_up:
        do_catch_up(args.days)
    do_load(args.project, args.limit, args.chars)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
