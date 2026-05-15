#!/usr/bin/env python3
"""
Phase 3 & 4: Execute Airtable → Shesha migration and generate balancing report.

Two-pass strategy:
  Pass 1 – Insert all records with simple fields + direct FK refs (Airtable ID → Shesha ID map saved per run)
  Pass 2 – Create junction entity records for M:M relationships

Reconcile mode (--reconcile):
  Updates already-migrated records with fields that may have been missed or added
  since the initial migration. Does NOT re-create junctions (only updates scalar fields).

State is stored in migration-state/ for restartability:
  id-map.json             – Airtable record ID → Shesha GUID (skip already-inserted records)
  {base-name}/
    balancing-report.md   – source vs target counts + error log (folder per base)

Run: python migrate.py [--config migration.config.json] [--map path/to/entity-map.json]
                       [--dry-run] [--table TABLE] [--reconcile]

Zero Data Loss Policy:
  Every field mapped in entity-map.json MUST reach Shesha. Fields are only added to
  skip_fields_by_table when they have NO corresponding entity property AND adding one
  is not feasible (e.g., reverse-link fields, attachment blobs).
  When new entity properties are added post-migration, run --reconcile to back-fill them.
"""

import json, sys, os, re, time, argparse
from pathlib import Path
from datetime import datetime

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import requests
except ImportError:
    sys.exit("ERROR: 'requests' not installed. Run: pip install requests")

# ── CLI args ──────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--config",    default="migration.config.json")
parser.add_argument("--map",       default=None)
parser.add_argument("--dry-run",   action="store_true", help="Fetch+transform but don't POST to Shesha")
parser.add_argument("--table",     default=None, help="Migrate only one table (for debugging)")
parser.add_argument("--reconcile", action="store_true",
                    help="Update already-migrated records with missing fields (no new records created for those already in id-map)")
parser.add_argument("--report-dir", default=None,
                    help="Override the output folder for reports (default: migration-state/{base-name}/)")
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

os.makedirs("migration-state", exist_ok=True)

ID_MAP_PATH = "migration-state/id-map.json"
id_map = json.load(open(ID_MAP_PATH)) if os.path.exists(ID_MAP_PATH) else {}

errors = []   # {table, record_id, message}
counts = {}   # {table: {source, inserted, skipped, failed, updated, junctions}}

def save_id_map():
    with open(ID_MAP_PATH, "w") as f:
        json.dump(id_map, f, indent=2)

# ── Airtable helpers ──────────────────────────────────────────────────────────
AT_HDRS = {"Authorization": f"Bearer {PAT}"}

def at_fetch_all(table_id_or_name: str) -> list:
    """Fetch all records from an Airtable table (handles pagination)."""
    records = []
    params  = {"pageSize": 100}
    while True:
        r = requests.get(
            f"https://api.airtable.com/v0/{BASE}/{requests.utils.quote(table_id_or_name)}",
            headers=AT_HDRS, params=params
        )
        r.raise_for_status()
        data = r.json()
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
        params["offset"] = offset
        time.sleep(0.25)  # Airtable rate limit: 5 req/sec
    return records

def at_schema() -> dict:
    r = requests.get(f"https://api.airtable.com/v0/meta/bases/{BASE}/tables", headers=AT_HDRS)
    r.raise_for_status()
    return {t["name"]: t for t in r.json()["tables"]}

# ── Shesha helpers ────────────────────────────────────────────────────────────
sh_session = requests.Session()
sh_token   = None

def sh_login():
    global sh_token
    r = sh_session.post(f"{SH_URL}/api/TokenAuth/Authenticate",
                        json={"userNameOrEmailAddress": SH_USER, "password": SH_PASS})
    r.raise_for_status()
    sh_token = r.json()["result"]["accessToken"]
    sh_session.headers.update({"Authorization": f"Bearer {sh_token}"})
    print("Authenticated to Shesha")

def sh_create(entity: str, payload: dict) -> str | None:
    """POST to Shesha CRUD Create. Returns the new Shesha ID."""
    if args.dry_run:
        print(f"  [DRY-RUN] Would create {entity}: {list(payload.keys())}")
        return f"dry-run-{entity}-{id(payload)}"
    r = sh_session.post(f"{SH_URL}/api/dynamic/{MOD}/{entity}/Crud/Create", json=payload)
    if r.ok:
        data = r.json()
        if data.get("success"):
            return data.get("result", {}).get("id")
        errors.append({"entity": entity, "message": data.get("error", {}).get("message", "Unknown"), "payload": str(payload)[:200]})
    else:
        errors.append({"entity": entity, "status": r.status_code, "message": r.text[:300], "payload": str(payload)[:200]})
    return None

def sh_update(entity: str, shesha_id: str, payload: dict) -> bool:
    """PUT to Shesha CRUD Update."""
    if args.dry_run:
        print(f"  [DRY-RUN] Would update {entity} {shesha_id}: {list(payload.keys())}")
        return True
    payload["id"] = shesha_id
    r = sh_session.put(f"{SH_URL}/api/dynamic/{MOD}/{entity}/Crud/Update", json=payload)
    if r.ok and r.json().get("success"):
        return True
    errors.append({"entity": entity, "id": shesha_id, "message": r.text[:300]})
    return False

# ── Field transformation ──────────────────────────────────────────────────────
SKIP_TYPES = set(entity_map.get("skip_field_types", []))

def resolve_enum(value: str | None, enum_ref: str) -> int | None:
    if value is None:
        return None
    mapping = enum_map.get(enum_ref, {})
    return mapping.get(value)

def transform_simple_fields(at_fields: dict, tdef: dict) -> dict:
    """Build Shesha payload from simple (non-link) Airtable fields."""
    payload = {}
    for at_name, fdef in tdef.get("fields", {}).items():
        val = at_fields.get(at_name)
        if val is None:
            continue
        t = fdef["type"]
        if t == "text":
            payload[fdef["shesha"]] = str(val) if val else None
        elif t == "number":
            payload[fdef["shesha"]] = val
        elif t == "bool":
            payload[fdef["shesha"]] = bool(val)
        elif t == "date":
            payload[fdef["shesha"]] = val[:10] if val else None
        elif t == "enum":
            int_val = resolve_enum(val, fdef["enum_ref"])
            if int_val is not None:
                payload[fdef["shesha"]] = int_val
        elif t == "multiselect_enum":
            # Airtable multi-select is a list of strings; combine into a bitmask
            items = val if isinstance(val, list) else [val]
            mapping = enum_map.get(fdef.get("enum_ref", ""), {})
            bitmask = 0
            for item in items:
                item_val = mapping.get(item)
                if item_val is not None:
                    bitmask |= item_val
            if bitmask > 0:
                payload[fdef["shesha"]] = bitmask
        elif t == "multiselect_text":
            # Airtable multipleSelects is a list of strings; join as comma-separated
            items = val if isinstance(val, list) else [val]
            joined = ", ".join(str(i) for i in items if i)
            if joined:
                payload[fdef["shesha"]] = joined[:500]
    return payload

def resolve_fk(at_record_ids: list) -> str | None:
    """Resolve the first Airtable record ID link to a Shesha GUID."""
    if not at_record_ids:
        return None
    return id_map.get(at_record_ids[0])

def transform_fk_fields(at_fields: dict, tdef: dict) -> dict:
    """Add FK reference objects to payload."""
    payload = {}
    for at_name, fkdef in tdef.get("fk_fields", {}).items():
        links = at_fields.get(at_name)
        if not links:
            continue
        shesha_id = resolve_fk(links)
        if shesha_id:
            payload[fkdef["shesha"]] = {"id": shesha_id}
    return payload

# ── Main migration ────────────────────────────────────────────────────────────
def migrate_table(table_name: str, tdef: dict, base_project_id: str, at_records: list):
    entity   = tdef["entity"]
    tcount   = {"source": len(at_records), "inserted": 0, "skipped": 0, "failed": 0, "updated": 0}

    for rec in at_records:
        at_id     = rec["id"]
        at_fields = {k.strip(): v for k, v in rec.get("fields", {}).items()}

        already_migrated = at_id in id_map

        if already_migrated and not args.reconcile:
            tcount["skipped"] += 1
            continue

        # Build payload
        payload = transform_simple_fields(at_fields, tdef)
        payload.update(transform_fk_fields(at_fields, tdef))

        if already_migrated and args.reconcile:
            # UPDATE existing record with current field set
            shesha_id = id_map[at_id]
            if sh_update(entity, shesha_id, payload):
                tcount["updated"] += 1
            else:
                tcount["failed"] += 1
            continue

        # New record — CREATE
        payload["baseProject"] = {"id": base_project_id}

        entity_has_name = any(f.get("shesha") == "name" for f in tdef.get("fields", {}).values())
        if entity_has_name and "name" not in payload:
            name_field = tdef.get("name_field")
            name_val = (at_fields.get(name_field) if name_field else None) or at_fields.get("Name") or f"[Unnamed {entity}]"
            payload["name"] = str(name_val)[:200]
        if entity == "ProjectsDefinition" and "name" not in payload:
            payload["name"] = payload.get("projectCode", "[Unnamed Project]")[:200]

        shesha_id = sh_create(entity, payload)
        if shesha_id:
            id_map[at_id] = shesha_id
            tcount["inserted"] += 1
        else:
            tcount["failed"] += 1

    save_id_map()
    updated_note = f", {tcount['updated']} updated" if args.reconcile else ""
    print(f"  {table_name} → {entity}: {tcount['inserted']} inserted, {tcount['skipped']} skipped, "
          f"{tcount['failed']} failed{updated_note} (of {tcount['source']} source records)")
    return tcount

def migrate_junctions(table_name: str, tdef: dict, at_records: list):
    """Pass 2: create junction entity records for M:M fields.
    In reconcile mode, only processes records NOT already in id-map (new records only)
    to avoid creating duplicate junctions for existing records.
    """
    j_counts = {}
    for at_name, mmdef in tdef.get("mm_fields", {}).items():
        junction   = mmdef["junction"]
        j_this_key = mmdef["j_this"]
        j_other_key= mmdef["j_other"]
        target_table = mmdef["target_table"]
        inserted = failed = 0

        for rec in at_records:
            at_id   = rec["id"]

            # In reconcile mode, skip junction creation for already-existing records
            # (junctions were already created; re-creating would cause duplicates)
            if args.reconcile and at_id in id_map:
                continue

            this_sh = id_map.get(at_id)
            if not this_sh:
                continue
            linked_ids = {k.strip(): v for k, v in rec.get("fields", {}).items()}.get(at_name, [])
            for linked_at_id in linked_ids:
                other_sh = id_map.get(linked_at_id)
                if not other_sh:
                    continue
                junc_payload = {
                    j_this_key:  {"id": this_sh},
                    j_other_key: {"id": other_sh}
                }
                sh_id = sh_create(junction, junc_payload)
                if sh_id:
                    inserted += 1
                else:
                    failed += 1

        j_counts[at_name] = {"inserted": inserted, "failed": failed}
        if inserted or failed:
            print(f"    {table_name}.{at_name} → {junction}: {inserted} links created, {failed} failed")

    return j_counts

# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    sh_login()

    at_schema_map = at_schema()

    base_name = requests.get(f"https://api.airtable.com/v0/meta/bases/{BASE}", headers=AT_HDRS).json().get("name", BASE)
    bp_at_key = f"BASE_{BASE}"

    if bp_at_key not in id_map:
        print(f"\nCreating BaseProject: '{base_name}'")
        bp_id = sh_create("BaseProject", {
            "name":          base_name,
            "airtableBaseId": BASE,
            "isActive":      True
        })
        if not bp_id:
            sys.exit("ERROR: Failed to create BaseProject — cannot continue")
        id_map[bp_at_key] = bp_id
        save_id_map()
    base_project_id = id_map[bp_at_key]
    print(f"BaseProject ID: {base_project_id}")

    if args.reconcile:
        print("\n⚡ RECONCILE MODE — updating existing records with missing fields")

    order = entity_map["migration_order"]
    if args.table:
        order = [args.table]

    all_records = {}
    print("\n── Fetching Airtable data ──")
    for table_name in order:
        if table_name not in at_schema_map:
            print(f"  SKIP: '{table_name}' not in this base")
            continue
        print(f"  Fetching {table_name}...")
        all_records[table_name] = at_fetch_all(table_name)
        print(f"    {len(all_records[table_name])} records")

    # PASS 1: Simple fields + FKs (create new, or update existing in reconcile mode)
    print(f"\n── Pass 1: {'Reconciling' if args.reconcile else 'Inserting'} records ──")
    for table_name in order:
        if table_name not in all_records:
            continue
        tdef = entity_map["tables"].get(table_name)
        if not tdef:
            print(f"  SKIP: no entity-map entry for '{table_name}'")
            continue
        tc = migrate_table(table_name, tdef, base_project_id, all_records[table_name])
        counts[table_name] = tc

    # PASS 2: M:M junctions (new records only; reconcile mode skips already-migrated)
    print("\n── Pass 2: Creating junction records ──")
    for table_name in order:
        if table_name not in all_records:
            continue
        tdef = entity_map["tables"].get(table_name)
        if not tdef or not tdef.get("mm_fields"):
            continue
        jc = migrate_junctions(table_name, tdef, all_records[table_name])
        counts[table_name]["junctions"] = jc

    # ── Balancing report — saved in migration-state/{base-name}/ ─────────────
    safe_base = re.sub(r"[^\w\s-]", "", base_name)
    safe_base = re.sub(r"\s+", "_", safe_base.strip())
    report_dir = Path(args.report_dir) if args.report_dir else Path("migration-state") / safe_base
    report_dir.mkdir(parents=True, exist_ok=True)

    lines = []
    lines.append("# Migration Balancing Report")
    lines.append(f"**Base:** {base_name} (`{BASE}`)  ")
    lines.append(f"**Run date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    mode_label = "RECONCILE" if args.reconcile else ("DRY RUN" if args.dry_run else "LIVE")
    lines.append(f"**Mode:** {mode_label}\n")

    lines.append("## Record Counts\n")
    if args.reconcile:
        lines.append("| Table | Entity | Source | Updated | New | Failed |")
        lines.append("|---|---|---|---|---|---|")
    else:
        lines.append("| Table | Entity | Source | Inserted | Skipped | Failed |")
        lines.append("|---|---|---|---|---|---|")
    total_src = total_ins = total_fail = 0
    for tname in order:
        if tname not in counts:
            continue
        c    = counts[tname]
        tdef = entity_map["tables"].get(tname, {})
        ent  = tdef.get("entity", "?")
        flag = " ⚠️" if c["failed"] > 0 else ""
        if args.reconcile:
            lines.append(f"| {tname} | {ent} | {c['source']} | {c.get('updated',0)} | {c['inserted']} | {c['failed']}{flag} |")
        else:
            lines.append(f"| {tname} | {ent} | {c['source']} | {c['inserted']} | {c['skipped']} | {c['failed']}{flag} |")
        total_src  += c["source"]
        total_ins  += c["inserted"] + c.get("updated", 0)
        total_fail += c["failed"]

    lines.append(f"| **TOTAL** | | **{total_src}** | **{total_ins}** | | **{total_fail}** |")

    if errors:
        lines.append(f"\n## Errors ({len(errors)})\n")
        for i, e in enumerate(errors[:50], 1):
            lines.append(f"{i}. **{e.get('entity','?')}**: {e.get('message','?')}")
            if "payload" in e:
                lines.append(f"   Payload: `{e['payload']}`")
        if len(errors) > 50:
            lines.append(f"\n... and {len(errors)-50} more errors (see migration-state/errors.json)")
    else:
        lines.append("\n✅ No errors recorded.")

    lines.append("\n## Recommendations")
    if total_fail > 0:
        lines.append(f"- {total_fail} records failed. Check `migration-state/errors.json` and re-run migrate.py "
                     f"(already-inserted records will be skipped, or use --reconcile to update existing ones)")
    if total_ins == total_src and not args.reconcile:
        lines.append(f"- All {total_src} source records successfully migrated")

    report = "\n".join(lines)
    rpath  = report_dir / "balancing-report.md"
    with open(rpath, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"\nBalancing report → {rpath}")

    errors_path = report_dir / "errors.json"
    with open(errors_path, "w") as f:
        json.dump(errors, f, indent=2)

    print(f"\n{'='*50}")
    action = "updated/inserted" if args.reconcile else "inserted"
    print(f"DONE: {total_ins} {action}, {total_fail} failed, {total_src} source records")

if __name__ == "__main__":
    main()
