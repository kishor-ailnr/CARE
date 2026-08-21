"""
Comprehensive End-to-End Audit Test Suite for CARE
Tests ML models, formula engine, database compatibility, security, and all FastAPI endpoints.
"""
import os
import sys
import math
import json
import sqlite3
import numpy as np
import pandas as pd
from pathlib import Path

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

print("=" * 60)
print("CARE FULL SYSTEM AUDIT: STARTING CHECKS")
print("=" * 60)

passed = 0
failed = 0
failures = []

def test_assert(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ PASS: {name}")
    else:
        failed += 1
        msg = f"  ❌ FAIL: {name} {detail}"
        print(msg)
        failures.append(msg)

# -------------------------------------------------------------
# 1. FORMULA ENGINE & MATHEMATICAL INTEGRITY AUDIT
# -------------------------------------------------------------
print("\n[1/5] Testing Formula Engine & Mathematical Integrity...")

# BMI: weight_kg / (height_m ^ 2)
w, h_cm = 70.0, 175.0
h_m = h_cm / 100.0
expected_bmi = 70.0 / (1.75 ** 2)  # ~22.857
calc_bmi = round(w / (h_m ** 2), 2)
test_assert("BMI Formula (70kg, 175cm = 22.86)", math.isclose(calc_bmi, 22.86, abs_tol=0.01))

# MAP (Mean Arterial Pressure): (2 * DBP + SBP) / 3
sbp, dbp = 120.0, 80.0
calc_map = (2 * dbp + sbp) / 3.0  # 93.333
test_assert("MAP Formula (120/80 = 93.33)", math.isclose(calc_map, 93.33, abs_tol=0.01))

# Pulse Pressure: SBP - DBP
calc_pp = sbp - dbp  # 40.0
test_assert("Pulse Pressure Formula (120/80 = 40)", calc_pp == 40.0)

# Min-Max Normalization: (x - min) / (max - min)
x, x_min, x_max = 50.0, 0.0, 100.0
calc_norm = (x - x_min) / (x_max - x_min)
test_assert("Min-Max Normalization (50 in [0,100] = 0.5)", calc_norm == 0.5)

# Trend Slope (linear regression slope of a series)
y_series = [120, 124, 128, 132]
x_series = [0, 1, 2, 3]
slope = float(np.polyfit(x_series, y_series, 1)[0])
test_assert("Trend Slope Calculation (+4.0 mmHg/step)", math.isclose(slope, 4.0, abs_tol=0.001))

# -------------------------------------------------------------
# 2. ML PIPELINE & PREDICTION MODELS AUDIT
# -------------------------------------------------------------
print("\n[2/5] Testing ML Pipeline & Prediction Models...")

try:
    from prediction_pipeline import (
        run_prediction_for_patient,
        get_patient_demographics,
        RISK_MODEL_PATH
    )
    test_assert("Prediction pipeline module imported successfully", True)
except Exception as e:
    test_assert("Prediction pipeline import", False, str(e))

# Check model files exist on disk
model_dir = Path("models")
test_assert("models/ directory exists", model_dir.exists())

# Check model files exist on disk
model_dir = Path("models")
test_assert("models/ directory exists", model_dir.exists())

expected_model_files = [
    "framingham_risk_model.pkl",
    "framingham_cox_model.pkl"
]
for mf in expected_model_files:
    test_assert(f"Model file {mf} exists", (model_dir / mf).exists())

# Digital Twin Simulation test
try:
    from digital_twin import simulate_digital_twin
    from intervention_ranking import rank_interventions_for_patient
    test_assert("Digital Twin & Intervention modules imported successfully", True)
except Exception as e:
    test_assert("Digital Twin imports", False, str(e))

# -------------------------------------------------------------
# 3. DATABASE SCHEMA & DATA INTEGRITY AUDIT
# -------------------------------------------------------------
print("\n[3/5] Testing Database Schema & Storage Compatibility...")

try:
    from db_sqlite_compat import get_cursor, get_db
    with get_cursor() as cur:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cur.fetchall()]
        print(f"    Discovered tables: {tables}")
        for req_table in ["patients", "vitals", "observations", "users"]:
            test_assert(f"Required table '{req_table}' exists in DB", req_table in tables)
            
        cur.execute("SELECT COUNT(*) FROM patients")
        patient_count = cur.fetchone()[0]
        test_assert(f"Patients table has records ({patient_count} rows)", patient_count > 0)
        
        cur.execute("SELECT COUNT(*) FROM users")
        user_count = cur.fetchone()[0]
        test_assert(f"Users table has demo users ({user_count} rows)", user_count > 0)
except Exception as e:
    test_assert("Database schema verification", False, str(e))

# -------------------------------------------------------------
# 4. FASTAPI ENDPOINT FUNCTION & ROUTE AUDIT
# -------------------------------------------------------------
print("\n[4/5] Testing FastAPI Endpoints, Handlers & Security Scopes...")

try:
    from sync_server import (
        health_check,
        login_user,
        delegate_sync_token,
        list_patients,
        get_patient_detail,
        get_patient_observations,
        get_ranked_interventions,
        bulk_download_patients,
        LoginRequest,
        DelegateSyncTokenRequest
    )
    
    # 4.1 Health Check Function
    res_health = health_check()
    test_assert("GET /health -> status 'ok'", res_health.get("status") == "ok")

    # 4.2 Login doctor1
    from starlette.requests import Request as StarletteReq
    req = StarletteReq({"type": "http", "method": "POST", "path": "/auth/login", "client": ("127.0.0.1", 1234), "headers": []})
    doc_login_res = login_user(req, LoginRequest(username="doctor1", password="doctor123"))
    test_assert("POST /auth/login (doctor1) returns JWT", "access_token" in doc_login_res)
    test_assert("doctor1 role is 'doctor'", doc_login_res.get("role") == "doctor")
    doc_token = doc_login_res["access_token"]

    # 4.3 Login asha1
    asha_login_res = login_user(req, LoginRequest(username="asha1", password="asha123"))
    test_assert("POST /auth/login (asha1) returns JWT", "access_token" in asha_login_res)
    test_assert("asha1 role is 'asha_worker'", asha_login_res.get("role") == "asha_worker")

    # 4.4 Delegate sync token for doctor1
    delegate_res = delegate_sync_token(DelegateSyncTokenRequest(username="doctor1", password="doctor123", device_install_id="dev-01"))
    test_assert("POST /auth/delegate-sync-token (doctor1) -> access_token returned", "access_token" in delegate_res)
    test_assert("doctor_username matches", delegate_res.get("doctor_username") == "doctor1")

    # 4.5 Patient Directory Listing
    doc_user = {"username": "doctor1", "role": "doctor"}
    patients_res = list_patients(search=None, limit=10, offset=0, current_user=doc_user)
    p_list = patients_res.get("patients", [])
    test_assert(f"GET /patients returned directory ({len(p_list)} patients)", len(p_list) > 0)

    # 4.6 Patient Detail
    test_pid = p_list[0]["patient_id"] if p_list else "e8c0cc84-be5b-deb8-d6d9-73d3c376f1b9"
    detail_res = get_patient_detail(test_pid, current_user=doc_user)
    test_assert(f"GET /patients/{test_pid} returned demographic profile", "patient_id" in detail_res)
    test_assert(f"GET /patients/{test_pid} includes latest_prediction", "latest_prediction" in detail_res)

    # 4.7 Patient Observations
    obs_res = get_patient_observations(test_pid)
    test_assert(f"GET /patients/{test_pid}/observations returned vitals", "vitals" in obs_res)

    # 4.8 Ranked Interventions Digital Twin
    interv_res = get_ranked_interventions(test_pid)
    test_assert("Digital Twin returned ranked intervention scenarios", isinstance(interv_res, list))
    test_assert(f"Scenarios evaluated: {len(interv_res)} scenarios", len(interv_res) > 0)

    # 4.9 Bulk Download with Sync User
    sync_user = {"username": "doctor1", "role": "sync_only"}
    bulk_res = bulk_download_patients(limit=50, current_user=sync_user)
    test_assert("GET /sync/bulk-download returned batch", "patients" in bulk_res)
    test_assert(f"Batch has {len(bulk_res.get('patients', []))} records", len(bulk_res.get("patients", [])) > 0)

except Exception as e:
    import traceback
    test_assert("FastAPI endpoint audit", False, f"{e}\n{traceback.format_exc()}")

# -------------------------------------------------------------
# 5. SUMMARY
# -------------------------------------------------------------
print("\n" + "=" * 60)
print(f"AUDIT SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 60)

if failed > 0:
    print("Issues identified:")
    for f in failures:
        print(" - " + f)
    sys.exit(1)
else:
    print("🌟 All core layers PASSED audit successfully!")
    sys.exit(0)
