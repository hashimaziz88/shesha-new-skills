# Security & Safety Guards

Read this file before any operation that touches files, DLLs, git, or URLs.
Every guard below is mandatory — not a suggestion.

---

## GUARD 1 — Source file reading (.cs files)

### Secret detection
Before extracting structure from any `.cs` file, scan each line for patterns
that indicate hardcoded secrets:

```
patterns to detect:
- ConnectionString = "..."
- Password = "..."
- ApiKey = "..."
- Secret = "..."
- Token = "..."  (when assigned a literal string value)
- private key / BEGIN RSA / BEGIN CERTIFICATE blocks
- any string literal matching: [A-Za-z0-9+/]{40,} (long base64-like values)
```

**When a secret is found:**
1. DO NOT include the value anywhere in the wiki output
2. Record only: file name, line number, variable name
3. Add a `## Security Findings` section to the wiki with this table:

```markdown
## Security Findings

> [!WARNING]
> The following items contain hardcoded values that should be moved to
> environment variables or Azure Key Vault before this wiki is published.

| File | Line | Variable | Recommendation |
|------|------|----------|----------------|
| `src/Startup.cs` | 42 | `ConnectionString` | Move to appsettings / Key Vault |
```

Never reproduce the actual value — show the variable name only.

### Path boundary guard
Before reading any file, resolve its absolute path and check whether it is
inside the repository root (the directory the user identified as their project).

**If the resolved path is outside the repo root:**
- Stop immediately
- Tell the user: "That path is outside the project root at `{root}`. Do you
  want me to continue anyway, or would you like to provide a different path?"
- Wait for explicit confirmation before proceeding
- Never silently read files outside the repo root

---

## GUARD 2 — DLL path and SheshaExplorer

### Path validation in scaffold-explorer.sh
Before executing, the script must:

```bash
# 1. Resolve the absolute path
RESOLVED=$(realpath "$DLL_PATH" 2>/dev/null)

# 2. Check it exists
if [ ! -d "$RESOLVED" ]; then
  echo "ERROR: DLL path does not exist: $RESOLVED"
  exit 1
fi

# 3. Check it is inside the project directory
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
if [[ "$RESOLVED" != "$PROJECT_ROOT"* ]]; then
  echo "WARNING: DLL path '$RESOLVED' is outside the project root '$PROJECT_ROOT'."
  echo "This may reflect system or third-party assemblies unrelated to your project."
  read -p "Continue anyway? (y/N): " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

# 4. Only process .dll files in the immediate folder (not recursive)
DLL_FILES=("$RESOLVED"/*.dll)
if [ ${#DLL_FILES[@]} -eq 0 ] || [ ! -f "${DLL_FILES[0]}" ]; then
  echo "ERROR: No .dll files found in $RESOLVED"
  echo "Suggestion: run 'dotnet build --configuration Release' first, then retry."
  exit 1
fi
```

### DLL load failure handling
If a DLL fails to load during reflection (locked, corrupt, wrong .NET version):

1. Stop the reflection run immediately
2. Report clearly:
   ```
   Failed to load: {filename}
   Reason: {error message}
   ```
3. Suggest the appropriate fallback menu option:
   - If the file is locked → "The project may still be running. Stop it and retry,
     or choose Option 4 → Read source files directly instead."
   - If wrong .NET version → "This DLL targets a different runtime. Choose
     Option 4 → Read source files directly instead."
   - If corrupt → "Choose Option 5 → Auto-discover existing docs, which doesn't
     require compiled assemblies."

Never partially process a DLL set — if one fails, stop and explain rather than
producing an incomplete graph silently.

---

## GUARD 3 — ADO Wiki git push (Option 4B / 4C)

### PAT token handling
PAT tokens must NEVER appear in the conversation or wiki output.

**If the user pastes anything matching a PAT token pattern into chat:**
- Pattern: `[a-z0-9]{52}` or strings containing `vstfs` or `azdo` or 
  any string the user labels as "token", "PAT", or "password"
- Immediately respond:
  ```
  Stop — that looks like a PAT token. Never paste credentials into chat.
  They may be logged or visible to others.

  If you already pasted it here, rotate it immediately at:
  https://dev.azure.com/{org}/_usersSettings/tokens

  To authenticate for git operations, set the token as an environment
  variable instead:
    export AZURE_DEVOPS_PAT="{your token}"
  Then use it in the git URL:
    git clone https://{your-email}:$AZURE_DEVOPS_PAT@dev.azure.com/...
  ```
- Do not proceed with any git operation until the user confirms they have
  rotated the token if it was pasted.

### URL validation
Before any git clone or push, validate the remote URL matches:
```
https://dev.azure.com/{org}/{project}/_git/{project}.wiki
```

**If the URL does not match this pattern:**
- Do not attempt the git operation
- Tell the user:
  ```
  That URL doesn't look like an Azure DevOps wiki repo.
  Expected format: https://dev.azure.com/{org}/{project}/_git/{project}.wiki

  Would you like to:
  A) Re-enter the correct ADO wiki URL
  B) Save the wiki as a local .md file instead — you can upload it manually
  ```
- Wait for their choice. Never push to an unrecognised URL.

### Pre-push confirmation
Before any `git push`, show the full command and wait for explicit approval:

```
Ready to publish. Here is exactly what will run:

  cd /tmp/{project}.wiki
  git add "{Page-Name}.md"
  git commit -m "docs: wiki update {date} via /wiki-generator"
  git push origin wikiMaster

Target: https://dev.azure.com/{org}/{project}/_git/{project}.wiki
Branch: wikiMaster
Page:   {Page-Name}

Type YES to proceed, or anything else to cancel.
```

Only proceed if the user types "YES" (case-insensitive). Any other input cancels.
Never treat the original menu selection as confirmation for a destructive write.

---

## GUARD 4 — Inspect sub-skill URL fetching

Only fetch URLs matching `https://dev.azure.com/` exactly.

**If the user provides any other URL:**
- Do not fetch it
- Tell the user:
  ```
  I can only fetch wiki pages directly from Azure DevOps
  (dev.azure.com). For any other source, please paste the
  wiki content directly into the chat instead.
  ```

---

## GUARD 5 — Zero source material fallback

**This is NOT a refusal condition.**

If Option 4 is triggered with no DLLs, no .cs files, no README, and no
/understand output, the skill falls back to book-driven documentation:

1. Tell the user clearly what is happening:
   ```
   No source material found. I'll generate the wiki structure using
   the documentation philosophy principles from references/book-principles.md.
   The result will be a well-structured, accurately framed wiki with
   Coverage Gaps declared for every section that needs real code analysis.
   This is a valid starting point — the principles ensure the structure
   and framing are correct even without source.
   ```

2. Read `references/book-principles.md` fully before generating anything

3. Generate every section with:
   - Correct structure per the philosophy principles
   - Learning objective as the opening sentence
   - WHO/WHAT/WHEN/WHERE/WHY answered where answerable from context
   - `> [!NOTE]` Coverage Gap callout in every section that needs source data

4. The resulting wiki is NOT a stub — it is a correctly-principled document
   that a developer can fill in incrementally. The book principles guarantee
   the framing, tone, audience ordering, and section structure are production
   quality regardless of source availability.

---

## GUARD CHECKLIST — run before every operation

Before reading files:
- [ ] Path is inside repo root, or user explicitly confirmed otherwise
- [ ] Secret scan will run before any content is extracted
- [ ] Variable names only — never secret values — in any output

Before running SheshaExplorer:
- [ ] DLL path validated and inside project root (or confirmed)
- [ ] Only .dll files in immediate folder, not recursive into system dirs
- [ ] Failure handling ready — stop + suggest fallback, not silent skip

Before any git push:
- [ ] URL matches dev.azure.com pattern exactly
- [ ] Full command shown to user and "YES" received
- [ ] No PAT token visible in conversation

Before inspect URL fetch:
- [ ] URL is dev.azure.com — refuse anything else

On zero source material:
- [ ] Do NOT refuse — fall back to book-principles.md driven generation
- [ ] Declare coverage gaps explicitly per section

---

## GUARD 5 — Azure DevOps MCP Server validation and write protocol

This guard governs Option E — writing directly to ADO Wiki via a connected
MCP server. Follow every step in order. Do not skip steps even if the user
asks to proceed faster.

---

### Step 1 — Confirm MCP server is connected and healthy

Before attempting any write, validate the connection:

```
1. Check that an Azure DevOps MCP server tool is available in the current session
2. Call the server's identity/ping endpoint or equivalent health check
3. If no ADO MCP server is connected:
   - Tell the user: "No Azure DevOps MCP server is connected.
     To use Option E, connect the ADO MCP server in your Claude settings.
     Falling back to Option B (git) or Option D (manual paste)."
   - Offer Options B, C, D as alternatives
   - Do NOT proceed with Option E
4. If the server responds with an auth error:
   - Tell the user: "The ADO MCP server returned an authentication error.
     Your token may have expired or the server may need to be reconnected.
     Go to Claude settings → Connected apps → Azure DevOps → Reconnect."
   - Do NOT attempt to write
5. If the server is healthy: proceed to Step 2
```

---

### Step 2 — Resolve and validate the target wiki

Before writing, confirm the exact destination:

```
Required information (ask if not already known):
  - Organisation name:  {org}  (e.g. "boxfusion")
  - Project name:       {project}  (e.g. "PD-Epm")
  - Wiki name:          {project}.wiki  (default) or a named wiki
  - Page path:          /{Repo-Name}  (e.g. "/Boxfusion-Epm")
  - Page title:         {display title shown in ADO Wiki}

Validation calls to make via MCP:
  1. List wikis for the project → confirm the target wiki exists
     If it does not exist:
       "Wiki '{project}.wiki' does not exist for project '{project}'.
        Should I create a new project wiki, or did you mean a different wiki name?"
       Wait for confirmation before creating.
  2. Check if the target page already exists
     If it EXISTS:
       "Page '/{page-path}' already exists in {wiki}.
        This will OVERWRITE the existing content.
        Current page last modified: {date if available}
        Confirm overwrite? (YES to proceed, NO to save as a new page with a different name)"
       Only proceed on explicit YES.
     If it does NOT exist:
       "Page '/{page-path}' does not exist — it will be created as a new page."
       Proceed without further confirmation.
```

---

### Step 3 — Pre-write confirmation

Show the user exactly what will happen before executing:

```
Ready to publish via Azure DevOps MCP.

  Organisation : {org}
  Project      : {project}
  Wiki         : {wiki-name}
  Page path    : /{page-path}
  Page title   : {title}
  Action       : {CREATE new page / OVERWRITE existing page}
  Content size : ~{N} lines

Type YES to publish, or anything else to cancel.
```

Wait for explicit YES. Do not interpret ambiguous responses as confirmation.

---

### Step 4 — Execute the write

```
1. Call the MCP server write/upsert endpoint with:
   - wiki identifier
   - page path
   - page title
   - content (the full wiki Markdown generated in this session)
   - commit message: "docs: wiki update {YYYY-MM-DD} via /wiki-generator"

2. Capture the response:
   - On SUCCESS: record the page URL returned by the server
   - On FAILURE: record the full error message
```

---

### Step 5 — Confirm success or handle failure

**On SUCCESS:**
```
✅ Wiki page published successfully.

  URL: {page-url returned by MCP}

The page is now live in Azure DevOps Wiki.
If you need to update it again, re-run /wiki-generator and choose Option E.
```

**On FAILURE — permission error:**
```
The MCP server returned a permission error: {error message}

This usually means your ADO account does not have write access to
'{project}' wiki, or the MCP server token lacks the 'Wiki (Read & Write)'
scope. Ask your ADO administrator to grant wiki write permissions, then retry.
```

**On FAILURE — conflict (page modified externally):**
```
The write was rejected because the page was modified after you started
this session. To avoid overwriting those changes:
  1. Open the current page: {wiki-url}
  2. Merge any changes manually
  3. Re-run Option E to overwrite with the merged version
```

**On FAILURE — any other error:**
```
The MCP write failed: {error message}

Fallback options:
  B — git push (manual): git clone the wiki repo and push the .md file
  D — manual paste: copy the wiki artifact and paste into ADO Wiki UI
  
The generated wiki content is still available as the artifact above.
```

---

### MCP guard checklist

Run before every Option E operation:

- [ ] MCP server confirmed connected and healthy (Step 1)
- [ ] Target wiki confirmed to exist (Step 2)
- [ ] Page existence checked — overwrite confirmed if page exists (Step 2)
- [ ] Full pre-write summary shown and YES received (Step 3)
- [ ] Write executed and response captured (Step 4)
- [ ] Success confirmed with URL, or failure handled with fallback (Step 5)
- [ ] PAT token never appeared in conversation at any point
- [ ] Wiki content reviewed as in-chat artifact BEFORE write was executed

---

### MCP server URL patterns for Azure DevOps

When checking if an ADO MCP server is connected, look for tools with names or
descriptions matching any of these patterns:

```
azure-devops
ado-mcp
azdo
microsoft/azure-devops-mcp
dev.azure.com
```

If the connected MCP server name is unclear, ask the user:
"Which MCP server should I use to write to Azure DevOps? I can see: {list connected servers}"
