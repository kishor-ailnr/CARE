"""
Loads the trained LSTM and predicts a patient's next-visit vitals
(systolic BP, diastolic BP, heart rate, BMI) from their real visit history.
Usage: python predict_vitals.py <patient_id>
"""
import sys
import json
import sqlite3
import numpy as np
from pathlib import Path
from tensorflow.keras.models import load_model

DB_PATH = Path(__file__).parent / "care.db"
MODEL_PATH = Path(__file__).parent / "models" / "bp_lstm_model_v3.keras"
NORM_PATH = Path(__file__).parent / "models" / "norm_constants.json"

def load_patient_sequence(conn, patient_id, vitals_order):
    q = """
        SELECT v.visit_timestamp, vt.type, vt.value
        FROM visits v JOIN vitals vt ON vt.visit_id = v.visit_id
        WHERE v.patient_id = ?
        ORDER BY v.visit_timestamp ASC
    """
    rows = conn.execute(q, (patient_id,)).fetchall()

    # group by visit_timestamp
    by_visit = {}
    for ts, vtype, value in rows:
        by_visit.setdefault(ts, {})[vtype] = value

    sequence = []
    for ts in sorted(by_visit.keys()):
        visit_vitals = by_visit[ts]
        row = [visit_vitals.get(v) for v in vitals_order]
        if any(x is None for x in row):
            continue  # skip visits missing any required vital
        sequence.append(row)

    return sequence

def predict(patient_id):
    with open(NORM_PATH) as f:
        norm = json.load(f)
    vitals_order = norm["vitals_order"]
    vmin = np.array(norm["VITAL_MIN"])
    vmax = np.array(norm["VITAL_MAX"])

    conn = sqlite3.connect(DB_PATH)
    sequence = load_patient_sequence(conn, patient_id, vitals_order)
    conn.close()

    if len(sequence) < 2:
        print(f"Patient {patient_id} doesn't have enough complete visit "
              f"history ({len(sequence)} usable visits, need at least 2).")
        return

    model = load_model(MODEL_PATH)

    X = np.array([sequence], dtype="float32")
    X_norm = (X - vmin) / (vmax - vmin)

    pred_norm = model.predict(X_norm, verbose=0)
    pred_real = pred_norm[0] * (vmax - vmin) + vmin

    print(f"Patient {patient_id} — based on {len(sequence)} past visits:")
    for name, value in zip(vitals_order, pred_real):
        print(f"  Predicted next {name}: {value:.1f}")

if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else None
    if not pid:
        print("Usage: python predict_vitals.py <patient_id>")
    else:
        predict(pid)