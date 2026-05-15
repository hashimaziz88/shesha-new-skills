#!/usr/bin/env python3
"""
Phase 1: Analyze Airtable schema vs Shesha entity-map.
Outputs: migration-state/{base-name}/mapping-report.md  (human-readable issues)
         migration-state/{base-name}/field-issues.json  (machine-readable for migrate.py)
Run: python analyze.py [--config migration.config.json] [--map path/to/entity-map.json]
"""

import json, sys, os, re, argparse
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    sys.exit("ERROR: 'requests' not installed. Run: pip install requests")

# ── CLI args ──────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--config", default="migration.config.json")
parser.add_argument("--map",    default=None, help="Path to entity-map.json (default: skill references dir)")
args = parser.parse_args()

cfg  = json.load(open(args.config))
PAT  = cfg["airtable_pat"]
BASE = cfg["airtable_base_id"]
MOD  = cfg.get("module_namespace", "Shesha.RequirementsStudio")

# Find entity-map.json relative to this script
script_dir = Path(__file__).parent
map_path   = Path(args.map) if args.map else script_dir.parent / "references" / "entity-map.json"
enum_path  = script_dir.parent / "references" / "enum-map.json"

entity_map = json.load(open(map_path))
enum_map   = json.load(open(enum_path))

os.makedirs("migration-state", exist_ok=True)

def safe_folder(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name)
    return re.sub(r"\s+", "_", s.strip())

# ── Fetch Airtable schema ─────────────────────────────────────────────────────
print("Fetching Airtable schema...")
hdrs = {"Authorization": f"Bearer {PAT}"}
resp = requests.get(f"https://api.airtable.com/v0/meta/bases/{BASE}/tables", headers=hdrs)
resp.raise_for_status()
at_tables = {t["name"]: t for t in resp.json()["tables"]}
print(f"  Found {len(at_tables)} Airtable tables: {', '.join(at_tables.keys())}")

# Fetch base info
base_resp = requests.get(f"https://api.airtable.com/v0/meta/bases/{BASE}", headers=hdrs)
base_name = base_resp.json().get("name", BASE) if base_resp.ok else BASE
print(f"  Base: {base_name} ({BASE})")

# ── Compare schema ────────────────────────────────────────────────────────────
issues   = []   # list of issue dicts
warnings = []   # minor warnings
summary  = []   # per-table summaries

SKIP_TYPES = set(entity_map.get("skip_field_types", []))

def check_table(table_name, tdef):
    """Compare one Airtable table against its entity mapping definition."""
    entity    = tdef["entity"]
    at_table  = at_tables.get(table_name)
    table_issues   = []
    table_warnings = []

    if not at_table:
        issues.append({"table": table_name, "severity": "error",
                       "message": f"Table '{table_name}' not found in Airtable base"})
        return {"table": table_name, "entity": entity, "status": "MISSING", "issues": 1}

    at_fields = {f["name"].strip(): f for f in at_table["fields"]}  # strip whitespace from field names
    skip_by_table = set(entity_map.get("skip_fields_by_table", {}).get(table_name, []))

    mapped_count = 0

    # Check each mapped field
    for at_name, fdef in tdef.get("fields", {}).items():
        if at_name in skip_by_table:
            continue
        if at_name not in at_fields:
            table_issues.append({"table": table_name, "severity": "warning",
                                  "field": at_name, "shesha": fdef["shesha"],
                                  "message": f"Mapped field '{at_name}' not found in this base's schema"})
        else:
            at_f = at_fields[at_name]
            mapped_count += 1

            # Check enum values
            if fdef["type"] == "enum" and at_f["type"] == "singleSelect":
                enum_ref = fdef.get("enum_ref")
                enum_values = enum_map.get(enum_ref, {})
                for choice in at_f.get("options", {}).get("choices", []):
                    v = choice["name"]
                    if v.startswith("_"):
                        continue
                    if v not in enum_values:
                        table_issues.append({
                            "table": table_name, "severity": "error", "field": at_name,
                            "shesha": fdef["shesha"], "enum_ref": enum_ref,
                            "message": f"Airtable option '{v}' not in enum-map['{enum_ref}'] — will become null"
                        })
                    elif enum_values[v] is None:
                        table_warnings.append({
                            "table": table_name, "severity": "warning", "field": at_name,
                            "shesha": fdef["shesha"],
                            "message": f"Option '{v}' maps to null — data will be lost"
                        })

    # Check FK fields
    for at_name, fkdef in tdef.get("fk_fields", {}).items():
        if at_name not in at_fields:
            table_warnings.append({"table": table_name, "severity": "info",
                                    "field": at_name, "shesha": fkdef["shesha"],
                                    "message": f"FK field '{at_name}' not in this base"})
        else:
            mapped_count += 1

    # Check M:M fields
    for at_name, mmdef in tdef.get("mm_fields", {}).items():
        if at_name not in at_fields:
            table_warnings.append({"table": table_name, "severity": "info",
                                    "field": at_name, "shesha": mmdef["shesha"],
                                    "message": f"M:M field '{at_name}' not in this base"})
        else:
            mapped_count += 1

    # Detect unmapped Airtable fields (not in skip lists, not computed)
    all_mapped = (set(tdef.get("fields", {}).keys()) |
                  set(tdef.get("fk_fields", {}).keys()) |
                  set(tdef.get("mm_fields", {}).keys()) |
                  skip_by_table)

    for fname, fobj in at_fields.items():
        if fname in all_mapped:
            continue
        if fobj["type"] in SKIP_TYPES:
            continue
        table_warnings.append({"table": table_name, "severity": "warning",
                                "field": fname, "at_type": fobj["type"],
                                "message": f"Unmapped Airtable field '{fname}' (type: {fobj['type']}) — data will NOT be migrated"})

    issues.extend(table_issues)
    warnings.extend(table_warnings)

    n_issues = len(table_issues)
    n_warn   = len(table_warnings)
    status   = "OK" if n_issues == 0 and n_warn == 0 else ("ISSUES" if n_issues > 0 else "WARNINGS")
    return {
        "table": table_name, "entity": entity, "at_fields": len(at_fields),
        "mapped_fields": mapped_count, "issues": n_issues, "warnings": n_warn, "status": status
    }

# Tables in entity-map but not in Airtable, and vice versa
mapped_tables = set(entity_map["tables"].keys())
at_table_names = set(at_tables.keys())
extra_at = at_table_names - mapped_tables
missing_at = mapped_tables - at_table_names

for tname, tdef in entity_map["tables"].items():
    result = check_table(tname, tdef)
    summary.append(result)

# ── Build report ──────────────────────────────────────────────────────────────
lines = []
lines.append(f"# Airtable → Shesha Migration Analysis")
lines.append(f"**Base:** {base_name} (`{BASE}`)  ")
lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
lines.append(f"**Module:** `{MOD}`\n")

# Summary table
lines.append("## Table Mapping Summary\n")
lines.append("| Airtable Table | Shesha Entity | AT Fields | Mapped | Issues | Warnings | Status |")
lines.append("|---|---|---|---|---|---|---|")
total_issues = total_warnings = 0
for s in summary:
    icon = "✅" if s["status"] == "OK" else ("❌" if s["status"] == "ISSUES" else "⚠️")
    lines.append(f"| {s['table']} | {s['entity']} | {s.get('at_fields','?')} | {s.get('mapped_fields','?')} | {s['issues']} | {s.get('warnings',0)} | {icon} {s['status']} |")
    total_issues   += s["issues"]
    total_warnings += s.get("warnings", 0)

if extra_at:
    lines.append(f"\n**Airtable tables with no entity mapping:** {', '.join(extra_at)}")
if missing_at:
    lines.append(f"\n**Mapped tables not found in base:** {', '.join(missing_at)}")

lines.append(f"\n**Total:** {total_issues} errors, {total_warnings} warnings\n")

# Enum issues
enum_issues = [i for i in issues if "enum_ref" in i]
if enum_issues:
    lines.append("## Enum Value Mismatches\n")
    lines.append("These Airtable select options have no Shesha enum mapping and will be stored as `null`:\n")
    lines.append("| Table | Airtable Field | Option Value | Enum Ref | Recommendation |")
    lines.append("|---|---|---|---|---|")
    seen = set()
    for i in enum_issues:
        val = i["message"].split("'")[1]
        key = (i["table"], i["field"], val)
        if key in seen: continue
        seen.add(key)
        enum_ref = i.get("enum_ref","")
        lines.append(f"| {i['table']} | {i['field']} | `{val}` | `{enum_ref}` | Add to enum or map to closest value |")

# Unmapped field warnings
unmapped = [w for w in warnings if "Unmapped Airtable field" in w["message"]]
if unmapped:
    lines.append("\n## Unmapped Airtable Fields (Data Not Migrated)\n")
    lines.append("| Table | Field | Type | Action Needed |")
    lines.append("|---|---|---|---|")
    for w in unmapped:
        fname = w["field"]
        ftype = w.get("at_type","?")
        action = "Add property to entity" if ftype not in ("formula","multipleLookupValues","autoNumber") else "Skip (computed field)"
        lines.append(f"| {w['table']} | `{fname}` | {ftype} | {action} |")

# Known enum mapping notes
lines.append("\n## Known Mapping Decisions\n")
for ref, vals in enum_map.items():
    if ref.startswith("_"): continue
    note = vals.get("_unmapped_note") or vals.get("_shesha_values")
    if note and "_unmapped_note" in vals:
        lines.append(f"**`{ref}`:** {vals['_unmapped_note']}\n")

lines.append("\n## Next Steps\n")
lines.append("1. Review enum mismatches above and either add new enum values to the C# enums OR accept null storage")
lines.append("2. Review unmapped fields and decide which to add as entity properties (create migration)")
lines.append("3. Once decisions are made, run: `python scripts/migrate.py`")
lines.append(f"4. After migration, review the balancing report in `migration-state/{safe_folder(base_name)}/balancing-report.md`")

report = "\n".join(lines)

# All outputs go into migration-state/{base-name}/
report_dir = Path("migration-state") / safe_folder(base_name)
report_dir.mkdir(parents=True, exist_ok=True)

report_path   = report_dir / "mapping-report.md"
issues_path   = report_dir / "field-issues.json"

with open(report_path, "w", encoding="utf-8") as f:
    f.write(report)
print(f"\nReport written to: {report_path}")

issues_out = {"errors": issues, "warnings": warnings, "summary": summary,
              "base_id": BASE, "base_name": base_name}
with open(issues_path, "w") as f:
    json.dump(issues_out, f, indent=2)
print(f"Issues JSON written to: {issues_path}")
print(f"\nResult: {total_issues} errors, {total_warnings} warnings across {len(summary)} tables")
if total_issues > 0:
    print(f"ACTION REQUIRED: Review {report_path} before running migrate.py")
