import sqlite3
conn = sqlite3.connect('care.db')
rows = conn.execute("SELECT patient_id FROM patients WHERE source='synthea' LIMIT 5").fetchall()
print(rows)
