import time
import json
import sqlite3
import requests
import numpy as np
import pandas as pd
from pathlib import Path

BASE_URL = "http://127.0.0.1:8000"

def run_benchmarks():
    results = {}
    
    # 1. Measure Static File & Asset Payload Sizes
    assets = [
        "index.html", "asha.html", "doctor.html", "patient.html",
        "styles.css", "doctor_styles.css", "app.js", "doctor_app.js",
        "doctor_patient_detail.js", "db.js", "sw.js",
        "bg-silk.png", "ambulance.png", "ecg-bg.png", "stethoscope.jpg"
    ]
    asset_sizes = {}
    for a in assets:
        p = Path(a)
        if p.exists():
            asset_sizes[a] = p.stat().st_size
    results["asset_sizes_bytes"] = asset_sizes

    # 2. Measure Auth Login Latency
    t0 = time.perf_counter()
    r = requests.post(f"{BASE_URL}/auth/login", json={"username": "doctor1", "password": "doctor123"})
    t_login = (time.perf_counter() - t0) * 1000
    token = r.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}
    results["auth_login_ms"] = round(t_login, 2)

    # 3. Measure Patient Search & List Endpoint
    # Warmup
    requests.get(f"{BASE_URL}/patients?limit=20", headers=headers)
    
    # Measure /patients (no query)
    t0 = time.perf_counter()
    r_list = requests.get(f"{BASE_URL}/patients?limit=20", headers=headers)
    t_list = (time.perf_counter() - t0) * 1000
    results["patients_list_20_ms"] = round(t_list, 2)
    results["patients_list_20_payload_bytes"] = len(r_list.content)

    # Measure /patients (with search query)
    t0 = time.perf_counter()
    r_search = requests.get(f"{BASE_URL}/patients?q=0006&limit=20", headers=headers)
    t_search = (time.perf_counter() - t0) * 1000
    results["patients_search_ms"] = round(t_search, 2)

    patients = r_list.json().get("patients", [])
    patient_id = patients[0]["patient_id"] if patients else "0006cd14-61b6-2ee7-8422-fe60e680fb63"
    results["tested_patient_id"] = patient_id

    # 4. Measure Patient Detail Endpoint
    t0 = time.perf_counter()
    r_detail = requests.get(f"{BASE_URL}/patients/{patient_id}", headers=headers)
    t_detail = (time.perf_counter() - t0) * 1000
    results["patient_detail_ms"] = round(t_detail, 2)
    results["patient_detail_payload_bytes"] = len(r_detail.content)

    # 5. Measure Patient Observations (Vitals History)
    t0 = time.perf_counter()
    r_obs = requests.get(f"{BASE_URL}/patients/{patient_id}/observations", headers=headers)
    t_obs = (time.perf_counter() - t0) * 1000
    results["patient_observations_ms"] = round(t_obs, 2)
    results["patient_observations_payload_bytes"] = len(r_obs.content)

    # 6. Measure Ranked Interventions (Digital Twin)
    t0 = time.perf_counter()
    r_ranked = requests.get(f"{BASE_URL}/patients/{patient_id}/interventions/ranked", headers=headers)
    t_ranked = (time.perf_counter() - t0) * 1000
    results["patient_interventions_ranked_ms"] = round(t_ranked, 2)
    results["patient_interventions_payload_bytes"] = len(r_ranked.content)

    # 7. Measure Digital Twin Simulation Endpoint directly
    t0 = time.perf_counter()
    r_dt = requests.post(f"{BASE_URL}/patients/{patient_id}/digital-twin", json={}, headers=headers)
    t_dt = (time.perf_counter() - t0) * 1000
    results["patient_digital_twin_ms"] = round(t_dt, 2)

    # 8. Measure ML Pipeline Components in Isolation
    from prediction_pipeline import run_prediction_for_patient, get_risk_bundle
    from digital_twin import simulate_digital_twin
    import explain_risk

    # Prediction Pipeline timing
    t0 = time.perf_counter()
    pred_res = run_prediction_for_patient(patient_id)
    t_pred = (time.perf_counter() - t0) * 1000
    results["ml_prediction_pipeline_isolated_ms"] = round(t_pred, 2)

    # Digital Twin timing
    t0 = time.perf_counter()
    dt_res = simulate_digital_twin(patient_id)
    t_dt_iso = (time.perf_counter() - t0) * 1000
    results["ml_digital_twin_isolated_ms"] = round(t_dt_iso, 2)

    # SHAP Explainability timing
    try:
        t0 = time.perf_counter()
        risk_bundle = get_risk_bundle()
        model = risk_bundle["model"]
        feature_names = risk_bundle["feature_names"]
        # Dummy vector
        X_sample = pd.DataFrame([[50, 1, 10, 0, 0, 1, 0, 220.0, 140.0, 90.0, 27.5, 76.0, 95.0, 1.96, 4.31, 500.0, 1, 0, 0, 0, 8.2]], columns=feature_names)
        import shap
        tree_est = model.named_estimators_['rf'] if hasattr(model, 'named_estimators_') and 'rf' in model.named_estimators_ else model
        explainer = shap.TreeExplainer(tree_est)
        s_vals = explainer.shap_values(X_sample)
        t_shap = (time.perf_counter() - t0) * 1000
        results["ml_shap_calculation_ms"] = round(t_shap, 2)
    except Exception as e:
        results["ml_shap_calculation_ms"] = str(e)

    # 9. Measure Database Queries directly
    from db_sqlite_compat import get_cursor
    with get_cursor(commit=False) as cur:
        # Query 1: Patient lookup
        t0 = time.perf_counter()
        cur.execute("SELECT * FROM patients WHERE patient_id = %s", (patient_id,))
        cur.fetchone()
        t_q1 = (time.perf_counter() - t0) * 1000
        results["db_query_patient_lookup_ms"] = round(t_q1, 3)

        # Query 2: Patient list with count
        t0 = time.perf_counter()
        cur.execute("""
            SELECT p.patient_id, p.source, p.dob_estimated, p.sex, p.condition,
                   ph.photo_path,
                   COALESCE(v.visit_count, 0) AS visit_count
            FROM patients p
            LEFT JOIN patient_photos ph ON p.patient_id = ph.patient_id
            LEFT JOIN (
                SELECT patient_id, COUNT(*) AS visit_count FROM visits GROUP BY patient_id
            ) v ON p.patient_id = v.patient_id
            ORDER BY p.patient_id ASC
            LIMIT 20 OFFSET 0
        """)
        cur.fetchall()
        t_q2 = (time.perf_counter() - t0) * 1000
        results["db_query_patient_list_join_ms"] = round(t_q2, 3)

        # Query 3: Vitals history join
        t0 = time.perf_counter()
        cur.execute("""
            SELECT v.visit_id, v.visit_timestamp, vt.type, vt.value, vt.unit
            FROM visits v
            JOIN vitals vt ON vt.visit_id = v.visit_id
            WHERE v.patient_id = %s
            ORDER BY v.visit_timestamp ASC
        """, (patient_id,))
        cur.fetchall()
        t_q3 = (time.perf_counter() - t0) * 1000
        results["db_query_vitals_history_ms"] = round(t_q3, 3)

    return results

if __name__ == "__main__":
    res = run_benchmarks()
    print(json.dumps(res, indent=2))
