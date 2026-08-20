"""
Extends care.db with tables needed for the role-based ASHA worker / Doctor
dashboard: user accounts, patient profile photos, and flexible
category-based observations (eye, skin, heart, body, etc.) beyond the
core numeric vitals already tracked.

Run this once: python extend_schema.py
Safe to re-run — uses CREATE TABLE IF NOT EXISTS throughout.
"""
import sqlite3
import hashlib
from pathlib import Path

DB_PATH = Path(__file__).parent / "care.db"

# Category definitions: each maps to a set of fields an ASHA worker or
# doctor can fill in. 'type' controls what input widget the dashboard uses.
CATEGORIES = {
    "eye": {
        "label": "👁️ Eye Related",
        "fields": [
            {"key": "vision_left", "label": "Left Eye Vision (e.g. 6/6)", "type": "text"},
            {"key": "vision_right", "label": "Right Eye Vision (e.g. 6/6)", "type": "text"},
            {"key": "redness", "label": "Redness/Irritation?", "type": "bool"},
            {"key": "notes", "label": "Notes", "type": "text"},
        ],
    },
    "skin": {
        "label": "🧴 Skin Related",
        "fields": [
            {"key": "rash_present", "label": "Rash Present?", "type": "bool"},
            {"key": "wound_present", "label": "Wound/Injury Present?", "type": "bool"},
            {"key": "notes", "label": "Notes", "type": "text"},
        ],
    },
    "body": {
        "label": "🧍 Body Related",
        "fields": [
            {"key": "height_cm", "label": "Height (cm)", "type": "number"},
            {"key": "weight_kg", "label": "Weight (kg)", "type": "number"},
            {"key": "temperature_c", "label": "Body Temperature (°C)", "type": "number"},
            {"key": "notes", "label": "Notes", "type": "text"},
        ],
    },
    "heart": {
        "label": "🫀 Heart Related",
        "fields": [
            {"key": "systolic_bp", "label": "Systolic BP (mmHg)", "type": "number"},
            {"key": "diastolic_bp", "label": "Diastolic BP (mmHg)", "type": "number"},
            {"key": "heart_rate", "label": "Heart Rate (bpm)", "type": "number"},
            {"key": "chest_pain", "label": "Chest Pain Reported?", "type": "bool"},
            {"key": "notes", "label": "Notes", "type": "text"},
        ],
    },
}

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def extend():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('asha_worker', 'doctor')),
            full_name TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS patient_photos (
            patient_id TEXT PRIMARY KEY,
            photo_path TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS observations (
            observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT NOT NULL,
            category TEXT NOT NULL,
            field_key TEXT NOT NULL,
            field_value TEXT,
            recorded_by TEXT,
            recorded_at TEXT NOT NULL,
            synced INTEGER DEFAULT 1,
            FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        )
    """)

    # Seed two demo accounts so login works immediately (change/remove for
    # real deployment — these are just for development/demo purposes)
    demo_users = [
        ("asha1", hash_password("asha123"), "asha_worker", "Priya (ASHA Worker)"),
        ("doctor1", hash_password("doctor123"), "doctor", "Dr. Kumar"),
    ]
    for username, pw_hash, role, full_name in demo_users:
        cur.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, role, full_name) VALUES (?, ?, ?, ?)",
            (username, pw_hash, role, full_name),
        )

    conn.commit()
    conn.close()
    print("Schema extended: users, patient_photos, observations tables ready.")
    print("Demo accounts — ASHA worker: asha1 / asha123 | Doctor: doctor1 / doctor123")

if __name__ == "__main__":
    extend()