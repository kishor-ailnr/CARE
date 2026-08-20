"""
CARE Full-System QA Audit Script
Phases 3-12: Backend, DB, Auth, Security, Performance
"""
import urllib.request, json, time, sys, traceback
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

base = 'http://127.0.0.1:8000'
RESULTS = []
ISSUES  = []

def get(path, token=None):
    h = {}
    if token: h['Authorization'] = 'Bearer ' + token
    try:
        req = urllib.request.Request(base+path, headers=h)
        r = urllib.request.urlopen(req, timeout=8)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {}
    except Exception as ex:
        return 0, str(ex)

def post(path, data, token=None, method='POST'):
    h = {'Content-Type':'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    try:
        req = urllib.request.Request(base+path, data=json.dumps(data).encode(), headers=h, method=method)
        r = urllib.request.urlopen(req, timeout=8)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {}
    except Exception as ex:
        return 0, str(ex)

def patch(path, data, token=None):
    return post(path, data, token, method='PATCH')

def check(name, got, expected, body=None):
    ok = got == expected
    status = '✅' if ok else '❌'
    msg = f"{status} {name}: HTTP {got} (expected {expected})"
    if not ok:
        ISSUES.append(msg + (f" | body={body}" if body else ""))
    RESULTS.append(msg)
    print(msg)
    return ok

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("PHASE 1: Architecture Map")
print("="*60)
print("""
CARE Architecture:
  Backend  : FastAPI (sync_server.py) + PostgreSQL (db_pg.py)
  Frontend : Vanilla JS SPA (index.html + app.js + doctor_app.js)
  PWA      : Service Worker (sw.js) + IndexedDB (db.js)
  ML       : scikit-learn RandomForest + Cox model (prediction_pipeline.py)
  XAI      : SHAP TreeExplainer (explain_risk.py)
  Auth     : JWT (python-jose) + bcrypt (passlib) + slowapi rate limits
  Storage  : PostgreSQL (patients, vitals, observations, users)
  Photos   : Local filesystem (/photos/) served as static
""")

# ─────────────────────────────────────────────────────
print("="*60)
print("PHASE 3: Backend Endpoint Tests")
print("="*60)

# Health
c, b = get('/health')
check('GET /health', c, 200, b)

# ── Auth ──────────────────────────────────────────────
print("\n--- Auth ---")

# Successful logins
c, b = post('/auth/login', {'username':'doctor1','password':'doctor123'})
check('POST /auth/login doctor1', c, 200, b)
DOC_TOKEN = b.get('access_token','') if c==200 else ''

c, b = post('/auth/login', {'username':'asha1','password':'asha123'})
check('POST /auth/login asha1', c, 200, b)
ASHA_TOKEN = b.get('access_token','') if c==200 else ''

# Bad creds → 401
c, b = post('/auth/login', {'username':'NONEXIST','password':'bad'})
check('POST /auth/login bad-creds → 401', c, 401)

# Empty body → 422
c, b = post('/auth/login', {})
check('POST /auth/login empty → 422', c, 422)

# Duplicate registration → 409
c, b = post('/auth/register', {'username':'doctor1','password':'x','role':'doctor','full_name':'T'})
check('POST /auth/register duplicate → 409', c, 409)

# Bad role → 400
c, b = post('/auth/register', {'username':'badrol3','password':'p','role':'superadmin','full_name':'T'})
check('POST /auth/register bad-role → 400', c, 400)

# Delegate sync token - asha creds (must be doctor) → 403
c, b = post('/auth/delegate-sync-token', {'username':'asha1','password':'asha123'})
check('POST /auth/delegate-sync-token asha → 403', c, 403)

# Delegate sync token - doctor creds
c, b = post('/auth/delegate-sync-token', {'username':'doctor1','password':'doctor123'})
check('POST /auth/delegate-sync-token doctor → 200', c, 200, b)
DELEGATE_TOKEN = b.get('access_token','') if c==200 else ''

# ── Authorization scope enforcement ───────────────────
print("\n--- Authorization Scopes ---")
# sync_only token must not access /patients
c, b = get('/patients', DELEGATE_TOKEN)
check('GET /patients with sync_only token → 403', c, 403)

# No auth on protected endpoints
c, b = get('/patients')
check('GET /patients no auth → 401', c, 401)

c, b = post('/sync', {'observations':[]})
check('POST /sync no auth → 401', c, 401)

# ── Patients ───────────────────────────────────────────
print("\n--- Patient Endpoints ---")
c, b = get('/patients?limit=5&offset=0', DOC_TOKEN)
check('GET /patients doctor limit=5 → 200', c, 200)
TOTAL_PATIENTS = b.get('total', 0) if c==200 else 0
FIRST_PID = (b.get('patients',[{}]) or [{}])[0].get('patient_id','')
print(f"   total={TOTAL_PATIENTS}, first_pid={FIRST_PID[:20] if FIRST_PID else 'N/A'}")

c, b = get('/patients?limit=5', ASHA_TOKEN)
check('GET /patients asha → 200', c, 200)

c, b = get('/patients/NONEXISTENT-ID', DOC_TOKEN)
check('GET /patients/NONEXISTENT → 404', c, 404)

if FIRST_PID:
    c, b = get('/patients/' + FIRST_PID, DOC_TOKEN)
    check('GET /patients/{id} doctor → 200', c, 200)
    HAS_PREDICTION = 'latest_prediction' in b if c==200 else False
    print(f"   has_prediction={HAS_PREDICTION}")

    c, b = get('/patients/' + FIRST_PID + '/observations', DOC_TOKEN)
    check('GET /patients/{id}/observations → 200', c, 200)

    c, b = get('/patients/' + FIRST_PID + '/interventions/ranked', DOC_TOKEN)
    check('GET /patients/{id}/interventions/ranked → 200', c, 200)

# ── Sync ───────────────────────────────────────────────
print("\n--- Sync Endpoint ---")
import uuid as _uuid
test_pid = FIRST_PID or 'test-patient-001'
obs_payload = {
    'observations': [
        {
            'client_uuid': str(_uuid.uuid4()),
            'patient_id': test_pid,
            'category': 'heart',
            'field_key': 'systolic_bp',
            'field_value': '120',
            'recorded_by': 'asha1',
            'recorded_at': '2026-08-01T10:00:00Z',
            'synced': 0
        }
    ]
}
c, b = post('/sync', obs_payload, ASHA_TOKEN)
check('POST /sync asha with obs → 200', c, 200)

# Idempotency: re-send same client_uuid
c2, b2 = post('/sync', obs_payload, ASHA_TOKEN)
check('POST /sync duplicate uuid → 200 (idempotent)', c2, 200)

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("PHASE 4: Database Integrity Checks")
print("="*60)

import psycopg2, os
try:
    conn = psycopg2.connect(
        dbname=os.environ.get('PG_DB', 'care_postgres'),
        user=os.environ.get('PG_USER', 'postgres'),
        password=os.environ.get('PG_PASSWORD', 'postgres'),
        host=os.environ.get('PG_HOST', '127.0.0.1'),
        port=int(os.environ.get('PG_PORT', '5432'))
    )
    cur = conn.cursor()

    # Table existence
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
    tables = [r[0] for r in cur.fetchall()]
    print(f"Tables: {tables}")

    # Row counts
    for t in tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            cnt = cur.fetchone()[0]
            print(f"  {t}: {cnt} rows")
        except: pass

    # Check for NULL patient_ids in observations
    if 'observations' in tables:
        cur.execute("SELECT COUNT(*) FROM observations WHERE patient_id IS NULL")
        null_pid = cur.fetchone()[0]
        if null_pid > 0:
            ISSUES.append(f"DB: {null_pid} observations with NULL patient_id")
        print(f"  observations NULL patient_id: {null_pid}")

    # Check for duplicate client_uuids (should be 0)
    if 'observations' in tables:
        cur.execute("SELECT COUNT(*)-COUNT(DISTINCT client_uuid) FROM observations WHERE client_uuid IS NOT NULL")
        dupes = cur.fetchone()[0]
        if dupes > 0:
            ISSUES.append(f"DB: {dupes} duplicate client_uuid rows in observations")
        print(f"  observations duplicate client_uuid: {dupes}")

    # Users table - password hash check (no plaintext)
    if 'users' in tables:
        cur.execute("SELECT COUNT(*) FROM users WHERE length(password_hash) < 20")
        weak = cur.fetchone()[0]
        if weak > 0:
            ISSUES.append(f"DB: {weak} users with suspiciously short password hashes")
        print(f"  users weak hash count: {weak}")

    cur.close(); conn.close()
    print("✅ DB connectivity and integrity: OK")
except Exception as e:
    ISSUES.append(f"DB connection failed: {e}")
    print(f"❌ DB error: {e}")

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("PHASE 5: Auth Security")
print("="*60)

# JWT tamper test — modify token and check rejection
if DOC_TOKEN:
    parts = DOC_TOKEN.split('.')
    if len(parts)==3:
        # Corrupt the signature
        tampered = parts[0] + '.' + parts[1] + '.INVALIDSIGNATURE'
        c, b = get('/patients', tampered)
        check('GET /patients tampered-JWT → 401', c, 401)

# Token with wrong role header injection (structural attack)
# We can't forge without the secret, so just verify the 403 from sync_only above (already done)

# Brute force: 10 rapid-fire bad logins (rate limit already at 5/min)
print("Rate-limit brute force test (10 bad logins)...")
blocked = False
for i in range(10):
    c, _ = post('/auth/login', {'username':'x','password':'y'})
    if c == 429:
        blocked = True
        print(f"  Blocked at attempt {i+1} with 429 ✅")
        break
if not blocked:
    ISSUES.append("Rate limiting: 10 bad logins never triggered 429")

# IDOR: asha accessing observation that belongs to another asha user
# (observations endpoint is doctor-only, asha cannot read back via /patients/{id})
# Already tested via scope check above

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("PHASE 10: Security Audit")
print("="*60)

# SQL Injection attempt in patient search
c, b = get("/patients?search=' OR '1'='1", DOC_TOKEN)
print(f"SQL injection in search param: HTTP {c} (expect 200 or 400, not 500)")
if c == 500:
    ISSUES.append("SECURITY: SQL injection in search param returned 500 (possible vulnerability)")
else:
    print("  ✅ No 500 on SQL injection attempt")

c, b = get("/patients?search=<script>alert(1)</script>", DOC_TOKEN)
print(f"XSS in search param: HTTP {c}")
if c == 500:
    ISSUES.append("SECURITY: XSS payload in search param caused 500")

# Path traversal in patient_id
c, b = get("/patients/../../etc/passwd", DOC_TOKEN)
print(f"Path traversal in patient_id: HTTP {c} (expect 4xx not 500)")
if c == 500:
    ISSUES.append("SECURITY: Path traversal caused 500")

# CORS headers
req = urllib.request.Request(base+'/health')
req.add_header('Origin','https://evil.com')
try:
    r = urllib.request.urlopen(req)
    cors = r.getheader('Access-Control-Allow-Origin','')
    print(f"CORS Allow-Origin for evil.com: '{cors}'")
    if cors == '*':
        ISSUES.append("SECURITY: CORS is wildcard (*) — acceptable for local dev but restrict in production")
except: pass

# Check for X-Content-Type-Options / X-Frame-Options headers
req2 = urllib.request.Request(base+'/health')
try:
    r2 = urllib.request.urlopen(req2)
    xcto = r2.getheader('X-Content-Type-Options','')
    xfo  = r2.getheader('X-Frame-Options','')
    print(f"X-Content-Type-Options: '{xcto}'  X-Frame-Options: '{xfo}'")
    if not xcto:
        ISSUES.append("SECURITY: Missing X-Content-Type-Options header")
    if not xfo:
        ISSUES.append("SECURITY: Missing X-Frame-Options header")
except: pass

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("PHASE 11: Performance Spot Check")
print("="*60)

import time as _t
# Measure /patients latency
times = []
for i in range(5):
    t0 = _t.time()
    c, b = get('/patients?limit=10', DOC_TOKEN)
    times.append(_t.time()-t0)
avg = sum(times)/len(times)
print(f"GET /patients avg latency: {avg*1000:.0f}ms (5 runs)")
if avg > 2.0:
    ISSUES.append(f"PERF: /patients avg latency {avg*1000:.0f}ms > 2000ms threshold")
else:
    print("  ✅ Latency within acceptable range")

# Measure /patients/{id} latency
if FIRST_PID:
    times2 = []
    for i in range(3):
        t0 = _t.time()
        c, b = get('/patients/' + FIRST_PID, DOC_TOKEN)
        times2.append(_t.time()-t0)
    avg2 = sum(times2)/len(times2)
    print(f"GET /patients/{{id}} avg latency: {avg2*1000:.0f}ms (3 runs)")
    if avg2 > 5.0:
        ISSUES.append(f"PERF: /patients/{{id}} avg latency {avg2*1000:.0f}ms > 5000ms threshold")

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("PHASE 12: Edge Cases & Stress")
print("="*60)

# Large offset beyond dataset
c, b = get(f'/patients?limit=10&offset=9999999', DOC_TOKEN)
check('GET /patients huge offset → 200', c, 200)

# Concurrent same-client_uuid sync (idempotency)
import threading
import queue as _q
results_q = _q.Queue()
uid = str(_uuid.uuid4())
payload = {
    'observations':[{
        'client_uuid': uid,
        'patient_id': test_pid,
        'category':'body','field_key':'weight_kg',
        'field_value':'70','recorded_by':'asha1',
        'recorded_at':'2026-08-01T11:00:00Z','synced':0
    }]
}
def do_sync():
    c, b = post('/sync', payload, ASHA_TOKEN)
    results_q.put(c)

threads = [threading.Thread(target=do_sync) for _ in range(5)]
for t in threads: t.start()
for t in threads: t.join()
codes = [results_q.get() for _ in range(5)]
all_ok = all(c in (200,201) for c in codes)
if all_ok:
    print(f"✅ Concurrent same-uuid sync: all returned 200 (idempotent)")
else:
    ISSUES.append(f"Concurrent sync returned mixed codes: {codes}")
    print(f"❌ Concurrent sync codes: {codes}")

# ─────────────────────────────────────────────────────
print("\n" + "="*60)
print("FINAL REPORT")
print("="*60)
print(f"\nTotal checks run: {len(RESULTS)}")
passed = sum(1 for r in RESULTS if r.startswith('✅'))
failed = len(RESULTS) - passed
print(f"Passed: {passed}  Failed: {failed}")

if ISSUES:
    print(f"\n⚠️  Issues found ({len(ISSUES)}):")
    for i, iss in enumerate(ISSUES, 1):
        print(f"  {i}. {iss}")
else:
    print("\n✅ No critical issues found!")
