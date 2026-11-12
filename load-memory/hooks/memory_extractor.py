#!/usr/bin/env python3
import json
import os
import sys
import re
import subprocess
import traceback
from datetime import datetime
from pathlib import Path

# --- Configuration ---
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
LOG_PATH = Path.home() / ".claude" / "hook-logs" / "memory_extractor.log"
STATE_PATH = Path.home() / ".claude" / "hook-logs" / "memory_extractor_state.json"
MAX_STATE_ENTRIES = 500  # prune oldest sessions past this so the state file doesn't grow forever
MAX_NEW_CONTENT_CHARS = 12000  # cap per extraction call; processed oldest-first, cursor only advances past what's actually sent

# Headless invocation of the local `claude` CLI — reuses the existing
# Claude Code login/subscription instead of a separate ANTHROPIC_API_KEY.
# Keep every one of these flags/strings byte-identical across calls: that's
# what lets Claude Code's 1-hour prompt cache kick in (cache hit ≈ 19x
# cheaper than a cache miss). Put ALL variable content in the prompt
# argument, never in --system-prompt.
CLAUDE_BIN = "claude"
CLAUDE_MODEL = "claude-opus-4-5"
CLAUDE_SYSTEM_PROMPT = "You are a plain text extraction assistant. Answer concisely with only the requested JSON."
CLAUDE_MAX_BUDGET_USD = "0.50"


def log_event(level: str, message: str, exc: BaseException = None) -> None:
    """Append one line (plus optional traceback) to the hook's log file.
    Never raises — a logging failure must never be the thing that crashes a hook."""
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {level}: {message}\n")
            if exc is not None:
                f.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
    except Exception:
        pass


def call_claude(prompt: str) -> str:
    """Run one headless completion via the local claude CLI. Returns the response
    text, or '' on any failure. Every failure mode is logged with enough detail
    to diagnose later, since a bare '' return is otherwise indistinguishable from
    'nothing to do'."""
    try:
        result = subprocess.run(
            [
                CLAUDE_BIN, "-p", prompt,
                "--output-format", "json",
                "--safe-mode",
                "--model", CLAUDE_MODEL,
                "--system-prompt", CLAUDE_SYSTEM_PROMPT,
                "--allowedTools", "",
                "--strict-mcp-config",
                "--no-session-persistence",
                "--max-budget-usd", CLAUDE_MAX_BUDGET_USD,
            ],
            capture_output=True, text=True, timeout=120
        )
    except FileNotFoundError:
        log_event("ERROR", f"'{CLAUDE_BIN}' not found on PATH — is Claude Code installed and on PATH?")
        return ""
    except subprocess.TimeoutExpired:
        log_event("ERROR", "claude CLI call timed out after 120s")
        return ""
    except Exception as e:
        log_event("ERROR", "Unexpected error launching claude CLI", e)
        return ""

    if result.returncode != 0:
        log_event("ERROR", f"claude CLI exited {result.returncode}: {result.stderr[:500]}")
        return ""

    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        log_event("ERROR", f"claude CLI returned non-JSON stdout: {result.stdout[:300]}", e)
        return ""

    if not isinstance(response, dict):
        log_event("ERROR", f"claude CLI returned unexpected JSON shape: {type(response).__name__}")
        return ""

    if response.get("is_error"):
        log_event("ERROR", f"claude CLI reported an error result: {json.dumps(response)[:500]}")
        return ""

    return response.get("result", "")


def load_state() -> dict:
    """Maps session_id -> number of transcript lines already processed, so each
    run only extracts what's NEW since last time instead of re-scanning (or,
    worse, permanently missing) the same fixed window every turn."""
    try:
        if STATE_PATH.exists():
            data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as e:
        log_event("WARNING", "Could not read state file, starting fresh", e)
    return {}


def save_state(state: dict) -> None:
    try:
        if len(state) > MAX_STATE_ENTRIES:
            # dicts preserve insertion order; drop the oldest entries to cap growth
            overflow = len(state) - MAX_STATE_ENTRIES
            for key in list(state.keys())[:overflow]:
                del state[key]
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(state), encoding="utf-8")
    except OSError as e:
        log_event("ERROR", "Could not write state file", e)


def find_session_transcript(session_id: str) -> str:
    """Search all project folders for a matching session JSONL file. A locked or
    unreadable file is logged and skipped rather than aborting the whole search —
    the transcript may still be actively appended to by the live session."""
    try:
        project_folders = list(CLAUDE_PROJECTS_DIR.iterdir())
    except OSError as e:
        log_event("ERROR", f"Could not list {CLAUDE_PROJECTS_DIR}", e)
        return ""

    for project_folder in project_folders:
        if not project_folder.is_dir():
            continue
        try:
            jsonl_files = list(project_folder.glob("*.jsonl"))
        except OSError as e:
            log_event("WARNING", f"Could not list {project_folder}", e)
            continue
        for jsonl_file in jsonl_files:
            if session_id in jsonl_file.stem:
                try:
                    return jsonl_file.read_text(encoding="utf-8")
                except OSError as e:
                    log_event("WARNING", f"Could not read transcript {jsonl_file} (may be locked by the active session)", e)
                    return ""
    return ""


# Real Claude Code transcript lines nest the actual turn under "message":
# {"type": "user"|"assistant"|..., "message": {"role": ..., "content": ...}, ...}
# Top-level lines with no "message" (queue-operation, attachment, etc.) are skipped.
def extract_content_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type", "")
            if block_type == "text":
                parts.append(block.get("text", ""))
            elif block_type == "tool_use":
                parts.append(f"[tool_use:{block.get('name', '')}] {json.dumps(block.get('input', {}))[:300]}")
            elif block_type == "tool_result":
                inner = block.get("content", "")
                if isinstance(inner, list):
                    inner = " ".join(
                        b.get("text", "") for b in inner if isinstance(b, dict) and b.get("type") == "text"
                    )
                marker = "[tool_result:ERROR]" if block.get("is_error") else "[tool_result]"
                parts.append(f"{marker} {str(inner)[:500]}")
        return " ".join(p for p in parts if p)
    return ""


def parse_transcript(raw: str) -> str:
    lines = []
    for line in raw.strip().splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue  # transcripts can contain partial/truncated lines mid-write; skip, don't abort
        if not isinstance(entry, dict):
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        role = message.get("role", "")
        content = extract_content_text(message.get("content", ""))
        if role and content:
            lines.append(f"{role.upper()}: {content[:2000]}")
    return "\n\n".join(lines)


def parse_transcript_bounded(raw_lines: list, max_chars: int) -> tuple:
    """Same parsing as parse_transcript, but processes raw_lines IN ORDER and
    stops once the accumulated text would exceed max_chars. Returns
    (joined_text, raw_lines_consumed) — the caller advances the cursor by
    exactly raw_lines_consumed, never more, so content that got capped out of
    this call is picked up on the NEXT run instead of being silently marked
    'processed' without ever reaching the LLM. Oldest-first (not most-recent)
    on purpose: this only kicks in when a single new batch is huge (an
    already-large backlog on first run, or one giant turn), and processing it
    in order — catching up over a few more turns if needed — never drops
    anything. A recency-biased cutoff would."""
    entries = []
    total_len = 0
    lines_consumed = 0
    for line in raw_lines:
        lines_consumed += 1
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict):
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        role = message.get("role", "")
        content = extract_content_text(message.get("content", ""))
        if not (role and content):
            continue
        piece = f"{role.upper()}: {content[:2000]}"
        if entries and total_len + len(piece) + 2 > max_chars:
            lines_consumed -= 1  # don't count this line — its content wasn't included
            break
        entries.append(piece)
        total_len += len(piece) + 2
    return "\n\n".join(entries), lines_consumed


def as_list(value) -> list:
    """Defensive shape guard: the LLM's JSON is well-formed but not guaranteed to
    match the requested schema exactly — a category could come back as a dict,
    string, or missing entirely."""
    return value if isinstance(value, list) else []


def write_note(folder: str, title: str, content: str, tags: list, date_str: str, time_str: str, project_name: str, session_id: str) -> bool:
    """Writes one note file. Returns True on success; a failure is logged and
    returns False so the caller can skip that item and keep going rather than
    losing every other insight in the batch."""
    try:
        safe_title = re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '-') or "untitled"
        filepath = VAULT_PATH / folder / f"{date_str}-{safe_title}.md"
        tag_str = " ".join(f"#{t}" for t in tags) if tags else ""
        frontmatter = f"""---
date: {date_str}
time: {time_str}
project: {project_name}
session: {session_id[:8]}
tags: [{", ".join(tags)}]
---

"""
        VAULT_PATH.mkdir(parents=True, exist_ok=True)
        (VAULT_PATH / folder).mkdir(exist_ok=True)
        filepath.write_text(frontmatter + content + f"\n\n{tag_str}", encoding="utf-8")
        return True
    except OSError as e:
        log_event("ERROR", f"Could not write note '{title}' to {folder}", e)
        return False


def update_index() -> None:
    """Regenerates Index.md. A failure here is logged but non-fatal — the
    individual notes are already written by this point."""
    try:
        sections = {}
        for folder in ["Patterns", "Mistakes", "Decisions", "Context"]:
            folder_path = VAULT_PATH / folder
            if folder_path.exists():
                files = sorted(folder_path.glob("*.md"), reverse=True)
                sections[folder] = [f"- [[{f.stem}]]" for f in files[:20]]

        index_content = f"# Claude Code Memory Index\n\n*Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n\n"
        for section, links in sections.items():
            index_content += f"## {section}\n\n" + "\n".join(links) + "\n\n"

        (VAULT_PATH / "Index.md").write_text(index_content, encoding="utf-8")
    except OSError as e:
        log_event("ERROR", "Could not regenerate Index.md", e)


def main() -> None:
    try:
        hook_input = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        log_event("ERROR", "Could not parse hook stdin as JSON", e)
        return

    if not isinstance(hook_input, dict):
        log_event("ERROR", f"Hook stdin was not a JSON object: {type(hook_input).__name__}")
        return

    session_id = hook_input.get("session_id", "")
    project_dir = hook_input.get("cwd", "")

    if not session_id:
        return  # nothing to key the transcript search on — silently nothing to do

    raw_transcript = find_session_transcript(session_id)
    if not raw_transcript:
        log_event("INFO", f"No transcript found for session {session_id[:8]} — nothing to extract")
        return

    # --- Incremental cursor: only process what's new since the last run ---
    # Previously this always sliced transcript_text[:12000] — the FIRST 12k
    # chars of the whole transcript. Once a session grew past that, every
    # later Stop-hook run (one per turn) kept re-sending that same stale
    # opening slice forever, so anything said later in a long session —
    # including explicit "remember X" instructions — was silently never
    # seen by the extraction call at all. Tracking a per-session line cursor
    # fixes both the missed-content bug and the wasted repeat API calls.
    raw_lines = raw_transcript.strip().splitlines()
    total_lines = len(raw_lines)

    state = load_state()
    last_processed = state.get(session_id, 0)
    new_lines = raw_lines[last_processed:]

    if not new_lines:
        log_event("INFO", f"No new transcript content for session {session_id[:8]} since last run ({total_lines} lines already processed)")
        return

    # Bounded, in-order parse: only claims (via lines_consumed) exactly what
    # was actually included in transcript_slice, so the cursor never advances
    # past content that was capped out and never sent to the LLM.
    transcript_slice, lines_consumed = parse_transcript_bounded(new_lines, MAX_NEW_CONTENT_CHARS)
    if len(transcript_slice) < 100:
        # Too little NEW content to be worth an LLM call yet. Cursor is
        # deliberately NOT advanced here — this small fragment gets merged
        # with whatever comes next turn instead of being silently dropped.
        return

    extraction_prompt = f"""You are analyzing the NEWEST portion of an ongoing Claude Code session transcript
(everything since the last time it was checked) to extract reusable knowledge.

NEW TRANSCRIPT CONTENT:
{transcript_slice}

Extract structured insights in this exact JSON format:
{{
  "patterns": [
    {{"title": "short title", "description": "what the pattern is", "code_snippet": "optional example", "tags": ["tag1"]}}
  ],
  "mistakes": [
    {{"title": "short title", "error": "what went wrong", "fix": "how it was resolved", "tags": ["tag1"]}}
  ],
  "decisions": [
    {{"title": "short title", "decision": "what was decided", "reasoning": "why", "tags": ["tag1"]}}
  ],
  "context": [
    {{"title": "short title", "detail": "project-specific info", "tags": ["tag1"]}}
  ],
  "session_summary": "2-3 sentence summary of what happened in just this new portion"
}}

Only include items that are genuinely reusable or important — EXCEPT: any time the user explicitly
says something like "remember X", "note that X", "for future reference X", or gives an explicit
correction/clarification about how something works, ALWAYS include it as a Context or Decision
item verbatim, even if it seems minor. Explicit instructions to remember something must never be
silently dropped. Return valid JSON only."""

    insights_raw = call_claude(extraction_prompt)
    if not insights_raw:
        return  # call_claude already logged the specific failure reason; cursor NOT advanced, retried next turn

    insights_raw = re.sub(r"```(?:json)?\n?", "", insights_raw).strip()

    try:
        insights = json.loads(insights_raw)
    except json.JSONDecodeError as e:
        log_event("ERROR", f"Could not parse insights JSON from claude: {insights_raw[:300]}", e)
        return

    if not isinstance(insights, dict):
        log_event("ERROR", f"Insights JSON was not an object: {type(insights).__name__}")
        return

    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H%M")          # compact, used in filenames
    time_str_full = now.strftime("%H:%M:%S")  # readable, used in frontmatter
    project_name = Path(project_dir).name or "unknown"
    written_counts = {"Patterns": 0, "Mistakes": 0, "Decisions": 0, "Context": 0}

    for item in as_list(insights.get("patterns")):
        if not isinstance(item, dict):
            continue
        title = item.get("title", "Untitled Pattern")
        description = item.get("description", "")
        snippet = f"\n\n```\n{item.get('code_snippet', '')}\n```" if item.get("code_snippet") else ""
        if write_note("Patterns", title, f"## {title}\n\n{description}{snippet}",
                       as_list(item.get("tags")) + ["pattern"], date_str, time_str_full, project_name, session_id):
            written_counts["Patterns"] += 1

    for item in as_list(insights.get("mistakes")):
        if not isinstance(item, dict):
            continue
        title = item.get("title", "Untitled Mistake")
        error = item.get("error", "")
        fix = item.get("fix", "")
        if write_note("Mistakes", title, f"## {title}\n\n**Error:** {error}\n\n**Fix:** {fix}",
                       as_list(item.get("tags")) + ["mistake"], date_str, time_str_full, project_name, session_id):
            written_counts["Mistakes"] += 1

    for item in as_list(insights.get("decisions")):
        if not isinstance(item, dict):
            continue
        title = item.get("title", "Untitled Decision")
        decision = item.get("decision", "")
        reasoning = item.get("reasoning", "")
        if write_note("Decisions", title, f"## {title}\n\n**Decision:** {decision}\n\n**Reasoning:** {reasoning}",
                       as_list(item.get("tags")) + ["decision"], date_str, time_str_full, project_name, session_id):
            written_counts["Decisions"] += 1

    for item in as_list(insights.get("context")):
        if not isinstance(item, dict):
            continue
        title = item.get("title", "Untitled Context")
        detail = item.get("detail", "")
        if write_note("Context", title, f"## {title}\n\n{detail}",
                       as_list(item.get("tags")) + ["context"], date_str, time_str_full, project_name, session_id):
            written_counts["Context"] += 1

    try:
        (VAULT_PATH / "Sessions").mkdir(parents=True, exist_ok=True)
        session_note_path = VAULT_PATH / "Sessions" / f"{date_str}-{time_str}-{project_name}.md"
        session_note_path.write_text(
            f"---\ndate: {date_str}\ntime: {time_str_full}\nproject: {project_name}\nsession: {session_id[:8]}\n---\n\n"
            f"## Session Summary\n\n{insights.get('session_summary', 'No summary generated.')}\n",
            encoding="utf-8"
        )
    except OSError as e:
        log_event("ERROR", "Could not write session note", e)

    update_index()

    # Only now — after a successful, fully-processed extraction pass — advance
    # the cursor past EXACTLY what was consumed (lines_consumed), not all the
    # way to total_lines. If this batch got capped by MAX_NEW_CONTENT_CHARS,
    # the remainder is still ahead of the cursor and gets picked up next run
    # instead of being silently marked "processed" without ever being sent.
    new_cursor = last_processed + lines_consumed
    state[session_id] = new_cursor
    save_state(state)

    log_event(
        "INFO",
        f"Session {session_id[:8]} processed lines {last_processed}-{new_cursor} of {total_lines}: "
        + ", ".join(f"{v} {k}" for k, v in written_counts.items())
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Last-resort net: a hook must never crash Claude Code or leave a
        # traceback in the session, no matter what bug slipped past everything
        # above. Log it and exit clean.
        log_event("ERROR", "Unhandled exception in memory_extractor", e)
    sys.exit(0)
