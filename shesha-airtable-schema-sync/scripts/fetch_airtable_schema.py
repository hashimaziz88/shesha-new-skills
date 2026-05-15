#!/usr/bin/env python3
"""
Fetches Airtable base schema and writes normalized JSON to airtable-schema.json.
Usage: python fetch_airtable_schema.py [config.json]
Default config path: airtable-sync.json
"""
import json, sys, urllib.request, urllib.error

SKIP_TYPES = {
    "formula", "rollup", "lookup", "count",
    "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy",
    "autoNumber", "externalSyncSource", "button",
}

def fetch_json(url, pat):
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {pat}", "User-Agent": "shesha-airtable-schema-sync/1.0"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[ERROR] HTTP {e.code} from Airtable: {body}", file=sys.stderr)
        sys.exit(1)

def to_pascal(s):
    """Convert any string to PascalCase."""
    return "".join(w.capitalize() for w in s.replace("-", " ").replace("_", " ").split())

def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else "airtable-sync.json"
    try:
        with open(config_path) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        print(f"[ERROR] Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    pat = cfg.get("airtable_pat", "")
    base_id = cfg.get("airtable_base_id", "")
    if not pat or not base_id:
        print("[ERROR] airtable_pat and airtable_base_id are required in config.", file=sys.stderr)
        sys.exit(1)

    raw = fetch_json(f"https://api.airtable.com/v0/meta/bases/{base_id}/tables", pat)

    # Build id -> table lookup for resolving linked record names
    table_index = {t["id"]: t["name"] for t in raw.get("tables", [])}

    result = {"base_id": base_id, "tables": []}

    for table in raw.get("tables", []):
        tbl = {
            "id": table["id"],
            "name": table["name"],
            "class_name": to_pascal(table["name"]),
            "fields": [],
        }

        for field in table.get("fields", []):
            ftype = field["type"]
            if ftype in SKIP_TYPES:
                continue

            opts = field.get("options", {})
            linked_table_id = opts.get("linkedTableId")
            linked_table_name = table_index.get(linked_table_id) if linked_table_id else None

            entry = {
                "id": field["id"],
                "name": field["name"],
                "type": ftype,
            }

            if ftype in ("singleRecordLink", "multipleRecordLinks"):
                entry["linked_table_id"] = linked_table_id
                entry["linked_table_name"] = linked_table_name
                entry["linked_class_name"] = to_pascal(linked_table_name) if linked_table_name else None
                entry["prefers_single"] = opts.get("prefersSingleRecordLink", False)

            if ftype in ("singleSelect", "multipleSelects"):
                entry["choices"] = [c["name"] for c in opts.get("choices", [])]

            if ftype == "number":
                entry["precision"] = opts.get("precision", 1)

            if ftype == "currency":
                entry["currency_symbol"] = opts.get("symbol", "$")

            if ftype == "rating":
                entry["max"] = opts.get("max", 5)

            tbl["fields"].append(entry)

        result["tables"].append(tbl)

    # Post-process: annotate linked fields with inverse field info
    # This helps determine one-to-many vs many-to-many cardinality
    field_index = {}  # (table_id, field_id) -> field info
    for tbl in result["tables"]:
        for f in tbl["fields"]:
            field_index[(tbl["id"], f["id"])] = f

    for tbl in result["tables"]:
        for f in tbl["fields"]:
            if f["type"] not in ("singleRecordLink", "multipleRecordLinks"):
                continue
            # Find inverse field in linked table
            linked_id = f.get("linked_table_id")
            if not linked_id:
                continue
            linked_tbl = next((t for t in result["tables"] if t["id"] == linked_id), None)
            if not linked_tbl:
                continue
            # Find field in linked_tbl that links back to this table
            inverse = next(
                (lf for lf in linked_tbl["fields"]
                 if lf["type"] in ("singleRecordLink", "multipleRecordLinks")
                 and lf.get("linked_table_id") == tbl["id"]),
                None,
            )
            f["inverse_field_type"] = inverse["type"] if inverse else None
            f["inverse_field_name"] = inverse["name"] if inverse else None

    out = json.dumps(result, indent=2)
    out_path = "airtable-schema.json"
    with open(out_path, "w") as f:
        f.write(out)

    print(out)
    print(f"\n[OK] Schema written to {out_path} — {len(result['tables'])} tables", file=sys.stderr)


if __name__ == "__main__":
    main()
