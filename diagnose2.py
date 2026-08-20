import sqlite3
conn = sqlite3.connect('care.db')

mismatch = conn.execute("""
    SELECT COUNT(DISTINCT v.patient_id)
    FROM visits v
    LEFT JOIN patients p ON p.patient_id = v.patient_id
    WHERE p.patient_id IS NULL
""").fetchone()[0]
print("visit patient_ids with NO matching patients row:", mismatch)

# how many patients have >=2 visits
multi_visit = conn.execute("""
    SELECT COUNT(*) FROM (
        SELECT patient_id, COUNT(*) as n FROM visits GROUP BY patient_id HAVING n >= 2
    )
""").fetchone()[0]
print("patients with 2+ visits:", multi_visit)

# how many of THOSE visits actually have any vitals attached
visits_with_vitals = conn.execute("""
    SELECT COUNT(DISTINCT visit_id) FROM vitals
""").fetchone()[0]
print("distinct visit_ids that have at least 1 vital:", visits_with_vitals)

# sample check: for one framingham patient, show visit_ids and whether they match vitals visit_ids
sample = conn.execute("SELECT visit_id FROM visits WHERE patient_id='fhm_999'").fetchall()
print("fhm_999 visit_ids:", sample)
sample_vt = conn.execute("SELECT DISTINCT visit_id FROM vitals WHERE visit_id IN (SELECT visit_id FROM visits WHERE patient_id='fhm_999')").fetchall()
print("fhm_999 visit_ids WITH vitals:", sample_vt)
