#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"

DLL_PATH="${1:-}"
NAMESPACE="${2:-}"
DATE_TAG=$(date +%Y-%m-%d)

# ── Locate project root (git root or cwd) ────────────────────────────────────
PROJECT_ROOT=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || pwd)
WIKI_GEN_DIR="$PROJECT_ROOT/wiki-gen"
OUTPUT="${3:-$WIKI_GEN_DIR/graphs/graph-$DATE_TAG.json}"

# ── First run: scaffold wiki-gen/ if it doesn't exist ────────────────────────
if [ ! -d "$WIKI_GEN_DIR" ]; then
  echo "First run — creating wiki-gen/ in $PROJECT_ROOT"
  mkdir -p "$WIKI_GEN_DIR/graphs"
  mkdir -p "$WIKI_GEN_DIR/wikis"
  mkdir -p "$WIKI_GEN_DIR/shesha-explorer/src"

  # Copy memory template
  cp "$SKILL_DIR/references/generator-memory-template.md" "$WIKI_GEN_DIR/memory.md"

  # Copy explorer HTML
  cp "$SKILL_DIR/shesha-explorer/explorer.html" "$WIKI_GEN_DIR/explorer.html"

  # Copy C# source so the developer can rerun independently
  cp -r "$SKILL_DIR/shesha-explorer/src/." "$WIKI_GEN_DIR/shesha-explorer/src/"
  cp "$SCRIPT_DIR/run-explorer.sh" "$WIKI_GEN_DIR/shesha-explorer/run-explorer.sh"

  echo ""
  echo "  wiki-gen/memory.md           — add your domain context here (or run /wiki-generator Option 7)"
  echo "  wiki-gen/graphs/             — graph.json files will be saved here"
  echo "  wiki-gen/wikis/              — generated wiki pages will be saved here"
  echo "  wiki-gen/explorer.html       — open in browser to explore the graph"
  echo "  wiki-gen/shesha-explorer/    — local copy of the explorer source for reruns"
  echo ""
fi

# ── Validate arguments ────────────────────────────────────────────────────────
if [ -z "$DLL_PATH" ]; then
  echo "Usage: bash run-explorer.sh <dll-path> [namespace-prefix] [output-file]"
  echo "Example: bash run-explorer.sh ./bin/Release/net8.0/ Boxfusion"
  echo ""
  echo "Output defaults to: wiki-gen/graphs/graph-$DATE_TAG.json"
  exit 1
fi

if ! command -v dotnet &> /dev/null; then
  echo "ERROR: dotnet not found. Install .NET 8 SDK from https://dotnet.microsoft.com/download"
  exit 1
fi

DOTNET_VER=$(dotnet --version 2>/dev/null | cut -d'.' -f1)
if [ -z "$DOTNET_VER" ] || [ "$DOTNET_VER" -lt 8 ]; then
  echo "ERROR: .NET 8.0+ required. Current: $(dotnet --version)"
  exit 1
fi

if [ ! -d "$DLL_PATH" ]; then
  echo "ERROR: DLL path does not exist: $DLL_PATH"
  echo "Run: dotnet build --configuration Release"
  exit 1
fi

# ── Path boundary check ───────────────────────────────────────────────────────
RESOLVED=$(realpath "$DLL_PATH" 2>/dev/null || echo "$DLL_PATH")
if [[ "$RESOLVED" != "$PROJECT_ROOT"* ]]; then
  echo "WARNING: DLL path '$RESOLVED' is outside the project root '$PROJECT_ROOT'."
  echo "This may reflect system or third-party assemblies."
  read -p "Continue anyway? (y/N): " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "Building SheshaExplorer..."

# Try local copy first, fall back to skill source
if [ -f "$WIKI_GEN_DIR/shesha-explorer/src/SheshaExplorer.csproj" ]; then
  BUILD_SRC="$WIKI_GEN_DIR/shesha-explorer/src"
else
  BUILD_SRC="$SRC_DIR"
fi

cd "$BUILD_SRC"
dotnet build --configuration Release --nologo -v quiet

# ── Run ───────────────────────────────────────────────────────────────────────
echo "Reflecting assemblies..."
mkdir -p "$(dirname "$OUTPUT")"

DOTNET_ARGS=(
  run --configuration Release --no-build --project .
  --
  --dll-path "$DLL_PATH"
  --output "$OUTPUT"
)

[ -n "$NAMESPACE" ] && DOTNET_ARGS+=(--namespace "$NAMESPACE")

dotnet "${DOTNET_ARGS[@]}"

echo ""
echo "Graph written to: $OUTPUT"
echo ""
echo "Next steps:"
echo "  1. Open wiki-gen/explorer.html in your browser and load $OUTPUT"
echo "  2. Tell Claude Code: 'use /wiki-generator Option 3 with the graph in wiki-gen/graphs/'"
