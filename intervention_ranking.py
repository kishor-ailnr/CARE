"""
Intervention Ranking Engine.
Runs each digital-twin 'what if' scenario through the Framingham risk
classifier to get a predicted 10-year CHD risk score, then ranks
interventions from lowest to highest predicted risk.

Usage: python intervention_ranking.py <patient_id>
"""
import sys
import json
import sqlite3
import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime
from tensorflow.keras.models import load_model

from db_sqlite_compat import get_cursor, get_db

MODEL_PATH = Path(__file__).parent / "models" / "bp_lstm_model_v3.keras"
NORM_PATH = Path(__file__).parent / "models" / "norm_constants.json"
RISK_MODEL_PATH = Path(__file__).parent / "models" / "framingham_risk_model.pkl"
FRAMINGHAM_CSV = Path(__file__).parent / "data" / "framingham.csv"

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

def get_patient_demographics(conn, patient_id):
    cur = conn.cursor() if hasattr(conn, "cursor") else conn
    cur.execute(
        "SELECT dob_estimated, sex FROM patients WHERE patient_id = %s",
        (patient_id,),
    )
    row = cur.fetchone()
    if not row:
        return 50, 0
    dob_str = row["dob_estimated"] if isinstance(row, dict) else row[0]
    sex = row["sex"] if isinstance(row, dict) else row[1]
    try:
        dob = datetime.fromisoformat(str(dob_str).replace("Z", ""))
        age = (datetime.now() - dob).days // 365
    except Exception:
        age = 50  # fallback default
    male = 1 if sex == "male" else 0
    return age, male

def compute_clinical_features(row: dict) -> dict:
    r = row.copy()
    sysBP = float(r.get("sysBP", 120.0))
    diaBP = float(r.get("diaBP", 80.0))
    age = float(r.get("age", 50.0))
    bmi = float(r.get("BMI", 25.0))
    totChol = float(r.get("totChol", 200.0))
    cigs = float(r.get("cigsPerDay", 0.0))
    glucose = float(r.get("glucose", 90.0))
    smoker = float(r.get("currentSmoker", 0.0))
    diabetes = float(r.get("diabetes", 0.0))
    bp_meds = float(r.get("BPMeds", 0.0))

    r["pulse_pressure"] = sysBP - diaBP
    r["MAP"] = (sysBP + 2.0 * diaBP) / 3.0
    r["bp_ratio"] = sysBP / (diaBP + 1e-5)
    r["age_bmi"] = age * bmi
    r["age_sq"] = (age / 10.0) ** 2
    r["sysBP_sq"] = (sysBP / 100.0) ** 2
    r["chol_age"] = totChol / (age + 1.0)
    r["cigs_age"] = cigs * age
    r["hypertension"] = int((sysBP >= 140) or (diaBP >= 90))
    r["severe_hyp"] = int((sysBP >= 160) or (diaBP >= 100))
    r["obese"] = int(bmi >= 30)
    r["glucose_risk"] = int(glucose >= 126)
    r["framingham_risk_index"] = (
        0.04 * age +
        0.02 * sysBP +
        0.01 * totChol +
        0.60 * smoker +
        0.80 * diabetes +
        0.50 * bp_meds +
        0.03 * bmi
    )
    return r

def build_risk_features(feature_names, defaults, age, male, sysBP, diaBP, bmi, heartRate):
    row = defaults.copy()
    row["age"] = age
    row["male"] = male
    row["sysBP"] = sysBP
    row["diaBP"] = diaBP
    row["BMI"] = bmi
    row["heartRate"] = heartRate
    row = compute_clinical_features(row)
    return pd.DataFrame([[row.get(f, 0.0) for f in feature_names]], columns=feature_names)

_cached_lstm = None
_cached_risk_bundle = None

def get_models():
    global _cached_lstm, _cached_risk_bundle
    if _cached_lstm is None:
        _cached_lstm = load_model(MODEL_PATH)
    if _cached_risk_bundle is None:
        _cached_risk_bundle = joblib.load(RISK_MODEL_PATH)
    return _cached_lstm, _cached_risk_bundle

def rank_interventions_for_patient(patient_id):
    with open(NORM_PATH) as f:
        norm = json.load(f)
    vitals_order = norm["vitals_order"]
    vmin = np.array(norm["VITAL_MIN"])
    vmax = np.array(norm["VITAL_MAX"])

    with get_cursor(commit=False) as cur:
        sequence = load_patient_sequence(cur, patient_id, vitals_order)
        age, male = get_patient_demographics(cur, patient_id)

    if not sequence:
        return []

    if len(sequence) == 1:
        sequence = [sequence[0], sequence[0]]

    lstm_model, risk_bundle = get_models()
    risk_model = risk_bundle["model"]
    feature_names = risk_bundle["feature_names"]

    fram_df = pd.read_csv(FRAMINGHAM_CSV).dropna()
    defaults = fram_df.median(numeric_only=True).to_dict()

    baseline_risk = None
    results = []

    for label, deltas in INTERVENTIONS.items():
        modified_seq = [list(v) for v in sequence]
        last_visit = modified_seq[-1]
        for vital_name, delta in deltas.items():
            if vital_name in vitals_order:
                idx = vitals_order.index(vital_name)
                last_visit[idx] += delta

        X = np.array([modified_seq], dtype="float32")
        X_norm = (X - vmin) / (vmax - vmin)

        expected_len = 39
        current_len = X_norm.shape[1]
        if current_len < expected_len:
            pad_width = expected_len - current_len
            padding = np.zeros((1, pad_width, X_norm.shape[2]), dtype="float32")
            X_norm = np.concatenate([padding, X_norm], axis=1)
        elif current_len > expected_len:
            X_norm = X_norm[:, -expected_len:, :]

        pred_norm = lstm_model.predict(X_norm, verbose=0)
        pred_real = pred_norm[0] * (vmax - vmin) + vmin
        pred_dict = dict(zip(vitals_order, [float(x) for x in pred_real]))

        risk_features = build_risk_features(
            feature_names, defaults, age, male,
            pred_dict["systolic_bp"], pred_dict["diastolic_bp"],
            pred_dict["bmi"], pred_dict["heart_rate"],
        )
        risk_prob = float(risk_model.predict_proba(risk_features)[0, 1])

        if label == "baseline (no intervention)":
            baseline_risk = risk_prob

        results.append({
            "scenario": label,
            "risk_score": risk_prob,
            "predicted_vitals": pred_dict,
        })

    if baseline_risk is None:
        baseline_risk = results[0]["risk_score"] if results else 0.0

    for r in results:
        r["baseline_risk_score"] = baseline_risk
        r["risk_delta"] = baseline_risk - r["risk_score"]

    results.sort(key=lambda x: x["risk_score"])
    return results


def rank_interventions(patient_id):
    results = rank_interventions_for_patient(patient_id)
    if not results:
        print(f"Patient {patient_id} has no valid visit history.")
        return
    print(f"Patient {patient_id} — Intervention Ranking:\n")
    for rank, item in enumerate(results, 1):
        print(f"{rank}. {item['scenario']} — predicted 10-year CHD risk: {item['risk_score']*100:.1f}%")
        for name, value in item['predicted_vitals'].items():
            print(f"     {name}: {value:.1f}")
        print()
    return results

if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else None
    if not pid:
        print("Usage: python intervention_ranking.py <patient_id>")
    else:
        rank_interventions(pid)