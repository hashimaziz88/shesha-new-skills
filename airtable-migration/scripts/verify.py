#!/usr/bin/env python3
"""
Full Data Reconciliation Verifier — checks EVERY record × EVERY mapped field.

For each Airtable record the script:
  1. Confirms the record exists in id-map (coverage check)
  2. Fetches the live Shesha record and compares every mapped field:
       text / number / bool / date  — null-in-Shesha when AT has a value
       enum                         — wrong integer stored
       multiselect_enum             — bitmask is 0 when AT has selections
       multiselect_text             — null/empty when AT has selections
       fk_fields                    — FK object missing when AT has a link

Outputs (all in --report-dir):
  reconciliation-report.md    — human-readable summary + per-field gap tables
  reconciliation-detail.json  — full per-record detail for every table

Run:
  python verify.py [--config migration.config.json] [--report-dir path]
"""

import json, sys, os, re, time, argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import requests
except ImportError:
    sys.exit("ERROR: 'requests' not installed. Run: pip install requests")

parser = argparse.ArgumentParser()
parser.add_argument("--config",     default="migration.config.json")
parser.add_argument("--map",        default=None)
parser.add_argument("--report-dir", default=None)
args = parser.parse_args()

cfg     = json.load(open(args.config))
PAT     = cfg["airtable_pat"]
BASE    = cfg["airtable_base_id"]
SH_URL  = cfg["shesha_url"].rstrip("/")
SH_USER = cfg["shesha_username"]
SH_PASS = cfg["shesha_password"]
MOD     = cfg.get("module_namespace", "Shesha.RequirementsStudio")

script_dir = Path(__file__).parent
map_path   = Path(args.map) if args.map else script_dir.parent / "references" / "entity-map.json"
enum_path  = script_dir.parent / "references" / "enum-map.json"

entity_map = json.load(open(map_path))
enum_map   = json.load(open(enum_path))

ID_MAP_PATH = "migration-state/id-map.json"
id_map = json.load(open(ID_MAP_PATH)) if os.path.exists(ID_MAP_PATH) else {}

# ── Helpers ───────────────────────────────────────────────────────────────────
AT_HDRS = {"Authorization": f"Bearer {PAT}"}

def safe_folder(name):
    s = re.sub(r"[^\w\s-]", "", name)
    return re.sub(r"\s+", "_", s.strip())

def at_fetch_all(table_name):
    records, params = [], {"pageSize": 100}
    while True:
        r = requests.get(
            f"https://api.airtable.com/v0/{BASE}/{requests.utils.quote(table_name)}",
            headers=AT_HDRS, params=params)
        r.raise_for_status()
        data = r.json()
        records.extend(data.get("records", []))
        if not data.get("offset"):
            break
        params["offset"] = data["offset"]
        time.sleep(0.2)
    return records

def at_schema():
    r = requests.get(f"https://api.airtable.com/v0/meta/bases/{BASE}/tables", headers=AT_HDRS)
    r.raise_for_status()
    return {t["name"]: t for t in r.json()["tables"]}

sh_session = requests.Session()

def sh_login():
    r = sh_session.post(f"{SH_URL}/api/TokenAuth/Authenticate",
                        json={"userNameOrEmailAddress": SH_USER, "password": SH_PASS})
    r.raise_for_status()
    sh_session.headers.update({"Authorization": f"Bearer {r.json()['result']['accessToken']}"})
    print("Authenticated to Shesha")

def sh_fetch_all(entity, base_project_id):
    """Fetch ALL Shesha records for an entity belonging to this base, with pagination."""
    items = []
    skip  = 0
    size  = 500
    filt  = json.dumps({"and": [{"==": [{"var": "baseProject.id"}, base_project_id]}]})
    while True:
        r = sh_session.get(
            f"{SH_URL}/api/dynamic/{MOD}/{entity}/Crud/GetAll",
            params={"maxResultCount": size, "skipCount": skip, "filter": filt})
        if not r.ok:
            print(f"    [WARN] GetAll failed for {entity}: {r.status_code}")
            break
        data = r.json()
        if not data.get("success"):
            break
        result = data.get("result", {})
        batch  = result.get("items", result.get("result", []))
        if not batch:
            break
        items.extend(batch)
        total = result.get("totalCount", len(items))
        skip += len(batch)
        if skip >= total:
            break
    return items

def resolve_enum(value, enum_ref):
    return enum_map.get(enum_ref, {}).get(value)

def is_empty(v):
    """True when a Shesha value counts as 'not populated'."""
    if v is None:
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    if isinstance(v, list) and len(v) == 0:
        return True
    return False

# ── Per-table full verification ───────────────────────────────────────────────
def verify_table(table_name, tdef, at_records, sh_by_id):
    """
    Returns a dict with:
      coverage  – records missing from id-map
      field_gaps – {field_name: [list of {at_id, at_val, sh_val, issue}]}
      fk_gaps   – same for FK fields
    """
    entity    = tdef["entity"]
    skip_set  = set(entity_map.get("skip_fields_by_table", {}).get(table_name, []))

    missing_from_map = []
    field_gaps = defaultdict(list)   # at_field_name → list of gap dicts
    fk_gaps    = defaultdict(list)
    records_ok = 0

    for rec in at_records:
        at_id     = rec["id"]
        at_fields = {k.strip(): v for k, v in rec.get("fields", {}).items()}

        if at_id not in id_map:
            missing_from_map.append(at_id)
            continue

        sh_id  = id_map[at_id]
        sh_rec = sh_by_id.get(sh_id)
        if sh_rec is None:
            field_gaps["__fetch_error__"].append({
                "at_id": at_id, "sh_id": sh_id, "issue": "Record not found in Shesha GetAll"
            })
            continue

        records_ok += 1

        # ── Simple fields ──────────────────────────────────────────────────
        for at_name, fdef in tdef.get("fields", {}).items():
            if at_name in skip_set:
                continue
            at_val = at_fields.get(at_name)
            if at_val is None:
                continue  # AT has no value — nothing to check

            sh_key = fdef["shesha"]
            sh_val = sh_rec.get(sh_key)
            ftype  = fdef["type"]

            if ftype in ("text", "number", "date"):
                if is_empty(sh_val):
                    field_gaps[at_name].append({
                        "at_id": at_id,
                        "at_val": str(at_val)[:120],
                        "sh_val": sh_val,
                        "issue":  "Null in Shesha, has value in Airtable"
                    })

            elif ftype == "bool":
                # Only flag if AT=True but Shesha is missing/null (False is legitimate)
                if at_val is True and sh_val is None:
                    field_gaps[at_name].append({
                        "at_id": at_id, "at_val": True, "sh_val": sh_val,
                        "issue": "Bool True in Airtable but null in Shesha"
                    })

            elif ftype == "enum":
                expected = resolve_enum(at_val, fdef.get("enum_ref", ""))
                if expected is not None and sh_val != expected:
                    field_gaps[at_name].append({
                        "at_id": at_id,
                        "at_val": f"{at_val} → {expected}",
                        "sh_val": sh_val,
                        "issue":  "Wrong enum value in Shesha"
                    })

            elif ftype == "multiselect_enum":
                items  = at_val if isinstance(at_val, list) else [at_val]
                mapping = enum_map.get(fdef.get("enum_ref", ""), {})
                expected_bits = 0
                for item in items:
                    v = mapping.get(item)
                    if v:
                        expected_bits |= v
                if expected_bits == 0:
                    continue
                # Shesha may return list of ints or single int
                if isinstance(sh_val, list):
                    actual_bits = sum(sh_val) if sh_val else 0
                else:
                    actual_bits = sh_val or 0
                if actual_bits == 0:
                    field_gaps[at_name].append({
                        "at_id": at_id,
                        "at_val": str(items),
                        "sh_val": sh_val,
                        "issue":  "Multiselect empty in Shesha, has values in Airtable"
                    })

            elif ftype == "multiselect_text":
                items  = at_val if isinstance(at_val, list) else [at_val]
                joined = ", ".join(str(i) for i in items if i)
                if joined and is_empty(sh_val):
                    field_gaps[at_name].append({
                        "at_id": at_id,
                        "at_val": joined[:120],
                        "sh_val": sh_val,
                        "issue":  "Multiselect text null in Shesha, has values in Airtable"
                    })

        # ── FK fields ──────────────────────────────────────────────────────
        for at_name, fkdef in tdef.get("fk_fields", {}).items():
            if at_name in skip_set:
                continue
            links  = at_fields.get(at_name)
            if not links:
                continue  # AT has no link
            sh_key = fkdef["shesha"]
            sh_obj = sh_rec.get(sh_key)
            if is_empty(sh_obj):
                fk_gaps[at_name].append({
                    "at_id":  at_id,
                    "at_val": links[0] if links else "?",
                    "sh_val": sh_obj,
                    "issue":  "FK is null in Shesha but linked in Airtable"
                })

    total_gap_records = len(set(
        g["at_id"]
        for gaps in list(field_gaps.values()) + list(fk_gaps.values())
        for g in gaps
    ))

    return {
        "table":              table_name,
        "entity":             entity,
        "at_count":           len(at_records),
        "mapped_count":       len(at_records) - len(missing_from_map),
        "missing_from_map":   len(missing_from_map),
        "missing_ids":        missing_from_map,
        "sh_fetched":         len(sh_by_id),
        "records_ok":         records_ok,
        "field_gaps":         dict(field_gaps),
        "fk_gaps":            dict(fk_gaps),
        "total_gap_records":  total_gap_records,
        "status":             "COMPLETE" if not missing_from_map and not field_gaps and not fk_gaps else "GAPS",
    }

# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    sh_login()

    at_schema_map = at_schema()
    base_info     = requests.get(f"https://api.airtable.com/v0/meta/bases/{BASE}", headers=AT_HDRS).json()
    base_name     = base_info.get("name", BASE)
    bp_at_key     = f"BASE_{BASE}"
    base_project_id = id_map.get(bp_at_key)
    if not base_project_id:
        sys.exit("ERROR: BaseProject not in id-map. Run migrate.py first.")

    print(f"Base: {base_name}  |  BaseProject: {base_project_id}")

    if args.report_dir:
        report_dir = Path(args.report_dir)
    else:
        report_dir = Path("migration-state") / safe_folder(base_name) / "reconciliation"
    report_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output: {report_dir}\n")

    order   = entity_map["migration_order"]
    results = []

    print("── Fetching all data and verifying every record × every field ──")
    for table_name in order:
        if table_name not in at_schema_map:
            print(f"  SKIP (not in base): {table_name}")
            continue
        tdef = entity_map["tables"].get(table_name)
        if not tdef:
            continue

        entity = tdef["entity"]
        print(f"  {table_name:<20}", end=" ", flush=True)

        # Fetch Airtable records
        at_records = at_fetch_all(table_name)
        print(f"AT:{len(at_records):<4}", end=" ", flush=True)

        if not at_records:
            print("(empty)")
            results.append({
                "table": table_name, "entity": entity,
                "at_count": 0, "mapped_count": 0,
                "missing_from_map": 0, "missing_ids": [],
                "sh_fetched": 0, "records_ok": 0,
                "field_gaps": {}, "fk_gaps": {},
                "total_gap_records": 0, "status": "COMPLETE"
            })
            continue

        # Fetch ALL Shesha records for this entity + base
        sh_items  = sh_fetch_all(entity, base_project_id)
        sh_by_id  = {item["id"]: item for item in sh_items}
        print(f"SH:{len(sh_items):<4}", end=" ", flush=True)

        result = verify_table(table_name, tdef, at_records, sh_by_id)

        icon = "✅" if result["status"] == "COMPLETE" else "❌"
        gap_summary = (f"  gaps: {result['total_gap_records']} records"
                       if result["total_gap_records"] else "")
        print(f"{icon}{gap_summary}")

        results.append(result)

    # ── Build report ──────────────────────────────────────────────────────────
    total_at        = sum(r["at_count"] for r in results)
    total_mapped    = sum(r["mapped_count"] for r in results)
    total_missing   = sum(r["missing_from_map"] for r in results)
    total_gap_recs  = sum(r["total_gap_records"] for r in results)
    all_complete    = total_missing == 0 and total_gap_recs == 0

    lines = []
    lines.append("# Full Data Reconciliation Report — Every Record × Every Field")
    lines.append(f"**Base:** {base_name} (`{BASE}`)  ")
    lines.append(f"**Run date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append(f"**Scope:** All {total_at} records, all mapped fields, all FK links  \n")

    verdict = ("✅ **ALL DATA MIGRATED AND VERIFIED** — zero gaps across all records and fields"
               if all_complete else
               f"❌ **GAPS FOUND** — {total_missing} records missing from migration, "
               f"{total_gap_recs} records with field-level gaps")
    lines.append(f"## Verdict\n\n{verdict}\n")

    # Summary table
    lines.append("## Coverage Summary\n")
    lines.append("| Table | Entity | AT | Migrated | Missing | SH Fetched | Field Gaps | Status |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for r in results:
        icon     = "✅" if r["status"] == "COMPLETE" else "❌"
        gap_note = str(r["total_gap_records"]) + " records" if r["total_gap_records"] else "—"
        lines.append(
            f"| {r['table']} | {r['entity']} | {r['at_count']} | {r['mapped_count']} "
            f"| {r['missing_from_map']} | {r['sh_fetched']} | {gap_note} | {icon} |"
        )
    lines.append(f"| **TOTAL** | | **{total_at}** | **{total_mapped}** | **{total_missing}** | | | |")

    # Per-table field gap details
    gap_tables = [r for r in results if r["field_gaps"] or r["fk_gaps"] or r["missing_ids"]]
    if gap_tables:
        lines.append("\n## Detailed Gaps by Table\n")
        for r in gap_tables:
            lines.append(f"### {r['table']} — {r['entity']}\n")

            if r["missing_ids"]:
                lines.append(f"**{len(r['missing_ids'])} records not in id-map (never migrated):**")
                for aid in r["missing_ids"][:10]:
                    lines.append(f"- `{aid}`")
                if len(r["missing_ids"]) > 10:
                    lines.append(f"- … and {len(r['missing_ids'])-10} more")
                lines.append("")

            all_field_gaps = {**r["field_gaps"], **r["fk_gaps"]}
            if all_field_gaps:
                lines.append(f"**Field-level gaps ({sum(len(v) for v in all_field_gaps.values())} total):**\n")
                lines.append("| Field | Records affected | Sample Airtable value | Sample Shesha value | Issue |")
                lines.append("|---|---|---|---|---|")
                for field_name, gaps in sorted(all_field_gaps.items(), key=lambda x: -len(x[1])):
                    sample = gaps[0]
                    at_v   = str(sample.get("at_val", ""))[:60]
                    sh_v   = str(sample.get("sh_val", ""))[:40]
                    lines.append(f"| `{field_name}` | {len(gaps)} | `{at_v}` | `{sh_v}` | {sample['issue']} |")
                lines.append("")

    if all_complete:
        lines.append("## Summary\n")
        lines.append(f"- All **{total_at}** Airtable records are present in Shesha")
        lines.append(f"- Every mapped field was checked on every record — **zero gaps**")
        lines.append(f"- FK links verified — **zero broken references**")
        lines.append(f"- Migration is **complete and verified** for base `{base_name}`")

    report_text = "\n".join(lines)
    rpath = report_dir / "reconciliation-report.md"
    with open(rpath, "w", encoding="utf-8") as f:
        f.write(report_text)

    # Compact detail JSON (strip large lists for readability)
    detail_out = []
    for r in results:
        entry = {k: v for k, v in r.items() if k != "missing_ids"}
        entry["missing_ids_sample"] = r["missing_ids"][:20]
        detail_out.append(entry)

    dpath = report_dir / "reconciliation-detail.json"
    with open(dpath, "w", encoding="utf-8") as f:
        json.dump(detail_out, f, indent=2, default=str)

    print(f"\nReconciliation report  → {rpath}")
    print(f"Detail JSON            → {dpath}")
    print(f"\n{'='*60}")
    print(f"VERDICT: {'✅ COMPLETE — zero gaps' if all_complete else '❌ GAPS FOUND'}")
    print(f"  {total_at} AT records | {total_mapped} migrated | "
          f"{total_missing} missing | {total_gap_recs} records with field gaps")

if __name__ == "__main__":
    main()
