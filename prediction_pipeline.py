"""
Prediction Pipeline for CARE.
1. sync_observations_to_vitals: Converts unconverted observations to visits and vitals.
2. run_prediction_for_patient: Calculates Framingham risk score, SHAP explanation, and stores in predictions.
"""

import sqlite3
import joblib
import shap
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime
from collections import defaultdict

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


def sync_observations_to_vitals(patient_id: str, conn=None):
    """
    Query unconverted rows from observations where patient_id = %s.
    Group rows by recorded_at (truncated to the same visit — use exact timestamp match) into one visit per group.
    For each group, if no visits row exists with that patient_id + visit_timestamp, insert one (generate visit_id as f"{patient_id}_{recorded_at}").
    Map field_key -> vitals type using exact naming: systolic_bp, diastolic_bp, heart_rate, height_cm, weight_kg, body_temp.
    If both height_cm and weight_kg are present in a group, additionally compute and insert a bmi vital as weight_kg / (height_cm/100)**2.
    Insert each mapped field as a row into vitals (visit_id, type, value, unit=NULL).
    Do not touch observations.synced here — that's set by the caller after full pipeline success.
    """
    def _do_sync(cur):
        cur.execute("""
            SELECT observation_id, category, field_key, field_value, recorded_at
            FROM observations
            WHERE patient_id = %s AND (synced = 0 OR synced IS NULL)
        """, (patient_id,))
        rows = cur.fetchall()

        if not rows:
            return

        groups = defaultdict(list)
        for r in rows:
            obs_id = r["observation_id"] if isinstance(r, dict) else r[0]
            category = r["category"] if isinstance(r, dict) else r[1]
            field_key = r["field_key"] if isinstance(r, dict) else r[2]
            field_value = r["field_value"] if isinstance(r, dict) else r[3]
            recorded_at = r["recorded_at"] if isinstance(r, dict) else r[4]
            groups[recorded_at].append((field_key, field_value))

        field_map = {
            "systolic_bp": "systolic_bp",
            "diastolic_bp": "diastolic_bp",
            "heart_rate": "heart_rate",
            "height_cm": "height_cm",
            "weight_kg": "weight_kg",
            "body_temp": "body_temp",
            "temperature_c": "body_temp",
        }

        for recorded_at, obs_list in groups.items():
            cur.execute("""
                SELECT visit_id FROM visits
                WHERE patient_id = %s AND visit_timestamp = %s
            """, (patient_id, recorded_at))
            visit_row = cur.fetchone()

            if visit_row:
                visit_id = visit_row["visit_id"] if isinstance(visit_row, dict) else visit_row[0]
            else:
                visit_id = f"{patient_id}_{recorded_at}"
                cur.execute("""
                    INSERT INTO visits (visit_id, patient_id, visit_timestamp)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (visit_id) DO NOTHING
                """, (visit_id, patient_id, recorded_at))

            group_vitals = {}
            for f_key, f_val in obs_list:
                if f_key in field_map:
                    try:
                        val_float = float(f_val)
                        vital_type = field_map[f_key]
                        group_vitals[vital_type] = val_float
                    except (ValueError, TypeError):
                        continue

            if "height_cm" in group_vitals and "weight_kg" in group_vitals:
                h = group_vitals["height_cm"]
                w = group_vitals["weight_kg"]
                if h > 0:
                    bmi = w / ((h / 100.0) ** 2)
                    group_vitals["bmi"] = bmi

            for v_type, v_val in group_vitals.items():
                cur.execute("""
                    INSERT INTO vitals (visit_id, type, value, unit)
                    VALUES (%s, %s, %s, NULL)
                """, (visit_id, v_type, v_val))

    if conn is not None:
        cur = conn.cursor() if hasattr(conn, "cursor") else conn
        _do_sync(cur)
    else:
        with get_cursor(commit=True) as cur:
            _do_sync(cur)


_RISK_BUNDLE_CACHE = None
_FRAM_DEFAULTS_CACHE = None

def get_risk_bundle():
    global _RISK_BUNDLE_CACHE
    if _RISK_BUNDLE_CACHE is None:
        _RISK_BUNDLE_CACHE = joblib.load(RISK_MODEL_PATH)
    return _RISK_BUNDLE_CACHE

def get_framingham_defaults():
    global _FRAM_DEFAULTS_CACHE
    if _FRAM_DEFAULTS_CACHE is None:
        if FRAMINGHAM_CSV.exists():
            fram_df = pd.read_csv(FRAMINGHAM_CSV).dropna()
            _FRAM_DEFAULTS_CACHE = fram_df.median(numeric_only=True).to_dict()
        else:
            _FRAM_DEFAULTS_CACHE = {
                "age": 50, "male": 0, "cigsPerDay": 0, "BPMeds": 0,
                "prevalentStroke": 0, "prevalentHyp": 0, "diabetes": 0,
                "totChol": 235.0, "sysBP": 132.0, "diaBP": 82.0,
                "BMI": 25.8, "heartRate": 75.0, "glucose": 80.0
            }
    return _FRAM_DEFAULTS_CACHE

def run_prediction_for_patient(patient_id: str) -> dict:
    """
    Runs risk prediction using PostgreSQL pooled connection.
    Inserts result into predictions table.
    """
    risk_bundle = get_risk_bundle()
    model = risk_bundle["model"]
    feature_names = risk_bundle["feature_names"]

    with get_cursor(commit=True) as cur:
        age, male = get_patient_demographics(cur, patient_id)
        latest_vitals = get_latest_vitals(cur, patient_id)

        cur.execute(
            "SELECT COUNT(DISTINCT visit_id) AS count FROM visits WHERE patient_id = %s",
            (patient_id,)
        )
        num_visits_row = cur.fetchone()
        num_visits = num_visits_row["count"] if num_visits_row else 0

        defaults = get_framingham_defaults()

        patient_features = set()

        cur.execute(
            "SELECT dob_estimated, sex FROM patients WHERE patient_id = %s",
            (patient_id,)
        )
        p_row = cur.fetchone()
        if p_row:
            dob_val = p_row["dob_estimated"] if isinstance(p_row, dict) else p_row[0]
            sex_val = p_row["sex"] if isinstance(p_row, dict) else p_row[1]
            if dob_val:
                patient_features.add("age")
            if sex_val:
                patient_features.add("male")

        row = defaults.copy()
        row["age"] = age
        row["male"] = male

        vitals_mapping = {
            "systolic_bp": "sysBP",
            "diastolic_bp": "diaBP",
            "bmi": "BMI",
            "heart_rate": "heartRate",
            "glucose": "glucose",
            "tot_chol": "totChol",
            "totChol": "totChol",
        }

        for v_type, feat_name in vitals_mapping.items():
            if v_type in latest_vitals:
                row[feat_name] = latest_vitals[v_type]
                patient_features.add(feat_name)

        defaults_used = sum(1 for f in feature_names if f not in patient_features)

        if defaults_used > (len(feature_names) / 2.0):
            confidence = "low"
        elif num_visits >= 3:
            confidence = "high"
        elif num_visits >= 1:
            confidence = "medium"
        else:
            confidence = "low"

        row = compute_clinical_features(row)

        X = pd.DataFrame([[row.get(f, 0.0) for f in feature_names]], columns=feature_names)

        risk_prob = float(model.predict_proba(X)[0, 1])

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
        except Exception as e:
            # Fallback heuristic feature importance
            contributions = [0.0] * len(feature_names)

        feature_impact = list(zip(feature_names, X.iloc[0].values, contributions))
        feature_impact.sort(key=lambda x: abs(float(x[2])), reverse=True)

        explanation_lines = []
        shap_values_list = []
        for name, value, impact in feature_impact[:8]:
            direction = "increases" if impact > 0 else "decreases"
            explanation_lines.append(
                f"  {name} = {float(value):.1f}  →  {direction} risk (impact: {float(impact):+.4f})"
            )
            shap_values_list.append({
                "feature": str(name),
                "value": round(float(value), 2),
                "impact": round(float(impact), 4),
                "direction": direction,
                "is_positive": bool(impact > 0),
            })
        explanation = "\n".join(explanation_lines)

        # Cox survival model calculation
        COX_MODEL_PATH = Path(__file__).parent / "models" / "framingham_cox_model.pkl"
        cox_survival_curve = []
        cox_risk_score = risk_prob
        models_agree = True

        if COX_MODEL_PATH.exists():
            try:
                cox_bundle = joblib.load(COX_MODEL_PATH)
                cox_model = cox_bundle["model"]
                cox_features = cox_bundle["feature_names"]
                followup = cox_bundle.get("followup_months", 120)

                X_cox = pd.DataFrame([[row[f] for f in cox_features]], columns=cox_features)
                time_points = list(range(0, followup + 1, 6))
                surv_fn = cox_model.predict_survival_function(X_cox, times=time_points)
                risk_over_time = (1 - surv_fn.values.flatten()) * 100

                cox_survival_curve = [
                    {"months": int(m), "risk_pct": round(float(r), 2)}
                    for m, r in zip(time_points, risk_over_time)
                ]
                cox_risk_score = float(risk_over_time[-1] / 100.0)
                models_agree = abs(risk_prob - cox_risk_score) <= 0.07
            except Exception as e:
                print("Cox model calculation warning:", e)

        created_at = datetime.now().isoformat()
        try:
            cur.execute(
                "INSERT INTO predictions (patient_id, scenario, risk_score, confidence, explanation, created_at) "
                "VALUES (%s, 'baseline', %s, %s, %s, %s)",
                (patient_id, risk_prob, confidence, explanation, created_at),
            )
        except Exception:
            pass

    return {
        "risk_score": risk_prob,
        "risk_pct": round(risk_prob * 100, 1),
        "confidence": confidence,
        "explanation": explanation,
        "shap_values": shap_values_list,
        "cox_risk_score": cox_risk_score,
        "cox_risk_pct": round(cox_risk_score * 100, 1),
        "models_agree": models_agree,
        "cox_survival_curve": cox_survival_curve,
    }

