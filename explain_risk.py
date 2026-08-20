"""
Explainable AI layer: uses SHAP to explain WHY the Framingham risk model
gave a specific patient a specific risk score — showing which factors
pushed their risk up or down, and by how much.

Usage: python explain_risk.py <patient_id>
"""
import sys
import json
import sqlite3
import joblib
import shap
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

from db_sqlite_compat import get_cursor, get_db

RISK_MODEL_PATH = Path(__file__).parent / "models" / "framingham_risk_model.pkl"
FRAMINGHAM_CSV = Path(__file__).parent / "data" / "framingham.csv"

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
        age = 50
    male = 1 if sex == "male" else 0
    return age, male

def get_latest_vitals(conn, patient_id):
    cur = conn.cursor() if hasattr(conn, "cursor") else conn
    cur.execute("""
        SELECT vt.type, vt.value FROM vitals vt
        JOIN visits v ON v.visit_id = vt.visit_id
        WHERE v.patient_id = %s
        ORDER BY v.visit_timestamp DESC
    """, (patient_id,))
    rows = cur.fetchall()

    latest = {}
    for r in rows:
        vtype = r["type"] if isinstance(r, dict) else r[0]
        value = r["value"] if isinstance(r, dict) else r[1]
        if vtype not in latest:  # first occurrence = most recent (DESC order)
            latest[vtype] = value
    return latest

def explain(patient_id):
    risk_bundle = joblib.load(RISK_MODEL_PATH)
    model = risk_bundle["model"]
    feature_names = risk_bundle["feature_names"]

    with get_cursor(commit=False) as cur:
        age, male = get_patient_demographics(cur, patient_id)
        latest_vitals = get_latest_vitals(cur, patient_id)

    # Population-average defaults for anything Synthea doesn't give us
    fram_df = pd.read_csv(FRAMINGHAM_CSV).dropna()
    defaults = fram_df.median(numeric_only=True).to_dict()

    row = defaults.copy()
    row["age"] = age
    row["male"] = male
    if "systolic_bp" in latest_vitals:
        row["sysBP"] = latest_vitals["systolic_bp"]
    if "diastolic_bp" in latest_vitals:
        row["diaBP"] = latest_vitals["diastolic_bp"]
    if "bmi" in latest_vitals:
        row["BMI"] = latest_vitals["bmi"]
    if "heart_rate" in latest_vitals:
        row["heartRate"] = latest_vitals["heart_rate"]

    row = compute_clinical_features(row)
    X = pd.DataFrame([[row.get(f, 0.0) for f in feature_names]], columns=feature_names)

    risk_prob = model.predict_proba(X)[0, 1]
    print(f"Patient {patient_id} — predicted 10-year CHD risk: {risk_prob*100:.1f}%\n")

    try:
        tree_est = model.named_estimators_['rf'] if hasattr(model, 'named_estimators_') and 'rf' in model.named_estimators_ else (model.estimators_[0] if hasattr(model, 'estimators_') else model)
        explainer = shap.TreeExplainer(tree_est)
        shap_values = explainer.shap_values(X)

        if isinstance(shap_values, list):
            contributions = shap_values[1][0]
        else:
            contributions = np.array(shap_values)
            if contributions.ndim == 3:
                contributions = contributions[0, :, 1]
            else:
                contributions = contributions[0]
    except Exception:
        contributions = [0.0] * len(feature_names)

    feature_impact = list(zip(feature_names, X.iloc[0].values, contributions))
    feature_impact.sort(key=lambda x: abs(float(x[2])), reverse=True)

    print("Top factors driving this prediction (sorted by impact):\n")
    for name, value, impact in feature_impact[:8]:
        direction = "increases" if impact > 0 else "decreases"
        print(f"  {name} = {value:.1f}  →  {direction} risk (impact: {impact:+.4f})")

if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else None
    if not pid:
        print("Usage: python explain_risk.py <patient_id>")
    else:
        explain(pid)