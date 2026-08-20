import sqlite3
conn = sqlite3.connect('care.db')
conn.execute("DELETE FROM users WHERE username IN ('asha1', 'doctor1')")
conn.commit()
remaining = conn.execute("SELECT username, role FROM users").fetchall()
conn.close()
print("Remaining users:", remaining)
