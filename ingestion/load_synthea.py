"""
Loads Synthea-generated FHIR bundles into care.db.

Synthea writes one JSON file per patient into output/fhir/*.json.
Copy those files into data/synthea_output/ before running this.

This is your PRIMARY source of true multi-visit longitudinal data —
Framingham (load_framingham.py) is single-snapshot and only supplements it.
"""
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "care.db"
SYNTHEA_DIR = Path(__file__).parent.parent / "data" / "synthea_output"

LOINC_MAP = {
    "8480-6":  ("systolic_bp", "mmHg"),
    "8462-4":  ("diastolic_bp", "mmHg"),
    "2093-3":  ("total_cholesterol", "mg/dL"),
    "2085-9":  ("hdl_cholesterol", "mg/dL"),
    "39156-5": ("bmi", "kg/m2"),
    "8867-4":  ("heart_rate", "bpm"),
    "2339-0":  ("glucose", "mg/dL"),   # glucose, most common Synthea code
    "2345-7":  ("glucose", "mg/dL"),   # glucose, alternate code some panels use
}

def parse_bundle(bundle: dict):
    """Returns (patient_row, [visit_rows], [vital_rows]) from one FHIR Bundle."""
    patient_row = None
    encounters = {}
    vitals = []

    entries = bundle.get("entry", [])
    resources = [e["resource"] for e in entries if "resource" in e]

    for res in resources:
        rtype = res.get("resourceType")
        if rtype == "Patient":
            patient_row = {
                "patient_id": res["id"],
                "source": "synthea",
                "dob_estimated": res.get("birthDate"),
                "sex": res.get("gender"),
                "condition": "cardiovascular",
            }
        elif rtype == "Encounter":
            period = res.get("period", {})
            encounters[res["id"]] = {
                "visit_id": res["id"],
               "patient_id": res["subject"]["reference"].split("/")[-1].replace("urn:uuid:", ""),
                "visit_timestamp": period.get("start"),
            }

    for res in resources:
        if res.get("resourceType") != "Observation":
            continue
        encounter_ref = res.get("encounter", {}).get("reference")
        if not encounter_ref:
            continue
        visit_id = encounter_ref.split("/")[-1].replace("urn:uuid:", "")

        candidates = []
        codings = res.get("code", {}).get("coding", [])
        loinc = next((c["code"] for c in codings if c.get("system", "").endswith("loinc.org")), None)
        if loinc and res.get("valueQuantity"):
            candidates.append((loinc, res["valueQuantity"]))

        for comp in res.get("component", []):
            comp_codings = comp.get("code", {}).get("coding", [])
            comp_loinc = next((c["code"] for c in comp_codings if c.get("system", "").endswith("loinc.org")), None)
            if comp_loinc and comp.get("valueQuantity"):
                candidates.append((comp_loinc, comp["valueQuantity"]))

        for loinc_code, value_q in candidates:
            if loinc_code not in LOINC_MAP:
                continue
            vital_type, unit = LOINC_MAP[loinc_code]
            vitals.append({
                "visit_id": visit_id,
                "type": vital_type,
                "value": value_q.get("value"),
                "unit": value_q.get("unit", unit),
            })

    return patient_row, list(encounters.values()), vitals

def load_all():
    if not SYNTHEA_DIR.exists() or not any(SYNTHEA_DIR.glob("*.json")):
        print(f"No Synthea JSON files found in {SYNTHEA_DIR}. "
              f"Run Synthea first and copy output/fhir/*.json here.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    n_patients = n_visits = n_vitals = 0

    for file in SYNTHEA_DIR.glob("*.json"):
        bundle = json.loads(file.read_text(encoding="utf-8"))
        patient_row, visit_rows, vital_rows = parse_bundle(bundle)

        if not patient_row:
            continue

        cur.execute(
            "INSERT OR IGNORE INTO patients (patient_id, source, dob_estimated, sex, condition) "
            "VALUES (?, ?, ?, ?, ?)",
            (patient_row["patient_id"], patient_row["source"],
             patient_row["dob_estimated"], patient_row["sex"], patient_row["condition"]),
        )
        n_patients += 1

        for v in visit_rows:
            cur.execute(
                "INSERT OR IGNORE INTO visits (visit_id, patient_id, visit_timestamp) VALUES (?, ?, ?)",
                (v["visit_id"], v["patient_id"], v["visit_timestamp"]),
            )
            n_visits += 1

        for vt in vital_rows:
            cur.execute(
                "INSERT INTO vitals (visit_id, type, value, unit) VALUES (?, ?, ?, ?)",
                (vt["visit_id"], vt["type"], vt["value"], vt["unit"]),
            )
            n_vitals += 1

    conn.commit()
    conn.close()
    print(f"Loaded {n_patients} patients, {n_visits} visits, {n_vitals} vitals from Synthea.")

if __name__ == "__main__":
    load_all()