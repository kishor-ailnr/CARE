from db_pg import get_cursor

def fix():
    with get_cursor(commit=True) as cur:
        cur.execute("SELECT setval(pg_get_serial_sequence('vitals', 'vital_id'), (SELECT MAX(vital_id) FROM vitals));")
        cur.execute("SELECT setval(pg_get_serial_sequence('predictions', 'prediction_id'), (SELECT MAX(prediction_id) FROM predictions));")
        cur.execute("SELECT setval(pg_get_serial_sequence('observations', 'observation_id'), (SELECT MAX(observation_id) FROM observations));")
        print("Sequences reset successfully!")

if __name__ == "__main__":
    fix()
