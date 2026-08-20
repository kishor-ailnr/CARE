"""
Rule-based early-warning detector — your Day 1 checkpoint.
Runs before any ML model exists, so you always have a working demo fallback.

Flags a patient if their vitals of a given type are trending up (or down,
for values where lower is worse) across their last N visits.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "care.db"

# direction: 'up_is_worse' or 'down_is_worse'
RISK_RULES = {
    "systolic_bp": {"direction": "up_is_worse", "threshold_slope": 2.0},
    "glucose":     {"direction": "up_is_worse", "threshold_slope": 3.0},
    "egfr":        {"direction": "down_is_worse", "threshold_slope": -1.5},
}

def get_patient_series(conn, patient_id: str, vital_type: str):
    q = """
        SELECT v.visit_timestamp, vt.value
        FROM visits v
        JOIN vitals vt ON vt.visit_id = v.visit_id
        WHERE v.patient_id = ? AND vt.type = ?
        ORDER BY v.visit_timestamp ASC
    """
    return conn.execute(q, (patient_id, vital_type)).fetchall()

def simple_slope(values):
    """Slope of value vs. visit index — good enough for a rule-based flag."""
    n = len(values)
    if n < 2:
        return None
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den else 0.0

def check_patient(patient_id: str):
    conn = sqlite3.connect(DB_PATH)
    flags = []
    for vital_type, rule in RISK_RULES.items():
        rows = get_patient_series(conn, patient_id, vital_type)
        if len(rows) < 3:
            continue  # cold-start: not enough history to trend
        values = [r[1] for r in rows]
        slope = simple_slope(values)
        worsening = (
            (rule["direction"] == "up_is_worse" and slope >= rule["threshold_slope"])
            or (rule["direction"] == "down_is_worse" and slope <= rule["threshold_slope"])
        )
        if worsening:
            flags.append({
                "vital": vital_type,
                "slope": round(slope, 2),
                "latest": values[-1],
                "n_visits": len(values),
            })
    conn.close()
    return flags

if __name__ == "__main__":
    import sys
    pid = sys.argv[1] if len(sys.argv) > 1 else None
    if not pid:
        print("Usage: python trend_rules.py <patient_id>")
    else:
        flags = check_patient(pid)
        if not flags:
            print(f"No worsening trend detected for patient {pid} "
                  f"(insufficient data or values are stable).")
        for f in flags:
            print(f"⚠ {f['vital']} trending worse: slope={f['slope']}, "
                  f"latest={f['latest']}, over {f['n_visits']} visits")