import json
import sqlite3
import urllib.request
from datetime import datetime, timezone

from db_pg import get_cursor

SERVER_URL = "http://127.0.0.1:8000/sync"
PATIENT_ID = "0006ecdb-15d8-3141-3749-47889e000f73"

now = datetime.now(timezone.utc).isoformat()

payload = {
    "observations": [
        {"patient_id": PATIENT_ID, "category": "Heart", "field_key": "systolic_bp", "field_value": "132", "recorded_by": "test_asha_worker", "recorded_at": now},
        {"patient_id": PATIENT_ID, "category": "Heart", "field_key": "diastolic_bp", "field_value": "84", "recorded_by": "test_asha_worker", "recorded_at": now},
        {"patient_id": PATIENT_ID, "category": "Heart", "field_key": "heart_rate", "field_value": "76", "recorded_by": "test_asha_worker", "recorded_at": now},
        {"patient_id": PATIENT_ID, "category": "Body", "field_key": "height_cm", "field_value": "170", "recorded_by": "test_asha_worker", "recorded_at": now},
        {"patient_id": PATIENT_ID, "category": "Body", "field_key": "weight_kg", "field_value": "72", "recorded_by": "test_asha_worker", "recorded_at": now},
    ]
}

print(f"=== Sending test observations for patient {PATIENT_ID} at {now} ===\n")

req = urllib.request.Request(
    SERVER_URL,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req) as resp:
        body = resp.read().decode("utf-8")
        print("=== Server response ===")
        print(body)
except Exception as e:
    print(f"Request failed: {e}")
    print("Is the server running? (uvicorn sync_server:app --port 8001)")
    raise SystemExit(1)

print("\n=== Checking PostgreSQL (care_postgres) directly ===\n")
with get_cursor(commit=False) as cur:
    print("-- Observations for this patient recorded in this test run --")
    cur.execute(
        "SELECT category, field_key, field_value, synced, recorded_at FROM observations WHERE patient_id = %s AND recorded_at = %s",
        (PATIENT_ID, now),
    )
    for r in cur.fetchall():
        print(dict(r))

    print("\n-- Vitals rows for the visit matching this timestamp --")
    cur.execute(
        "SELECT vt.type, vt.value FROM vitals vt JOIN visits v ON v.visit_id = vt.visit_id WHERE v.patient_id = %s AND v.visit_timestamp = %s",
        (PATIENT_ID, now),
    )
    for r in cur.fetchall():
        print(dict(r))

    print("\n-- Most recent prediction row for this patient --")
    cur.execute(
        "SELECT scenario, risk_score, confidence, created_at FROM predictions WHERE patient_id = %s ORDER BY created_at DESC, prediction_id DESC LIMIT 1",
        (PATIENT_ID,),
    )
    print(dict(cur.fetchone()))

