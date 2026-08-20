import sqlite3
conn = sqlite3.connect('care.db')
rows = conn.execute("""
    SELECT v.patient_id, COUNT(*) as n
    FROM visits v JOIN vitals vt ON vt.visit_id = v.visit_id
    WHERE vt.type='systolic_bp'
    GROUP BY v.patient_id
    HAVING n >= 3
    ORDER BY n DESC
    LIMIT 5
""").fetchall()
print(rows)
