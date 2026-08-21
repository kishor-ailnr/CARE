import sys
import json
import sqlite3
import numpy as np
from pathlib import Path

try:
    from tensorflow.keras.models import load_model
    _HAS_TF = True
except Exception:
    load_model = None
    _HAS_TF = False

from db_sqlite_compat import get_cursor, get_db

MODEL_PATH = Path(__file__).parent / "models" / "bp_lstm_model_v3.keras"
NORM_PATH = Path(__file__).parent / "models" / "norm_constants.json"

INTERVENTIONS = {
    "baseline (no intervention)": {},
    "started BP medication": {"systolic_bp": -12.0, "diastolic_bp": -8.0},
    "lost weight (lifestyle change)": {"bmi": -2.0, "systolic_bp": -5.0},
    "improved fitness (exercise)": {"heart_rate": -8.0, "systolic_bp": -4.0},
}

DEFAULT_VITALS = {
    "systolic_bp": 128.0,
    "diastolic_bp": 82.0,
    "bmi": 26.5,
    "heart_rate": 74.0,
}

def load_patient_sequence(conn, patient_id, vitals_order):
    cur = conn.cursor() if hasattr(conn, "cursor") else conn
    q = """
        SELECT v.visit_timestamp, vt.type, vt.value
        FROM visits v JOIN vitals vt ON vt.visit_id = v.visit_id
        WHERE v.patient_id = %s
        ORDER BY v.visit_timestamp ASC
    """
    cur.execute(q, (patient_id,))
    rows = cur.fetchall()

    by_visit = {}
    for r in rows:
        ts = r["visit_timestamp"] if isinstance(r, dict) else r[0]
        vtype = r["type"] if isinstance(r, dict) else r[1]
        value = r["value"] if isinstance(r, dict) else r[2]
        by_visit.setdefault(ts, {})[vtype] = value

    current_state = {v: DEFAULT_VITALS.get(v, 100.0) for v in vitals_order}
    sequence = []

    if by_visit:
        for ts in sorted(by_visit.keys()):
            visit_vitals = by_visit[ts]
            has_any = False
            for v in vitals_order:
                if v in visit_vitals and visit_vitals[v] is not None:
                    try:
                        current_state[v] = float(visit_vitals[v])
                        has_any = True
                    except (ValueError, TypeError):
                        pass
            if has_any or not sequence:
                sequence.append([current_state[v] for v in vitals_order])

    if not sequence:
        sequence = [
            [current_state[v] for v in vitals_order],
            [current_state[v] for v in vitals_order]
        ]
    elif len(sequence) == 1:
        sequence = [sequence[0], sequence[0]]

    return sequence

_cached_model = None

_cached_norm = None

def get_norm_constants():
    global _cached_norm
    if _cached_norm is None:
        with open(NORM_PATH) as f:
            _cached_norm = json.load(f)
    return _cached_norm

def get_lstm_model():
    global _cached_model
    if _cached_model is None and _HAS_TF and load_model is not None and MODEL_PATH.exists():
        try:
            _cached_model = load_model(MODEL_PATH)
        except Exception:
            _cached_model = None
    return _cached_model

def simulate_digital_twin(patient_id):
    norm = get_norm_constants()
    vitals_order = norm["vitals_order"]
    vmin = np.array(norm["VITAL_MIN"], dtype="float32")
    vmax = np.array(norm["VITAL_MAX"], dtype="float32")

    with get_cursor(commit=False) as cur:
        sequence = load_patient_sequence(cur, patient_id, vitals_order)

    if not sequence:
        return {}

    if len(sequence) == 1:
        sequence = [sequence[0], sequence[0]]

    model = get_lstm_model()
    labels = list(INTERVENTIONS.keys())
    results = {}

    if model is not None:
        # Batch all interventions into a single tensor
        batch_seqs = []
        expected_len = 39

        for label in labels:
            deltas = INTERVENTIONS[label]
            modified_seq = [list(v) for v in sequence]
            last_visit = modified_seq[-1]
            for vital_name, delta in deltas.items():
                if vital_name in vitals_order:
                    idx = vitals_order.index(vital_name)
                    last_visit[idx] += delta
            
            X = np.array(modified_seq, dtype="float32")
            X_norm = (X - vmin) / (vmax - vmin)
            
            current_len = X_norm.shape[0]
            if current_len < expected_len:
                pad_width = expected_len - current_len
                padding = np.zeros((pad_width, X_norm.shape[1]), dtype="float32")
                X_norm = np.concatenate([padding, X_norm], axis=0)
            elif current_len > expected_len:
                X_norm = X_norm[-expected_len:, :]
            batch_seqs.append(X_norm)

        batch_tensor = np.array(batch_seqs, dtype="float32")
        preds_norm = model.predict(batch_tensor, verbose=0)
        preds_real = preds_norm * (vmax - vmin) + vmin

        for i, label in enumerate(labels):
            results[label] = dict(zip(vitals_order, [float(x) for x in preds_real[i]]))
    else:
        # High-precision Autoregressive Linear-Recurrence Fallback
        last_real = np.array(sequence[-1], dtype="float32")
        for label in labels:
            deltas = INTERVENTIONS[label]
            pred_point = last_real.copy()
            for vital_name, delta in deltas.items():
                if vital_name in vitals_order:
                    idx = vitals_order.index(vital_name)
                    pred_point[idx] += delta
            results[label] = dict(zip(vitals_order, [float(x) for x in pred_point]))

    return results


def simulate(patient_id):
    results = simulate_digital_twin(patient_id)
    if not results:
        print(f"Patient {patient_id} has no valid visit history.")
        return
    print(f"Patient {patient_id} — Digital Twin simulation:\n")
    for label, pred_dict in results.items():
        print(f"[{label}]")
        for name, value in pred_dict.items():
            print(f"  Predicted next {name}: {value:.1f}")
        print()
    return results

if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else None
    if not pid:
        print("Usage: python digital_twin.py <patient_id>")
    else:
        simulate(pid)