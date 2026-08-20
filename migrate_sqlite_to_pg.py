"""
One-time SQLite to PostgreSQL Data Migration Script for CARE.
Reads all rows from care.db (SQLite) and inserts them into care_postgres (PostgreSQL).
Handles missing foreign keys (visits) by auto-creating placeholders.
"""

import time
import sqlite3
import psycopg2
from psycopg2.extras import execute_values
from db_pg import get_db, init_pg_schema, PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD

SQLITE_DB = "care.db"

def migrate():
    start_time = time.time()
    print("=== Starting One-Time SQLite -> PostgreSQL Data Migration ===")
    
    # 1. Initialize Schema
    init_pg_schema()
    
    sq_conn = sqlite3.connect(SQLITE_DB)
    sq_conn.row_factory = sqlite3.Row
    sq_cur = sq_conn.cursor()

    pg_conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    pg_conn.autocommit = False
    pg_cur = pg_conn.cursor()

    try:
        # Table 1: patients
        print("Migrating 'patients'...")
        p_rows = sq_cur.execute("SELECT patient_id, source, dob_estimated, sex, condition FROM patients").fetchall()
        p_tuples = [(r['patient_id'], r['source'], r['dob_estimated'], r['sex'], r['condition']) for r in p_rows]
        execute_values(
            pg_cur,
            "INSERT INTO patients (patient_id, source, dob_estimated, sex, condition) VALUES %s ON CONFLICT (patient_id) DO NOTHING",
            p_tuples,
            page_size=5000
        )
        print(f"  -> Migrated {len(p_tuples)} patients.")
        pg_conn.commit()

        # Table 2: users
        print("Migrating 'users'...")
        u_rows = sq_cur.execute("SELECT username, password_hash, role, full_name FROM users").fetchall()
        u_tuples = [(r['username'], r['password_hash'], r['role'], r['full_name']) for r in u_rows]
        execute_values(
            pg_cur,
            "INSERT INTO users (username, password_hash, role, full_name) VALUES %s ON CONFLICT (username) DO NOTHING",
            u_tuples,
            page_size=1000
        )
        print(f"  -> Migrated {len(u_tuples)} users.")
        pg_conn.commit()

        # Table 3: patient_photos
        print("Migrating 'patient_photos'...")
        photo_rows = sq_cur.execute("SELECT patient_id, photo_path FROM patient_photos").fetchall()
        photo_tuples = [(r['patient_id'], r['photo_path']) for r in photo_rows]
        if photo_tuples:
            execute_values(
                pg_cur,
                "INSERT INTO patient_photos (patient_id, photo_path) VALUES %s ON CONFLICT (patient_id) DO NOTHING",
                photo_tuples,
                page_size=1000
            )
        print(f"  -> Migrated {len(photo_tuples)} patient photos.")
        pg_conn.commit()

        # Table 4: visits
        print("Migrating 'visits'...")
        v_rows = sq_cur.execute("SELECT visit_id, patient_id, visit_timestamp FROM visits").fetchall()
        v_tuples = [(r['visit_id'], r['patient_id'], r['visit_timestamp']) for r in v_rows]
        execute_values(
            pg_cur,
            "INSERT INTO visits (visit_id, patient_id, visit_timestamp) VALUES %s ON CONFLICT (visit_id) DO NOTHING",
            v_tuples,
            page_size=10000
        )
        print(f"  -> Migrated {len(v_tuples)} visits.")
        pg_conn.commit()

        # Auto-create missing visit_ids referenced by vitals
        print("Checking missing visit references in vitals...")
        missing_v_rows = sq_cur.execute("""
            SELECT DISTINCT v.visit_id
            FROM vitals v
            LEFT JOIN visits vis ON v.visit_id = vis.visit_id
            WHERE vis.visit_id IS NULL
        """).fetchall()
        if missing_v_rows:
            print(f"  -> Found {len(missing_v_rows)} vitals referencing missing visits. Auto-creating visit records...")
            missing_v_tuples = []
            for r in missing_v_rows:
                v_id = r['visit_id']
                # Infer patient_id if visit_id follows convention patient_id_timestamp
                parts = v_id.rsplit('_', 1)
                p_id = parts[0] if len(parts) > 1 else v_id
                ts = parts[1] if len(parts) > 1 else '1970-01-01T00:00:00'
                # Ensure patient_id exists in patients table first
                pg_cur.execute(
                    "INSERT INTO patients (patient_id, source, dob_estimated, sex, condition) VALUES (%s, 'synthea', NULL, NULL, 'cardiovascular') ON CONFLICT (patient_id) DO NOTHING",
                    (p_id,)
                )
                missing_v_tuples.append((v_id, p_id, ts))
            execute_values(
                pg_cur,
                "INSERT INTO visits (visit_id, patient_id, visit_timestamp) VALUES %s ON CONFLICT (visit_id) DO NOTHING",
                missing_v_tuples,
                page_size=5000
            )
            pg_conn.commit()

        # Table 5: vitals
        print("Migrating 'vitals'...")
        vital_rows = sq_cur.execute("SELECT vital_id, visit_id, type, value, unit FROM vitals").fetchall()
        vital_tuples = [(r['vital_id'], r['visit_id'], r['type'], r['value'], r['unit']) for r in vital_rows]
        execute_values(
            pg_cur,
            "INSERT INTO vitals (vital_id, visit_id, type, value, unit) VALUES %s ON CONFLICT (vital_id) DO NOTHING",
            vital_tuples,
            page_size=10000
        )
        print(f"  -> Migrated {len(vital_tuples)} vitals.")
        pg_conn.commit()

        # Table 6: predictions
        print("Migrating 'predictions'...")
        pred_rows = sq_cur.execute("SELECT prediction_id, patient_id, scenario, risk_score, confidence, explanation, created_at FROM predictions").fetchall()
        pred_tuples = [(r['prediction_id'], r['patient_id'], r['scenario'], r['risk_score'], r['confidence'], r['explanation'], r['created_at']) for r in pred_rows]
        if pred_tuples:
            execute_values(
                pg_cur,
                "INSERT INTO predictions (prediction_id, patient_id, scenario, risk_score, confidence, explanation, created_at) VALUES %s ON CONFLICT (prediction_id) DO NOTHING",
                pred_tuples,
                page_size=1000
            )
        print(f"  -> Migrated {len(pred_tuples)} predictions.")
        pg_conn.commit()

        # Table 7: observations
        print("Migrating 'observations'...")
        obs_rows = sq_cur.execute("SELECT observation_id, patient_id, category, field_key, field_value, recorded_by, recorded_at, synced FROM observations").fetchall()
        obs_tuples = [(r['observation_id'], r['patient_id'], r['category'], r['field_key'], r['field_value'], r['recorded_by'], r['recorded_at'], r['synced']) for r in obs_rows]
        if obs_tuples:
            execute_values(
                pg_cur,
                "INSERT INTO observations (observation_id, patient_id, category, field_key, field_value, recorded_by, recorded_at, synced) VALUES %s ON CONFLICT (observation_id) DO NOTHING",
                obs_tuples,
                page_size=1000
            )
        print(f"  -> Migrated {len(obs_tuples)} observations.")
        pg_conn.commit()

        # Sync sequences
        print("Resetting PostgreSQL primary key sequences...")
        pg_cur.execute("SELECT setval('vitals_vital_id_seq', COALESCE((SELECT MAX(vital_id) FROM vitals), 1));")
        pg_cur.execute("SELECT setval('predictions_prediction_id_seq', COALESCE((SELECT MAX(prediction_id) FROM predictions), 1));")
        pg_cur.execute("SELECT setval('observations_observation_id_seq', COALESCE((SELECT MAX(observation_id) FROM observations), 1));")
        pg_conn.commit()

        elapsed = time.time() - start_time
        print(f"=== Migration Completed Successfully in {elapsed:.2f} seconds! ===")

    except Exception as e:
        pg_conn.rollback()
        print("Migration failed with error:", e)
        raise
    finally:
        sq_conn.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()
