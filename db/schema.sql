-- CARE local data store (SQLite)
-- Mirrors the "Central Longitudinal Health Data Store" from the architecture,
-- scaled down to what one disease MVP actually needs.

CREATE TABLE IF NOT EXISTS patients (
    patient_id      TEXT PRIMARY KEY,
    source          TEXT,           -- 'synthea' or 'uci_diabetes' etc.
    dob_estimated   TEXT,
    sex             TEXT,
    condition       TEXT            -- the single disease this build targets
);

CREATE TABLE IF NOT EXISTS visits (
    visit_id        TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    visit_timestamp TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
);

CREATE TABLE IF NOT EXISTS vitals (
    vital_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id        TEXT NOT NULL,
    type            TEXT NOT NULL,  -- e.g. 'systolic_bp', 'glucose', 'bmi'
    value           REAL NOT NULL,
    unit            TEXT,
    FOREIGN KEY (visit_id) REFERENCES visits(visit_id)
);

CREATE INDEX IF NOT EXISTS idx_visits_patient_time
    ON visits(patient_id, visit_timestamp);

CREATE INDEX IF NOT EXISTS idx_vitals_visit_type
    ON vitals(visit_id, type);

-- Predictions get written here so the digital twin, intervention engine,
-- and XAI layer all read/write from one place instead of passing objects around.
CREATE TABLE IF NOT EXISTS predictions (
    prediction_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id      TEXT NOT NULL,
    scenario        TEXT NOT NULL,  -- 'baseline' or a named intervention
    risk_score      REAL NOT NULL,
    confidence      TEXT,           -- 'high' / 'medium' / 'low'
    explanation     TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
);
