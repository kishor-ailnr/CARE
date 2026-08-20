import sqlite3
conn = sqlite3.connect('care.db')
n_patients = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
n_visits = conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0]
n_vitals = conn.execute("SELECT COUNT(*) FROM vitals").fetchone()[0]
print("patients:", n_patients, "visits:", n_visits, "vitals:", n_vitals)

sample_patients = conn.execute("SELECT patient_id FROM patients LIMIT 5").fetchall()
print("sample patient_ids:", sample_patients)

sample_visit_pids = conn.execute("SELECT DISTINCT patient_id FROM visits LIMIT 5").fetchall()
print("sample visit patient_ids:", sample_visit_pids)

# check how many visit patient_ids actually exist in patients table
mismatch = conn.execute("""
    SELECT COUNT(DISTINCT v.patient_id)
    FROM visits v
    LEFT JOIN patients p ON p.patient_id = v.patient_id
    WHERE p.patient_id IS NULL
""").fetchone()[0]
print("visit patient_ids with NO matching patients row:", mismatch)
