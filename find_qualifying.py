import sqlite3
conn = sqlite3.connect('care.db')
rows = conn.execute("""
    SELECT v.patient_id, v.visit_id, vt.type
    FROM visits v JOIN vitals vt ON vt.visit_id = v.visit_id
    WHERE vt.type IN ('systolic_bp','diastolic_bp','heart_rate','bmi')
""").fetchall()

from collections import defaultdict
visit_types = defaultdict(set)
for pid, vid, vtype in rows:
    visit_types[(pid, vid)].add(vtype)

complete_visits = defaultdict(int)
for (pid, vid), types in visit_types.items():
    if {'systolic_bp','diastolic_bp','heart_rate','bmi'}.issubset(types):
        complete_visits[pid] += 1

qualifying = [pid for pid, count in complete_visits.items() if count >= 2]
print(f"Patients with 2+ fully-complete visits: {len(qualifying)}")
print("Sample IDs:", qualifying[:5])
