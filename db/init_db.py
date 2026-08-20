"""Run once to create care.db from schema.sql."""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "care.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    with open(SCHEMA_PATH) as f:
        conn.executescript(f.read())
    conn.commit()
    conn.close()
    print(f"Database ready at {DB_PATH}")

if __name__ == "__main__":
    init_db()
