#!/usr/bin/env python3
"""UserPromptSubmit hook: before Claude processes a new prompt, searches the
Obsidian memory vault (built by memory_extractor.py) for related prior notes
and injects a banner saying whether this looks new or already-seen — both to
the user (systemMessage) and into Claude's own context (additionalContext),
so the answer can actually reference what was found.

Two-stage design, same shape as failure_clarification_guard.py:
  1. Cheap local keyword-overlap prefilter (no API call) — if literally
     nothing overlaps, it's genuinely new and we say so for free.
  2. Only when there's some overlap, one claude -p call judges whether it's
     actually the same topic (keyword overlap alone is too noisy to trust)
     and writes a one-line summary.
"""
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
SEARCH_FOLDERS = ["Patterns", "Mistakes", "Decisions", "Context", "Sessions"]
LOG_PATH = Path.home() / ".claude" / "hook-logs" / "memory_context_checker.log"

MAX_CANDIDATES = 5      # cap how many candidate notes get sent to the LLM judgment call
EXCERPT_CHARS = 300     # how much of each candidate note's body to send

NEW_TERRITORY_BANNER = "🆕 New territory — no related memory found for this prompt."
NEW_TERRITORY_CONTEXT = (
    "MEMORY CHECK RESULT: not seen before.\n"
    "RESPONSE FORMAT — do this before anything else in your reply, every turn:\n"
    "1. First line, bold: **Have I seen this before in my memory? No**\n"
    "2. Then answer the user's actual request directly — no recall section needed."
)

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "to", "in", "on",
    "for", "with", "is", "are", "was", "were", "be", "been", "being", "this", "that",
    "these", "those", "it", "its", "as", "at", "by", "from", "into", "about", "than",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them", "their",
    "do", "does", "did", "can", "could", "should", "would", "will", "shall", "may",
    "might", "must", "not", "no", "yes", "please", "just", "also", "up", "out", "all",
    "any", "some", "have", "has", "had", "what", "when", "where", "which", "who", "how",
}

# Headless invocation of the local `claude` CLI — reuses the existing
# Claude Code login/subscription instead of a separate ANTHROPIC_API_KEY.
# Same fixed system prompt/flags as the other two hooks, on purpose: they all
# share Claude Code's 1-hour prompt cache, so repeated calls across hooks in
# the same session/hour are cheap cache hits, not fresh cold starts.
CLAUDE_BIN = "claude"
def resolve_model(key: str, default: str) -> str:
    """Model for this hook, read at runtime from memory_config.json ->
    models[key], so swapping models is a config edit, not a code edit.
    Falls back to `default` on any missing/invalid config."""
    try:
        cfg = json.loads((Path.home() / ".claude" / "hooks" / "memory_config.json").read_text(encoding="utf-8"))
        value = str(((cfg or {}).get("models") or {}).get(key, "")).strip()
        return value or default
    except (OSError, ValueError, TypeError, AttributeError):
        return default


CLAUDE_MODEL = resolve_model("checker", "claude-haiku-5-5")
FALLBACK_MODEL = resolve_model("fallback", "claude-haiku-5-5")
# The CLI rejects a fallback identical to the main model, so only pass it when they differ.
FALLBACK_ARGS = ["--fallback-model", FALLBACK_MODEL] if FALLBACK_MODEL != CLAUDE_MODEL else []
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
                "--model", CLAUDE_MODEL, *FALLBACK_ARGS,
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


def tokenize(text: str) -> set:
    """Lowercase, strip punctuation, drop stopwords and short tokens."""
    words = re.findall(r"[a-zA-Z0-9']+", text.lower())
    return {w for w in words if len(w) >= 3 and w not in STOPWORDS}


def extract_title(content: str, filepath: Path) -> str:
    match = re.search(r"^##\s+(.+)$", content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    # fall back to the filename with the leading date stripped and dashes turned to spaces
    stem = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", filepath.stem)
    return stem.replace("-", " ")


def extract_tags(content: str) -> list:
    match = re.search(r"^tags:\s*\[(.*?)\]\s*$", content, re.MULTILINE)
    if not match:
        return []
    return [t.strip() for t in match.group(1).split(",") if t.strip()]


def strip_frontmatter(content: str) -> str:
    """Removes the leading '---\\n...\\n---' YAML block. Plain string split
    instead of a DOTALL regex — a lazy '.*?' across a whole file body is the
    kind of pattern that can backtrack badly on pathological input."""
    if not content.startswith("---"):
        return content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return content
    return parts[2].lstrip()


def load_vault_notes() -> list:
    """Loads every note across SEARCH_FOLDERS into {folder, title, tags, excerpt,
    keywords}. A missing vault or unreadable file is logged and skipped/empty
    rather than raising."""
    notes = []
    if not VAULT_PATH.exists():
        return notes

    for folder in SEARCH_FOLDERS:
        folder_path = VAULT_PATH / folder
        if not folder_path.exists():
            continue
        try:
            md_files = list(folder_path.glob("*.md"))
        except OSError as e:
            log_event("WARNING", f"Could not list {folder_path}", e)
            continue

        for filepath in md_files:
            try:
                content = filepath.read_text(encoding="utf-8")
            except OSError as e:
                log_event("WARNING", f"Could not read {filepath}", e)
                continue

            title = extract_title(content, filepath)
            tags = extract_tags(content)
            excerpt = strip_frontmatter(content).strip()[:EXCERPT_CHARS]
            keywords = tokenize(title) | {t.lower() for t in tags} | tokenize(excerpt)

            notes.append({
                "folder": folder,
                "title": title,
                "tags": tags,
                "excerpt": excerpt,
                "keywords": keywords,
            })
    return notes


def score_notes(prompt_keywords: set, notes: list) -> list:
    scored = []
    for note in notes:
        overlap = len(prompt_keywords & note["keywords"])
        if overlap > 0:
            scored.append((overlap, note))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [note for _, note in scored[:MAX_CANDIDATES]]


def emit(banner: str, context: str) -> None:
    """banner: short human-facing line shown above the response.
    context: the fuller instruction fed into Claude's own context — this is
    what actually drives the response format, re-injected fresh every turn so
    it can't be forgotten partway through a long session."""
    print(json.dumps({
        "systemMessage": banner,
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context
        }
    }))


def read_prompt_from_stdin() -> str:
    """Returns the submitted prompt text, or '' if stdin is missing/malformed/empty."""
    try:
        hook_input = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        log_event("ERROR", "Could not parse hook stdin as JSON", e)
        return ""

    if not isinstance(hook_input, dict):
        log_event("ERROR", f"Hook stdin was not a JSON object: {type(hook_input).__name__}")
        return ""

    prompt_text = hook_input.get("prompt") or hook_input.get("message") or ""
    return prompt_text if isinstance(prompt_text, str) else ""


def build_judgment_prompt(prompt_text: str, candidates: list) -> str:
    candidate_text = "\n\n".join(
        f"[{c['folder']}] {c['title']} (tags: {', '.join(c['tags']) or 'none'})\n{c['excerpt']}"
        for c in candidates
    )
    return f"""You are checking whether a new request is substantially the same topic as any
prior memory note, to help an AI coding assistant recall relevant history before responding.

NEW PROMPT:
{prompt_text[:1000]}

CANDIDATE PRIOR MEMORY NOTES (found by keyword overlap, may or may not actually be related):
{candidate_text}

Decide if the new prompt is substantially about the same topic/question/task as one or more
candidate notes (not just superficial word overlap). If it is, extract what actually happened
last time (what was tried, what broke, what the fix or decision was) and turn that into a
concrete instruction for how to use it this time — not just "this was seen before" but the
actual prior approach/fix restated as something actionable right now.
Respond with ONLY valid JSON in this exact format:
{{"seen_before": true/false, "what_happened": "what was done/tried and what the outcome or fix was last time, in 1-3 sentences — empty string if seen_before is false", "how_to_apply": "a concrete instruction for what to do differently or reuse this time, in 1-2 sentences — empty string if seen_before is false", "related_titles": ["title of each genuinely related note"]}}"""


def get_judgment(prompt_text: str, candidates: list) -> dict:
    """Returns the parsed judgment dict, or None on any failure (already logged)."""
    judgment_raw = call_claude(build_judgment_prompt(prompt_text, candidates))
    if not judgment_raw:
        return None  # fail open — a broken judgment call must never block the user's prompt

    judgment_raw = re.sub(r"```(?:json)?\n?", "", judgment_raw).strip()

    try:
        judgment = json.loads(judgment_raw)
    except json.JSONDecodeError as e:
        log_event("ERROR", f"Could not parse judgment JSON from claude: {judgment_raw[:300]}", e)
        return None

    if not isinstance(judgment, dict):
        log_event("ERROR", f"Judgment JSON was not an object: {type(judgment).__name__}")
        return None

    return judgment


def build_output(judgment: dict, prompt_text: str) -> tuple:
    """Returns (banner, context). banner is the short systemMessage line.
    context is the fuller additionalContext — it carries an explicit
    instruction for how the response must open, so the format holds even if
    it was only agreed verbally earlier in a long session and would otherwise
    be forgotten."""
    seen_before = bool(judgment.get("seen_before"))
    log_event("INFO", f"seen_before={str(seen_before).lower()} for prompt starting '{prompt_text[:60]}'")

    if not seen_before:
        return NEW_TERRITORY_BANNER, NEW_TERRITORY_CONTEXT

    related = judgment.get("related_titles")
    related_str = ", ".join(related) if isinstance(related, list) and related else "none named"
    what_happened = judgment.get("what_happened") or "related prior work found"
    how_to_apply = judgment.get("how_to_apply") or ""

    banner = f"🔁 Seen before — {what_happened}"
    if how_to_apply:
        banner += f" | Apply: {how_to_apply}"

    context = (
        "MEMORY CHECK RESULT: seen before.\n"
        f"What happened last time: {what_happened}\n"
        f"How to apply it now: {how_to_apply or 'use your judgment based on what happened last time'}\n"
        f"Related notes: {related_str}\n"
        "RESPONSE FORMAT — do this before anything else in your reply, every turn:\n"
        "1. First line, bold: **Have I seen this before in my memory? Yes**\n"
        "2. Then a short description, five lines or fewer, covering: what it was, what happened,\n"
        "   and how it was fixed/decided — drawn from 'What happened last time' and 'Related notes' above.\n"
        "3. Then answer the user's actual request, actually applying 'How to apply it now' above —\n"
        "   don't just mention the memory, use it."
    )
    return banner, context


def main() -> None:
    prompt_text = read_prompt_from_stdin()
    if not prompt_text.strip():
        return  # nothing to check against — allow silently

    notes = load_vault_notes()
    if not notes:
        return  # vault empty or missing — nothing to compare against, stay silent rather than spam "new" forever

    prompt_keywords = tokenize(prompt_text)
    if not prompt_keywords:
        return

    candidates = score_notes(prompt_keywords, notes)
    if not candidates:
        emit(NEW_TERRITORY_BANNER, NEW_TERRITORY_CONTEXT)
        return

    judgment = get_judgment(prompt_text, candidates)
    if judgment is None:
        return

    banner, context = build_output(judgment, prompt_text)
    emit(banner, context)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Last-resort net: this hook fires on EVERY prompt, so a bug here must
        # never be able to block the user from talking to Claude at all.
        log_event("ERROR", "Unhandled exception in memory_context_checker", e)
    sys.exit(0)
