"""
Exports patient visit sequences from care.db into a training-ready JSON file.
Combines Synthea + Framingham patients. Each patient becomes one sequence
of visits, each visit holding whatever vitals were recorded that day.
Run this locally, then upload the resulting JSON to Google Colab for
LSTM training (Day 2, Step 3).
"""
import json
import sqlite3
from pathlib import Path
from collections import defaultdict

DB_PATH = Path(__file__).parent / "care.db"
OUT_PATH = Path(__file__).parent / "data" / "export_for_training.json"

VITAL_TYPES = [
    "systolic_bp", "diastolic_bp", "total_cholesterol",
    "hdl_cholesterol", "bmi", "heart_rate", "glucose", "egfr",
]

def export():
    conn = sqlite3.connect(DB_PATH)

    patients = conn.execute(
        "SELECT patient_id, source, dob_estimated, sex, condition FROM patients"
    ).fetchall()

    output = []
    total_visits_included = 0

    for patient_id, source, dob, sex, condition in patients:
        visits = conn.execute(
            "SELECT visit_id, visit_timestamp FROM visits "
            "WHERE patient_id = ? ORDER BY visit_timestamp ASC",
            (patient_id,),
        ).fetchall()

        if len(visits) < 2:
            continue  # need at least 2 visits to form a sequence

        visit_seq = []
        for visit_id, timestamp in visits:
            vt_rows = conn.execute(
                "SELECT type, value FROM vitals WHERE visit_id = ?",
                (visit_id,),
            ).fetchall()
            vt_dict = {t: v for t, v in vt_rows}

            if not vt_dict:
                continue  # skip visits with no recorded vitals at all

            visit_seq.append({
                "visit_timestamp": timestamp,
                **{v: vt_dict.get(v) for v in VITAL_TYPES},
            })

        if len(visit_seq) < 2:
            continue

        output.append({
            "patient_id": patient_id,
            "source": source,
            "dob_estimated": dob,
            "sex": sex,
            "condition": condition,
            "visits": visit_seq,
        })
        total_visits_included += len(visit_seq)

    conn.close()

    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, indent=2))

    print(f"Exported {len(output)} patients with {total_visits_included} "
          f"total visits to {OUT_PATH}")

if __name__ == "__main__":
    export()