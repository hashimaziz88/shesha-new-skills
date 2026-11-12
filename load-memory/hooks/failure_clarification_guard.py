#!/usr/bin/env python3
import json
import sys
import re
import subprocess
import tempfile
import traceback
from datetime import datetime
from pathlib import Path

# --- Configuration ---
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
LOG_PATH = Path.home() / ".claude" / "hook-logs" / "failure_clarification_guard.log"

CHECK_WINDOW = 20              # how many recent transcript lines to inspect
FAILURE_KEYWORD_THRESHOLD = 2  # min failure-signal hits in the window to consider "struggling"
REPEAT_TOOL_THRESHOLD = 3      # same tool called back-to-back this many times = probable retry loop

FAILURE_PATTERNS = [
    r"\berror\b", r"\bfailed\b", r"\btraceback\b", r"\bexception\b",
    r"\bdenied\b", r"\bnot found\b", r"\bENOENT\b", r"\bcannot\b",
    r"\bunable to\b", r"\brefused\b", r"\btimed out\b",
]
FAILURE_RE = re.compile("|".join(FAILURE_PATTERNS), re.IGNORECASE)

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


def find_session_transcript(session_id: str, given_path: str) -> str:
    """Prefer the path the hook gave us; fall back to searching by session_id.
    A locked or unreadable file is logged and treated as 'not found' rather than
    raising — the transcript may be actively appended to by the live session."""
    if given_path:
        try:
            p = Path(given_path)
            if p.exists():
                return p.read_text(encoding="utf-8")
        except OSError as e:
            log_event("WARNING", f"Could not read transcript_path {given_path}, falling back to search", e)

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
                    log_event("WARNING", f"Could not read transcript {jsonl_file}", e)
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


def parse_recent(raw: str, window: int) -> list:
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
            lines.append((role, content[:1000]))
    return lines[-window:]


def count_trailing_repeats(lines: list, current_tool: str) -> int:
    count = 1  # the call about to happen counts as one
    for role, content in reversed(lines):
        if role == "assistant" and current_tool.lower() in content.lower():
            count += 1
        else:
            break
    return count


def ask_popup(question: str) -> str:
    """Windows-native input box via PowerShell (no extra Python deps required).
    The question is written to a UTF-8 temp file and read back by PowerShell,
    rather than interpolated into the -Command string — LLM-generated text can
    contain em dashes, curly quotes, etc. that corrupt a hand-quoted PowerShell
    string (seen in testing: an em dash broke quoting and errored the popup).
    Every failure mode is logged and treated as 'no answer given' — the caller
    already falls back to a safe 'treat as unresolved' message in that case."""
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write(question)
            question_file = f.name
    except OSError as e:
        log_event("ERROR", "Could not write popup question to temp file", e)
        return ""

    ps_command = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Add-Type -AssemblyName Microsoft.VisualBasic; "
        f"$q = Get-Content -Raw -Encoding UTF8 -Path '{question_file}'; "
        "[Microsoft.VisualBasic.Interaction]::InputBox($q, 'Claude Code needs guidance', '')"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_command],
            capture_output=True, text=True, encoding="utf-8", timeout=300
        )
    except FileNotFoundError:
        log_event("ERROR", "powershell not found on PATH — cannot show clarification popup")
        return ""
    except subprocess.TimeoutExpired:
        log_event("WARNING", "Clarification popup timed out after 300s with no response")
        return ""
    except Exception as e:
        log_event("ERROR", "Unexpected error showing clarification popup", e)
        return ""
    finally:
        try:
            Path(question_file).unlink(missing_ok=True)
        except OSError:
            pass

    if result.returncode != 0:
        log_event("WARNING", f"powershell popup exited {result.returncode}: {result.stderr[:300]}")
        return ""

    return result.stdout.strip()


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
    transcript_path = hook_input.get("transcript_path", "")
    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if not session_id or not tool_name:
        return  # not enough to act on — allow silently

    raw_transcript = find_session_transcript(session_id, transcript_path)
    if not raw_transcript:
        return  # nothing to check against — allow silently, already logged if it was an error

    recent = parse_recent(raw_transcript, CHECK_WINDOW)
    if not recent:
        return

    recent_text = "\n\n".join(f"{role.upper()}: {content}" for role, content in recent)

    keyword_hits = len(FAILURE_RE.findall(recent_text))
    repeat_count = count_trailing_repeats(recent, tool_name)
    triggered = keyword_hits >= FAILURE_KEYWORD_THRESHOLD or repeat_count >= REPEAT_TOOL_THRESHOLD

    if not triggered:
        return  # nothing suspicious — allow the tool call silently, no log noise

    log_event("INFO", f"Triggered before '{tool_name}': {keyword_hits} keyword hits, {repeat_count} repeats")

    judgment_prompt = f"""You are monitoring a Claude Code agent for signs it is stuck, repeatedly
failing, or about to take a risky action without enough information.

RECENT TRANSCRIPT (most recent {len(recent)} turns):
{recent_text}

PENDING TOOL CALL:
tool: {tool_name}
input: {json.dumps(tool_input)[:1000]}

Decide if a human should be interrupted right now for clarification before this tool runs.
Respond with ONLY valid JSON in this exact format:
{{"needs_clarification": true/false, "question": "one short, specific question for the human, or empty string"}}"""

    judgment_raw = call_claude(judgment_prompt)
    if not judgment_raw:
        return  # fail open — a broken judgment call must never block the user's work

    judgment_raw = re.sub(r"```(?:json)?\n?", "", judgment_raw).strip()

    try:
        judgment = json.loads(judgment_raw)
    except json.JSONDecodeError as e:
        log_event("ERROR", f"Could not parse judgment JSON from claude: {judgment_raw[:300]}", e)
        return  # fail open

    if not isinstance(judgment, dict) or not judgment.get("needs_clarification"):
        return

    question = judgment.get("question") or "Claude appears to be stuck. How should it proceed?"

    answer = ask_popup(question)

    if not answer:
        reason = (
            f"Paused before running '{tool_name}': {question} "
            "(no response was given in the clarification popup — treat as unresolved, do not proceed blindly)."
        )
    else:
        reason = f"Paused before running '{tool_name}': {question} User's answer: {answer}"

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Last-resort net: this hook fires on EVERY tool call, so a bug here must
        # never be able to block the user's entire session. Log it, print no
        # deny decision (Claude Code treats silent exit as "allow"), and move on.
        log_event("ERROR", "Unhandled exception in failure_clarification_guard", e)
    sys.exit(0)
