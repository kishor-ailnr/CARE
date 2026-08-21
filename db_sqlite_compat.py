"""
SQLite-compatible drop-in replacement for db_pg.py.

Uses the existing care.db SQLite database so the sync_server can run
locally without PostgreSQL.  The context-manager API (get_cursor / get_db)
is identical to db_pg.py, but the cursor wraps sqlite3.Row to behave like
psycopg2's RealDictCursor (i.e. each row is subscriptable by column name
and dict()-able).
"""

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "care.db"

# Thread-local storage for connections (one connection per thread)
_local = threading.local()


class DictRow:
    """Wraps a sqlite3.Row to behave like a psycopg2 RealDictRow."""
    def __init__(self, row: sqlite3.Row):
        self._row = row

    def __getitem__(self, key):
        return self._row[key]

    def get(self, key, default=None):
        try:
            return self._row[key]
        except (IndexError, KeyError):
            return default

    def keys(self):
        return self._row.keys()

    def __iter__(self):
        return iter(self._row.keys())

    def items(self):
        return ((k, self._row[k]) for k in self._row.keys())

    def __repr__(self):
        return dict(self.items()).__repr__()


def _adapt_sql(sql: str) -> str:
    """
    Convert PostgreSQL-style SQL to SQLite-compatible SQL.

    Transformations:
      - %s  → ?  (placeholder style)
      - SERIAL PRIMARY KEY → INTEGER PRIMARY KEY AUTOINCREMENT
      - TIMESTAMPTZ → TEXT
      - ON CONFLICT (x) DO NOTHING → OR IGNORE (handled at execute level)
      - ADD COLUMN IF NOT EXISTS → ADD COLUMN (SQLite errors if column exists,
        so we wrap those in try/except at the execute level)
      - DROP INDEX IF EXISTS → supported by SQLite, kept as-is
      - CREATE UNIQUE INDEX IF NOT EXISTS → supported, kept as-is
    """
    import re
    sql = sql.replace("%s", "?")
    sql = re.sub(r"\bILIKE\b", "LIKE", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bNOW\(\)", "CURRENT_TIMESTAMP", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bSERIAL\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bTIMESTAMPTZ\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDOUBLE PRECISION\b", "REAL", sql, flags=re.IGNORECASE)
    return sql


class _SQLiteCursor:
    """Wraps sqlite3.Cursor to expose psycopg2-like API."""
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        self._cur = conn.cursor()

    def execute(self, sql: str, params=None):
        adapted = _adapt_sql(sql)
        # Handle ALTER TABLE ... ADD COLUMN IF NOT EXISTS
        import re
        if re.search(r"ALTER TABLE\s+\S+\s+ADD COLUMN IF NOT EXISTS", adapted, re.IGNORECASE):
            adapted = re.sub(r"IF NOT EXISTS\s+", "", adapted, count=1, flags=re.IGNORECASE)
            try:
                if params:
                    self._cur.execute(adapted, params)
                else:
                    self._cur.execute(adapted)
            except sqlite3.OperationalError as e:
                if "duplicate column" in str(e).lower():
                    pass  # Column already exists — ignore
                else:
                    raise
            return self

        # Handle INSERT ... ON CONFLICT (col) DO NOTHING → INSERT OR IGNORE
        if re.search(r"^\s*INSERT\b", adapted, re.IGNORECASE) and "ON CONFLICT" not in adapted.upper():
            pass  # Normal insert, no change needed

        if params:
            self._cur.execute(adapted, params)
        else:
            self._cur.execute(adapted)
        return self

    def executemany(self, sql: str, params_seq):
        adapted = _adapt_sql(sql)
        self._cur.executemany(adapted, params_seq)
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        return DictRow(row) if row is not None else None

    def fetchall(self):
        return [DictRow(r) for r in self._cur.fetchall()]

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    def __iter__(self):
        for row in self._cur:
            yield DictRow(row)


class _SQLiteConn:
    """Wraps sqlite3.Connection to behave like a psycopg2 connection."""
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        self.autocommit = False

    def cursor(self, cursor_factory=None):
        return _SQLiteCursor(self._conn)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def _get_raw_conn() -> sqlite3.Connection:
    """Returns a thread-local SQLite connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # Enable WAL mode for better concurrency
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn


@contextmanager
def get_db():
    """Context manager providing a database connection (Postgres if DATABASE_URL is set, else SQLite)."""
    import os
    if os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL"):
        import db_pg
        with db_pg.get_db() as conn:
            yield conn
        return

    raw = _get_raw_conn()
    conn = _SQLiteConn(raw)
    try:
        yield conn
        if not conn.autocommit:
            raw.commit()
    except Exception:
        raw.rollback()
        raise


@contextmanager
def get_cursor(commit=True):
    """Context manager providing a dict-cursor (Postgres if DATABASE_URL is set, else SQLite)."""
    import os
    if os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL"):
        import db_pg
        with db_pg.get_cursor(commit=commit) as cur:
            yield cur
        return

    with get_db() as conn:
        cur = conn.cursor()
        yield cur


def init_sqlite_schema():
    """
    Ensure all required tables exist in care.db.
    Uses SQLite-compatible DDL. Handles pre-existing tables gracefully.
    """
    schema = """
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
        vital_id        INTEGER PRIMARY KEY AUTOINCREMENT,
        visit_id        TEXT NOT NULL REFERENCES visits(visit_id) ON DELETE CASCADE,
        type            TEXT NOT NULL,
        value           REAL NOT NULL,
        unit            TEXT
    );

    CREATE TABLE IF NOT EXISTS predictions (
        prediction_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id      TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        scenario        TEXT NOT NULL,
        risk_score      REAL NOT NULL,
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
        observation_id  INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id      TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        category        TEXT NOT NULL,
        field_key       TEXT NOT NULL,
        field_value     TEXT,
        recorded_by     TEXT,
        recorded_at     TEXT NOT NULL,
        synced          INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sync_audit_log (
        log_id               INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_username      TEXT NOT NULL,
        device_install_id    TEXT,
        sync_started_at      TEXT NOT NULL DEFAULT (datetime('now')),
        sync_completed_at    TEXT,
        patients_synced_count INTEGER DEFAULT 0,
        mode                 TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits(patient_id);
    CREATE INDEX IF NOT EXISTS idx_vitals_visit_id ON vitals(visit_id);
    CREATE INDEX IF NOT EXISTS idx_vitals_type ON vitals(type);
    CREATE INDEX IF NOT EXISTS idx_predictions_patient_id ON predictions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_observations_patient_id ON observations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_observations_synced ON observations(synced);
    """
    raw = _get_raw_conn()
    raw.executescript(schema)

    # Migrate: add client_uuid column if not present (existing deployments)
    cols = [row[1] for row in raw.execute("PRAGMA table_info(observations)").fetchall()]
    if "client_uuid" not in cols:
        raw.execute("ALTER TABLE observations ADD COLUMN client_uuid TEXT")

    # Create the unique index — ignore if already exists
    try:
        raw.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_client_uuid "
            "ON observations(client_uuid)"
        )
    except Exception:
        pass

    raw.commit()


if __name__ == "__main__":
    init_sqlite_schema()
    print("SQLite schema initialized successfully!")
