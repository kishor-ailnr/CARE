"""
PostgreSQL Database Pool & Access Module for CARE Central Server.
Replaces SQLite (care.db) for the central server while preserving identical schemas and behavior.
"""

import os
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor, execute_values
from contextlib import contextmanager

DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")

PG_HOST = os.getenv("PG_HOST", "127.0.0.1")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_DB = os.getenv("PG_DB", "care_postgres")
PG_USER = os.getenv("PG_USER", "postgres")
PG_PASSWORD = os.getenv("PG_PASSWORD", "postgres")

# Global Connection Pool
_pool = None

def get_pool():
    global _pool
    if _pool is None or _pool.closed:
        if DATABASE_URL:
            # Handle postgres:// to postgresql:// dialect fix if needed
            dsn = DATABASE_URL
            if dsn.startswith("postgres://"):
                dsn = "postgresql://" + dsn[len("postgres://"):]
            _pool = ThreadedConnectionPool(minconn=1, maxconn=20, dsn=dsn)
        else:
            _pool = ThreadedConnectionPool(
                minconn=1,
                maxconn=20,
                host=PG_HOST,
                port=PG_PORT,
                dbname=PG_DB,
                user=PG_USER,
                password=PG_PASSWORD,
            )
    return _pool

@contextmanager
def get_db():
    """
    Context manager providing a database connection from the pool.
    Auto-commits on exit if no error, auto-rollbacks on exception.
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

@contextmanager
def get_cursor(commit=True):
    """
    Context manager providing a RealDictCursor.
    """
    with get_db() as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        yield cur

def init_pg_schema():
    """
    Creates PostgreSQL schema matching care.db SQLite tables.
    """
    schema_sql = """
    CREATE TABLE IF NOT EXISTS patients (
        patient_id      TEXT PRIMARY KEY,
        source          TEXT,
        dob_estimated   TEXT,
        sex             TEXT,
        condition       TEXT
    );

    CREATE TABLE IF NOT EXISTS visits (
        visit_id        TEXT PRIMARY KEY,
        patient_id      TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        visit_timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vitals (
        vital_id        SERIAL PRIMARY KEY,
        visit_id        TEXT NOT NULL REFERENCES visits(visit_id) ON DELETE CASCADE,
        type            TEXT NOT NULL,
        value           DOUBLE PRECISION NOT NULL,
        unit            TEXT
    );

    CREATE TABLE IF NOT EXISTS predictions (
        prediction_id   SERIAL PRIMARY KEY,
        patient_id      TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        scenario        TEXT NOT NULL,
        risk_score      DOUBLE PRECISION NOT NULL,
        confidence      TEXT,
        explanation     TEXT,
        created_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
        username        TEXT PRIMARY KEY,
        password_hash   TEXT NOT NULL,
        role            TEXT NOT NULL CHECK(role IN ('asha_worker', 'doctor')),
        full_name       TEXT
    );

    CREATE TABLE IF NOT EXISTS patient_photos (
        patient_id      TEXT PRIMARY KEY REFERENCES patients(patient_id) ON DELETE CASCADE,
        photo_path      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observations (
        observation_id  SERIAL PRIMARY KEY,
        patient_id      TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        category        TEXT NOT NULL,
        field_key       TEXT NOT NULL,
        field_value     TEXT,
        recorded_by     TEXT,
        recorded_at     TEXT NOT NULL,
        synced          INT DEFAULT 1
    );

    -- Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits(patient_id);
    CREATE INDEX IF NOT EXISTS idx_vitals_visit_id ON vitals(visit_id);
    CREATE INDEX IF NOT EXISTS idx_vitals_type ON vitals(type);
    CREATE INDEX IF NOT EXISTS idx_vitals_visit_type ON vitals(visit_id, type);
    CREATE INDEX IF NOT EXISTS idx_predictions_patient_id ON predictions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_observations_patient_id ON observations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_observations_synced ON observations(synced);
    """
    with get_cursor(commit=True) as cur:
        cur.execute(schema_sql)

if __name__ == "__main__":
    init_pg_schema()
    print("PostgreSQL schema initialized successfully!")
