"""
Loads the Framingham Heart Study CSV (Kaggle) into care.db.

IMPORTANT — be honest with yourself about this dataset: the common Kaggle
version is ONE ROW PER PATIENT (a single baseline exam + a 10-year outcome
flag), not a true visit-over-time sequence. It is NOT a substitute for
Synthea's multi-visit data when training the LSTM trend model.

Use this file for:
  - a much larger, real-world sample to sanity-check your risk model's
    baseline accuracy against a well-known public benchmark
  - validating that your feature ranges (BP, cholesterol, BMI) look
    realistic compared to a real population

Do NOT rely on this alone for the "trend across visits" part of the
Longitudinal Reasoning Engine — that needs Synthea's data.

Expected columns (standard Kaggle Framingham export):
male, age, education, currentSmoker, cigsPerDay, BPMeds, prevalentStroke,
prevalentHyp, diabetes, totChol, sysBP, diaBP, BMI, heartRate, glucose,
TenYearCHD

Download from Kaggle, save as data/framingham.csv, then run this script.
"""
import csv
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "care.db"
CSV_PATH = Path(__file__).parent.parent / "data" / "framingham.csv"

# We fake a single visit_timestamp since the CSV has no dates.
# This keeps the schema consistent — every "visit" needs a timestamp —
# without pretending we have real dates we don't.
PLACEHOLDER_VISIT_DATE = "2020-01-01"

COLUMN_TO_VITAL = {
    "sysBP":     ("systolic_bp", "mmHg"),
    "diaBP":     ("diastolic_bp", "mmHg"),
    "totChol":   ("total_cholesterol", "mg/dL"),
    "BMI":       ("bmi", "kg/m2"),
    "heartRate": ("heart_rate", "bpm"),
    "glucose":   ("glucose", "mg/dL"),
}

def load_all():
    if not CSV_PATH.exists():
        print(f"No file at {CSV_PATH}. Download the Framingham CSV from Kaggle "
              f"and save it there first.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    n_patients = n_vitals = n_skipped = 0

    with open(CSV_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            patient_id = f"fhm_{i}"
            sex = "male" if row.get("male") == "1" else "female"

            cur.execute(
                "INSERT OR IGNORE INTO patients (patient_id, source, dob_estimated, sex, condition) "
                "VALUES (?, ?, ?, ?, ?)",
                (patient_id, "framingham", None, sex, "cardiovascular"),
            )
            n_patients += 1

            visit_id = f"{patient_id}_v0"
            cur.execute(
                "INSERT OR IGNORE INTO visits (visit_id, patient_id, visit_timestamp) VALUES (?, ?, ?)",
                (visit_id, patient_id, PLACEHOLDER_VISIT_DATE),
            )

            for col, (vital_type, unit) in COLUMN_TO_VITAL.items():
                raw = row.get(col, "").strip()
                if not raw:
                    n_skipped += 1
                    continue
                try:
                    value = float(raw)
                except ValueError:
                    n_skipped += 1
                    continue
                cur.execute(
                    "INSERT INTO vitals (visit_id, type, value, unit) VALUES (?, ?, ?, ?)",
                    (visit_id, vital_type, value, unit),
                )
                n_vitals += 1

    conn.commit()
    conn.close()
    print(f"Loaded {n_patients} patients, {n_vitals} vitals from Framingham "
          f"({n_skipped} missing values skipped).")

if __name__ == "__main__":
    load_all()
