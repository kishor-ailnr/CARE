"""
Loads and runs the TFLite model directly, using the lightweight TFLite
interpreter (not full TensorFlow's Keras API) — this is the actual proof
of on-device, offline-capable inference.

Usage: python predict_tflite.py <patient_id>
"""
import sys
import json
import sqlite3
import numpy as np
from pathlib import Path
import tensorflow as tf  # only used here for the Interpreter class

DB_PATH = Path(__file__).parent / "care.db"
TFLITE_PATH = Path(__file__).parent / "models" / "bp_lstm_model_v3.tflite"
NORM_PATH = Path(__file__).parent / "models" / "norm_constants.json"

def load_patient_sequence(conn, patient_id, vitals_order):
    q = """
        SELECT v.visit_timestamp, vt.type, vt.value
        FROM visits v JOIN vitals vt ON vt.visit_id = v.visit_id
        WHERE v.patient_id = ?
        ORDER BY v.visit_timestamp ASC
    """
    rows = conn.execute(q, (patient_id,)).fetchall()
    by_visit = {}
    for ts, vtype, value in rows:
        by_visit.setdefault(ts, {})[vtype] = value

    sequence = []
    for ts in sorted(by_visit.keys()):
        visit_vitals = by_visit[ts]
        row = [visit_vitals.get(v) for v in vitals_order]
        if any(x is None for x in row):
            continue
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
        print(f"Patient {patient_id} doesn't have enough complete visit history.")
        return

    interpreter = tf.lite.Interpreter(model_path=str(TFLITE_PATH))
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    X = np.array([sequence], dtype="float32")
    X_norm = ((X - vmin) / (vmax - vmin)).astype("float32")

    expected_len = input_details[0]["shape"][1]
    current_len = X_norm.shape[1]
    if current_len < expected_len:
        pad_width = expected_len - current_len
        padding = np.zeros((1, pad_width, X_norm.shape[2]), dtype="float32")
        X_norm = np.concatenate([padding, X_norm], axis=1)
    elif current_len > expected_len:
        X_norm = X_norm[:, -expected_len:, :]

    interpreter.set_tensor(input_details[0]["index"], X_norm)
    interpreter.invoke()
    pred_norm = interpreter.get_tensor(output_details[0]["index"])[0]

    pred_real = pred_norm * (vmax - vmin) + vmin

    print(f"Patient {patient_id} — TFLite prediction (based on {len(sequence)} visits):")
    for name, value in zip(vitals_order, pred_real):
        print(f"  Predicted next {name}: {value:.1f}")

if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else None
    if not pid:
        print("Usage: python predict_tflite.py <patient_id>")
    else:
        predict(pid)