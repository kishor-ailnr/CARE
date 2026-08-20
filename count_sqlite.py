import sqlite3
c = sqlite3.connect("care.db")
tables = ["patients", "visits", "vitals", "predictions", "observations"]
for t in tables:
    count = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(t, count)
