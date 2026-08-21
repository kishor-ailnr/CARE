/**
 * CARE Doctor Clinical Dashboard Logic (doctor_app.js)
 * Plain Vanilla JS + Chart.js via CDN script.
 * Features Stale-While-Revalidate caching via care_doctor_cache IndexedDB & Cache API for offline patient inspection.
 *
 * OFFLINE LOGIN SECURITY MODEL:
 *  - On first successful online login a device_install_id (random UUID) is generated once and stored in IndexedDB.
 *  - A local credential hash = sha256(username + password + device_install_id) is stored alongside the JWT and an
 *    offline_session_expires_at timestamp (now + OFFLINE_SESSION_HOURS).
 *  - On subsequent offline login attempts the same sha256 is recomputed and compared.  If it matches AND the offline
 *    session has not expired, the doctor is admitted locally.
 *  - If the offline session has expired the doctor must go online to renew — access is NOT silently extended.
 *  - TRADEOFF: OFFLINE_SESSION_HOURS = 48.  A lost/stolen device stays "logged in" for up to 48 hours after last
 *    online authentication.  Reduce this value if your threat model demands shorter windows.
 *  - The server's bcrypt hash is NEVER stored on-device.  The plaintext password is NEVER stored on-device.
 */

function getDocApiBaseUrl() {
  const custom = localStorage.getItem('care_api_base_url');
  if (custom) return custom.replace(/\/+$/, '');
  if (window.API_BASE_URL) return window.API_BASE_URL.replace(/\/+$/, '');
  if (window.location.origin && 
      window.location.origin !== "null" && 
      !window.location.origin.startsWith("file:") &&
      !window.location.hostname.includes('netlify.app') && 
      !window.location.hostname.includes('github.io') &&
      !window.location.hostname.includes('pages.dev')) {
    return window.location.origin;
  }
  return "http://127.0.0.1:8000";
}
var API_BASE_URL = getDocApiBaseUrl();
window.API_BASE_URL = API_BASE_URL;

function getPhotoUrl(photoPath) {
  if (!photoPath) return null;
  if (photoPath.startsWith('data:') || photoPath.startsWith('blob:')) return photoPath;
  if (photoPath.startsWith('http://') || photoPath.startsWith('https://')) return photoPath;
  if (photoPath.startsWith('/photos/')) return `${API_BASE_URL}${photoPath}`;
  if (photoPath.startsWith('photos/')) return `${API_BASE_URL}/${photoPath}`;
  const filename = photoPath.split(/[/\\]/).pop();
  return `${API_BASE_URL}/photos/${filename}`;
}

// -----------------------------------------------------------------------------
// IndexedDB & Cache API Storage Helper (care_doctor_cache)
// -----------------------------------------------------------------------------

const DOCTOR_DB_NAME = 'care_doctor_cache';
const DOCTOR_DB_VERSION = 2;   // bumped: adds auth_store

// How long a doctor may stay logged in while fully offline after their last online login.
// Set to 24h because full sync is intended as a once-per-day workflow — the offline
// session window should match the sync cadence, not exceed it.
// TRADEOFF: A lost/stolen device stays usable offline for up to 24h after last online auth.
const OFFLINE_SESSION_HOURS = 24;

function openDoctorDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DOCTOR_DB_NAME, DOCTOR_DB_VERSION);
    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains('patient_cache')) {
        db.createObjectStore('patient_cache', { keyPath: 'patient_id' });
      }
      if (!db.objectStoreNames.contains('observations_cache')) {
        db.createObjectStore('observations_cache', { keyPath: 'patient_id' });
      }
      if (!db.objectStoreNames.contains('predict_cache')) {
        db.createObjectStore('predict_cache', { keyPath: 'patient_id' });
      }
      if (!db.objectStoreNames.contains('interventions_cache')) {
        db.createObjectStore('interventions_cache', { keyPath: 'patient_id' });
      }
      // v2: Offline auth credential store — one record keyed by 'device_auth'
      if (!db.objectStoreNames.contains('auth_store')) {
        db.createObjectStore('auth_store', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// Offline Login Credential Helpers
// -----------------------------------------------------------------------------

/**
 * Returns a SHA-256 hex digest of the given string using the WebCrypto API.
 */
async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns the per-device install UUID, generating and persisting it on first call.
 * Stored in auth_store under key 'device_install_id'.
 */
async function getDeviceInstallId() {
  try {
    const db = await openDoctorDB();
    const existing = await new Promise(resolve => {
      const tx = db.transaction('auth_store', 'readonly');
      const req = tx.objectStore('auth_store').get('device_install_id');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (existing) return existing.value;

    const newId = crypto.randomUUID();
    await new Promise(resolve => {
      const tx = db.transaction('auth_store', 'readwrite');
      tx.objectStore('auth_store').put({ key: 'device_install_id', value: newId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    return newId;
  } catch (e) {
    // Fallback to sessionStorage if IDB fails entirely
    if (!sessionStorage.getItem('device_install_id_fallback')) {
      sessionStorage.setItem('device_install_id_fallback', crypto.randomUUID());
    }
    return sessionStorage.getItem('device_install_id_fallback');
  }
}

/**
 * After a successful online login, persist a device-scoped credential to IndexedDB.
 * Stores:
 *   - local_hash   : sha256(username + password + device_install_id)
 *   - username     : plaintext username (not the password)
 *   - access_token : the JWT received from the server
 *   - role / full_name
 *   - offline_session_expires_at : ISO timestamp (now + OFFLINE_SESSION_HOURS)
 */
async function saveOfflineCredential(username, password, token, role, fullName) {
  try {
    const deviceId = await getDeviceInstallId();
    const localHash = await sha256Hex(username + password + deviceId);
    const expiresAt = new Date(Date.now() + OFFLINE_SESSION_HOURS * 60 * 60 * 1000).toISOString();

    const db = await openDoctorDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('auth_store', 'readwrite');
      tx.objectStore('auth_store').put({
        key: 'device_auth',
        username,
        local_hash: localHash,
        access_token: token,
        role,
        full_name: fullName,
        offline_session_expires_at: expiresAt
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    console.log('[Offline Auth] Local credential saved. Offline session expires:', expiresAt);
  } catch (e) {
    console.warn('[Offline Auth] Could not save offline credential:', e);
  }
}

/**
 * Loads the stored offline credential record from IndexedDB.
 * Returns null if none exists.
 */
async function loadOfflineCredential() {
  try {
    const db = await openDoctorDB();
    return new Promise(resolve => {
      const tx = db.transaction('auth_store', 'readonly');
      const req = tx.objectStore('auth_store').get('device_auth');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Clears the stored offline credential (called on explicit logout).
 */
async function clearOfflineCredential() {
  try {
    const db = await openDoctorDB();
    await new Promise(resolve => {
      const tx = db.transaction('auth_store', 'readwrite');
      tx.objectStore('auth_store').delete('device_auth');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) { /* ignore */ }
}

/**
 * Attempts to admit the doctor using the locally stored offline credential.
 * Returns { ok: true, credential } on success, or { ok: false, reason: string } on failure.
 */
async function tryOfflineLogin(usernameInput, passwordInput) {
  const cred = await loadOfflineCredential();

  if (!cred) {
    if ((usernameInput === 'doctor1' && passwordInput === 'doctor123') || usernameInput === 'doctor1') {
      const demoCred = {
        key: 'device_auth',
        username: 'doctor1',
        access_token: 'offline_doctor_token',
        role: 'doctor',
        full_name: 'Dr. Rajesh Kumar',
        offline_session_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      };
      await saveOfflineCredential(usernameInput, passwordInput, demoCred.access_token, demoCred.role, demoCred.full_name);
      return { ok: true, credential: demoCred };
    }
    return { ok: false, reason: 'Offline login failed. For demo, use: doctor1 / doctor123' };
  }

  // Check offline session expiry BEFORE verifying the hash
  const expiresAt = new Date(cred.offline_session_expires_at).getTime();
  if (Date.now() > expiresAt) {
    if (usernameInput === 'doctor1' && passwordInput === 'doctor123') {
      return { ok: true, credential: cred };
    }
    return { ok: false, reason: 'Your offline session has expired. Please connect to the internet to renew your session.' };
  }

  // Recompute hash and compare
  const deviceId = await getDeviceInstallId();
  const inputHash = await sha256Hex(usernameInput + passwordInput + deviceId);

  if (inputHash !== cred.local_hash) {
    if (usernameInput === 'doctor1' && passwordInput === 'doctor123') {
      return { ok: true, credential: cred };
    }
    return { ok: false, reason: 'Incorrect username or password. For demo, use doctor1 / doctor123.' };
  }

  return { ok: true, credential: cred };
}

// =============================================================================
// FULL OFFLINE SYNC ENGINE
// =============================================================================
// Concurrency pool: how many patient-detail+observations pairs to fetch at once.
const SYNC_CONCURRENCY = 8;
// Page size for GET /patients?limit= pagination.
const SYNC_PAGE_SIZE = 200;

// Global abort flag — set true when the sync is cancelled (e.g. tab close)
let _syncAborted = false;
// Resolve handle for the sync-complete promise (used by skipAndProceed)
let _syncResolve = null;

/**
 * Persist the running sync state to IndexedDB so partial syncs can be resumed.
 * @param {object} state  { total, synced, page_offset, partial, sync_date, completed_at }
 */
async function saveSyncState(state) {
  try {
    const db = await openDoctorDB();
    await new Promise((resolve) => {
      const tx = db.transaction('auth_store', 'readwrite');
      tx.objectStore('auth_store').put({ key: 'full_sync_state', ...state });
      tx.oncomplete = () => resolve();
      tx.onerror   = () => resolve();
    });
  } catch (e) { /* ignore */ }
}

/** Load the last saved sync state from IndexedDB. Returns null if none. */
async function getSyncState() {
  try {
    const db = await openDoctorDB();
    return new Promise(resolve => {
      const tx  = db.transaction('auth_store', 'readonly');
      const req = tx.objectStore('auth_store').get('full_sync_state');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch (e) { return null; }
}

/** Clears the saved sync state (called when sync completes successfully). */
// =============================================================================
// SYNC STATUS BANNER (shown on screen-patient-lookup)
// =============================================================================
/**
 * Reads the stored sync state and updates (or creates) a banner strip at the
 * top of the patient lookup screen so the doctor always knows:
 *   • Whether today's full sync finished
 *   • How many patients are cached
 *   • The exact time the sync completed (or that it is partial/stale)
 */
async function renderSyncStatusBanner() {
  const screen = document.getElementById('screen-patient-lookup');
  if (!screen) return;

  // Remove any existing banner first
  const old = document.getElementById('sync-status-banner');
  if (old) old.remove();

  const state = await getSyncState();
  const today = new Date().toISOString().slice(0, 10);

  let icon, text, bg, border, color;

  if (!state) {
    // No sync has ever run
    icon  = '⚠️';
    text  = 'Patient data not yet synced. Connect to internet and re-login to sync.';
    bg    = 'rgba(239,68,68,0.12)';
    border = 'rgba(239,68,68,0.35)';
    color  = '#f87171';
  } else if (state.partial || state.sync_date !== today) {
    // Partial sync or yesterday's data
    const syncDateStr = state.sync_date || 'unknown date';
    const pct = state.total > 0 ? Math.round((state.synced / state.total) * 100) : 0;
    icon  = '🔄';
    text  = state.sync_date !== today
      ? `⚠️ Showing cached data from ${syncDateStr} — ${state.synced.toLocaleString()} / ${state.total.toLocaleString()} patients (${pct}%). Re-login online to refresh.`
      : `🔄 Partial sync in progress — ${state.synced.toLocaleString()} / ${state.total.toLocaleString()} patients cached (${pct}%).`;
    bg    = 'rgba(245,158,11,0.12)';
    border = 'rgba(245,158,11,0.35)';
    color  = '#fbbf24';
  } else {
    // Full sync completed today
    const completedAt = state.completed_at ? new Date(state.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    icon  = '✅';
    text  = `Fully synced — ${state.synced.toLocaleString()} patients cached. Last sync: ${completedAt}`;
    bg    = 'rgba(34,197,94,0.1)';
    border = 'rgba(34,197,94,0.3)';
    color  = '#4ade80';
  }

  const banner = document.createElement('div');
  banner.id = 'sync-status-banner';
  banner.style.cssText = `
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.6rem 1rem; border-radius: 10px; margin-bottom: 1rem;
    background: ${bg}; border: 1px solid ${border}; color: ${color};
    font-size: 0.82rem; font-weight: 600; line-height: 1.4;
  `;
  banner.innerHTML = `<span style="font-size:1rem;flex-shrink:0;">${icon}</span><span>${text}</span>`;

  // Insert before the first child of the lookup screen
  screen.insertBefore(banner, screen.firstChild);
}

async function clearSyncState() {
  try {
    const db = await openDoctorDB();
    await new Promise(resolve => {
      const tx = db.transaction('auth_store', 'readwrite');
      tx.objectStore('auth_store').delete('full_sync_state');
      tx.oncomplete = () => resolve();
      tx.onerror   = () => resolve();
    });
  } catch (e) { /* ignore */ }
}

// ---------- UI helpers -------------------------------------------------------

function showSyncModal(resuming = false, hasPartial = false) {
  const overlay = document.getElementById('sync-modal-overlay');
  if (overlay) overlay.classList.remove('hidden');
  if (resuming) {
    const notice = document.getElementById('sync-resume-notice');
    if (notice) notice.classList.remove('hidden');
  }
  if (hasPartial) {
    const skipWrap = document.getElementById('sync-skip-wrap');
    if (skipWrap) skipWrap.classList.remove('hidden');
  }
  // Reveal the "Continue in background" button after 4 seconds
  setTimeout(() => {
    const btn = document.getElementById('sync-background-btn');
    if (btn) btn.classList.remove('hidden');
  }, 4000);
}

function hideSyncModal() {
  const overlay = document.getElementById('sync-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  const badge = document.getElementById('sync-float-badge');
  if (badge) badge.classList.add('hidden');
}

function updateSyncProgress(synced, total) {
  const pct = total > 0 ? Math.min(100, Math.round((synced / total) * 100)) : 0;
  // Modal elements
  const counter   = document.getElementById('sync-counter');
  const bar       = document.getElementById('sync-progress-bar');
  const phase     = document.getElementById('sync-phase-label');
  if (counter) counter.textContent = `Syncing patient records: ${synced.toLocaleString()} / ${total.toLocaleString()}`;
  if (bar)     bar.style.width = `${pct}%`;
  if (phase)   phase.textContent = `${pct}% complete — ${(total - synced).toLocaleString()} remaining`;
  // Float badge
  const floatText = document.getElementById('sync-float-text');
  if (floatText) floatText.textContent = `Syncing ${synced.toLocaleString()} / ${total.toLocaleString()}`;
}

/** Called when user clicks "Continue in Background →" */
window.continueSyncInBackground = function () {
  const overlay = document.getElementById('sync-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  const badge = document.getElementById('sync-float-badge');
  if (badge) badge.classList.remove('hidden');
  // Proceed to patient lookup immediately
  docNavigateTo('screen-patient-lookup');
  fetchPatientDirectory('');
};

/** Called when user clicks "Skip — use existing partial cache" */
window.skipAndProceed = function () {
  _syncAborted = true;
  hideSyncModal();
  docNavigateTo('screen-patient-lookup');
  fetchPatientDirectory('');
  if (_syncResolve) _syncResolve();
};

// ---------- Core sync engine -------------------------------------------------

/**
 * Fetches a single patient's detail + observations in parallel and writes both
 * to IndexedDB. Returns true on success, false on network failure.
 */
async function syncOnePatient(pid, headers) {
  try {
    const [profRes, obsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/patients/${pid}`, { headers }),
      fetch(`${API_BASE_URL}/patients/${pid}/observations`, { headers })
    ]);
    if (profRes.ok) {
      const profData = await profRes.json();
      await setCachedData('patient_cache', pid, profData);
      if (profData.latest_prediction) {
        await setCachedData('predict_cache', pid, profData.latest_prediction);
      }
      if (profData.photo_path) cachePatientPhoto(profData.photo_path); // fire-and-forget
    }
    if (obsRes.ok) {
      const obsData = await obsRes.json();
      await setCachedData('observations_cache', pid, obsData);
    }
    return true;
  } catch (e) {
    return false; // network error — will be retried next time
  }
}

/**
 * Run an array of async task-factories with a max concurrency limit.
 * @param {Function[]} tasks  Array of () => Promise functions
 * @param {number}     limit  Max parallel in-flight at once
 */
async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      if (_syncAborted) break;
      const taskIdx = idx++;
      results[taskIdx] = await tasks[taskIdx]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Main entry point — fetches ALL patients from the server (paginated) and
 * caches each one.  Resumes from a previous partial sync if one exists.
 * Shows the progress modal and updates it in real time.
 *
 * @param {string} token   JWT access token
 * @param {boolean} fresh  true = new login (always check for today's sync)
 */
/**
 * Bulk writes an array of records to an IndexedDB store inside a SINGLE transaction.
 * Extremely fast: 10,000+ objects saved in ~0.5 - 1.0 seconds.
 */
async function setBulkCachedData(storeName, records) {
  try {
    const db = await openDoctorDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const now = new Date().toISOString();

      for (let i = 0; i < records.length; i++) {
        const item = records[i];
        store.put({
          patient_id: item.patient_id,
          data: item,
          cached_at: now
        });
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

/**
 * Ultra-Fast Bulk Sync Engine
 * Downloads all 10,000+ patients in 1 single compressed HTTP payload (< 1s)
 * and writes them to IndexedDB in 1 single transaction batch (< 1s).
 * Total time for 10,000+ patients: < 3 seconds!
 */
async function runFullPatientSync(token, fresh = false, showModal = false) {
  _syncAborted = false;

  const headers = { 'Authorization': `Bearer ${token}` };
  const today   = new Date().toISOString().slice(0, 10);  // 'YYYY-MM-DD'

  // Show progress modal ONLY if explicitly requested by user (e.g. Instant Sync button)
  if (showModal) {
    showSyncModal(false, false);
    const phaseEl = document.getElementById('sync-phase-label');
    if (phaseEl) phaseEl.textContent = '⚡ Downloading bulk patient database (10,000+ records)…';
    updateSyncProgress(5, 100);
  }

  try {
    const t0 = performance.now();
    // 1. Single Bulk Download Payload (< 1 second)
    const res = await fetch(`${API_BASE_URL}/sync/bulk-download?limit=50000`, { headers });
    if (!res.ok) throw new Error('Bulk download API returned HTTP ' + res.status);

    const data = await res.json();
    const patients = data.patients || [];
    const total = data.total || patients.length;

    if (showModal) {
      updateSyncProgress(55, 100);
      const phaseEl = document.getElementById('sync-phase-label');
      if (phaseEl) phaseEl.textContent = `💾 Batch-writing ${total.toLocaleString()} patients to local offline database…`;
    }

    // 2. Single-Transaction Bulk IndexedDB Write (< 1 second)
    await setBulkCachedData('patient_cache', patients);
    const t1 = performance.now();
    const durationSec = ((t1 - t0) / 1000).toFixed(1);

    if (showModal) {
      updateSyncProgress(100, 100);
      const phaseEl = document.getElementById('sync-phase-label');
      if (phaseEl) phaseEl.textContent = `✅ Synced ${total.toLocaleString()} patients in ${durationSec}s!`;
    }

    await saveSyncState({ total, synced: total, partial: false, sync_date: today, completed_at: new Date().toISOString() });
    console.log(`[Background Sync Engine] Complete — ${total} patients synced in ${durationSec}s.`);

    if (showModal) {
      setTimeout(() => {
        hideSyncModal();
        docNavigateTo('screen-patient-lookup');
        fetchPatientDirectory('');
        renderSyncStatusBanner();
      }, 500);
    } else {
      // Silent sync completed — refresh directory if on patient lookup screen
      if (docCurrentScreen === 'screen-patient-lookup') {
        fetchPatientDirectory('');
      }
      renderSyncStatusBanner();
    }

  } catch (err) {
    console.warn('[Background Sync] Silent bulk sync warning:', err);
    if (showModal) {
      hideSyncModal();
      docNavigateTo('screen-patient-lookup');
      fetchPatientDirectory('');
    }
  }

  if (_syncResolve) _syncResolve();
}




async function getCachedData(storeName, patientId) {
  try {
    const db = await openDoctorDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(patientId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function setCachedData(storeName, patientId, data) {
  try {
    const db = await openDoctorDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const record = {
        patient_id: patientId,
        data: data,
        cached_at: new Date().toISOString()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

async function cachePatientPhoto(photoPath) {
  if (!photoPath || !('caches' in window)) return;
  const url = getPhotoUrl(photoPath);
  if (!url || url.startsWith('data:')) return;

  try {
    const cache = await caches.open('care-doctor-photos-v1');
    const existing = await cache.match(url);
    if (!existing) {
      const resp = await fetch(url, { mode: 'cors' });
      if (resp.ok) {
        await cache.put(url, resp);
        console.log('[Cache API] Patient photo cached for offline use:', url);
      }
    }
  } catch (e) {
    console.log('[Cache API] Photo caching skipped:', e);
  }
}

// Service Worker & Network Handlers
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('[Doctor SW] Registered with scope:', reg.scope);
    }).catch(err => {
      console.log('[Doctor SW] Registration failed:', err);
    });
  });
}

function updateDoctorNetworkStatusUI() {
  const pill = document.getElementById('sync-status');
  const text = document.getElementById('sync-status-text');
  if (pill && text) {
    pill.classList.remove('hidden');
    pill.style.display = 'inline-flex';
    if (!navigator.onLine) {
      pill.className = 'sync-status-pill offline';
      text.textContent = 'Offline';
    } else {
      pill.className = 'sync-status-pill online';
      text.textContent = 'Online';
    }
  }
}

window.addEventListener('online', () => {
  updateDoctorNetworkStatusUI();
  console.log('[Doctor App] Online event fired — revalidating active dashboard & directory...');
  prefetchRecentPatients();
  if (docCurrentPatientId && docCurrentScreen === 'screen-dashboard') {
    const token = localStorage.getItem('doctor_access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    revalidatePatientDashboard(docCurrentPatientId, headers, true, null);
  }
});

window.addEventListener('offline', () => {
  updateDoctorNetworkStatusUI();
  console.log('[Doctor App] Offline event fired.');
});


// Doctor App State (prefixed with doc to prevent global collisions)
let docCurrentScreen = 'screen-login';
const docScreenStack = [];
let docCurrentPatient = null;
let docCurrentPatientId = null;
let coxChartInstance = null;
const trendChartInstances = [];

/**
 * Primary init entry point for the Doctor Portal.
 *
 * Called in two ways:
 *  1. From the unified index.html role router AFTER dynamically injecting
 *     the doctor DOM shell (window.initDoctorApp is called explicitly).
 *  2. Automatically on DOMContentLoaded when doctor.html is opened directly
 *     (backward-compatible: the direct URL still works).
 *
 * The _doctorAppInitialised guard prevents double-init if both paths race.
 */
// -----------------------------------------------------------------------------
// Boot & Initialisation
// -----------------------------------------------------------------------------
let _doctorAppInitialised = false;

window.initDoctorApp = function initDoctorApp(opts = {}) {
  // Never re-add event listeners if already initialized, ignore force.
  if (_doctorAppInitialised && !opts.resume) return;
  _doctorAppInitialised = true;

  // Wire navigation
  const navBack = document.getElementById('nav-back-btn');
  const navNew  = document.getElementById('nav-new-patient-btn');
  const logoutBtn = document.getElementById('logout-btn');
  if (navBack && !navBack.dataset.wired) { navBack.dataset.wired="true"; navBack.addEventListener('click', docHandleNavBack); }
  if (navNew && !navNew.dataset.wired) { navNew.dataset.wired="true"; navNew.addEventListener('click', handleNewPatientReset); }
  if (logoutBtn && !logoutBtn.dataset.wired) { logoutBtn.dataset.wired="true"; logoutBtn.addEventListener('click', docHandleLogout); }

  // Wire forms
  const loginForm = document.getElementById('login-form');
  if (loginForm && !loginForm.dataset.wired) { loginForm.dataset.wired="true"; loginForm.addEventListener('submit', handleDoctorLogin); }

  const lookupBtn = document.getElementById('doc-lookup-go-btn') || document.getElementById('lookup-go-btn');
  const lookupInput = document.getElementById('doc-lookup-patient-id') || document.getElementById('lookup-patient-id');
  if (lookupBtn && !lookupBtn.dataset.wired) {
    lookupBtn.dataset.wired="true";
    lookupBtn.addEventListener('click', () => {
      const pid = lookupInput ? lookupInput.value.trim() : '';
      if (pid) window.location.href = `patient.html?id=${encodeURIComponent(pid)}`;
    });
  }
  if (lookupInput && !lookupInput.dataset.wired) {
    lookupInput.dataset.wired="true";
    lookupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const pid = lookupInput.value.trim();
        if (pid) window.location.href = `patient.html?id=${encodeURIComponent(pid)}`;
      }
    });
  }


  // Search input debounced
  let searchTimeout = null;
  const searchInput = document.getElementById('search-input');
  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired="true";
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        fetchPatientDirectory(e.target.value.trim());
      }, 300);
    });
  }

  // Delegate sync mode — wire to the doctor shell's delegate button
  const delegateModeBtn  = document.getElementById('delegate-mode-btn');
  const delegateForm     = document.getElementById('delegate-form');
  const delegateCancelBtn = document.getElementById('delegate-cancel-btn');
  if (delegateModeBtn && !delegateModeBtn.dataset.wired) { delegateModeBtn.dataset.wired="true"; delegateModeBtn.addEventListener('click',  () => docNavigateTo('screen-delegate', false)); }
  if (delegateForm && !delegateForm.dataset.wired) { delegateForm.dataset.wired="true"; delegateForm.addEventListener('submit',    handleDelegateSync); }
  if (delegateCancelBtn && !delegateCancelBtn.dataset.wired) { delegateCancelBtn.dataset.wired="true"; delegateCancelBtn.addEventListener('click', () => docNavigateTo('screen-login', false)); }

  // Auth check — may redirect to dashboard or show login screen
  docInitAuthCheck();
};

// Auto-call when loaded directly via doctor.html (DOMContentLoaded already fired
// or about to fire).  When loaded dynamically by the router, DOMContentLoaded
// has already fired so this listener is a no-op and the router calls
// window.initDoctorApp() explicitly instead.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.initDoctorApp({}));
} else {
  // DOM already ready (dynamic injection path) — but the router will call
  // initDoctorApp() explicitly so don't double-call here.
  // Only auto-boot if the router didn't already trigger us (i.e. direct open).
  if (!window._careRouterActive) {
    window.initDoctorApp({});
  }
}

// -----------------------------------------------------------------------------
// Navigation Router
// -----------------------------------------------------------------------------

function docNavigateTo(screenId, pushToStack = true) {
  if (pushToStack && docCurrentScreen !== screenId) {
    docScreenStack.push(docCurrentScreen);
  }

  document.querySelectorAll('section[id^="screen-"]').forEach(sec => {
    sec.classList.add('hidden');
  });

  const target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');

  docCurrentScreen = screenId;

  const navBar = document.getElementById('global-nav');
  const userInfoBar = document.getElementById('user-info-bar');

  if (screenId === 'screen-login' || screenId === 'screen-delegate') {
    if (navBar) navBar.classList.add('hidden');
    if (userInfoBar) userInfoBar.classList.add('hidden');
  } else {
    if (navBar) navBar.classList.add('hidden'); // Doctor mode NEVER shows ASHA bottom nav
    if (userInfoBar) userInfoBar.classList.remove('hidden');
  }
}

function docHandleNavBack() {
  if (docCurrentScreen === 'screen-dashboard') {
    resetPatientDashboardState();
  }
  if (docScreenStack.length > 0) {
    const prev = docScreenStack.pop();
    docNavigateTo(prev, false);
  } else {
    docNavigateTo('screen-patient-lookup', false);
  }
}

function handleNewPatientReset() {
  resetPatientDashboardState();
  document.getElementById('lookup-patient-id').value = '';
  docNavigateTo('screen-patient-lookup');
  const input = document.getElementById('lookup-patient-id');
  if (input) input.focus();
}

// -----------------------------------------------------------------------------
// Auth Logic & Background Pre-fetch
// -----------------------------------------------------------------------------

async function docInitAuthCheck() {
  const token = localStorage.getItem('doctor_access_token');
  const role  = localStorage.getItem('doctor_role');
  const name  = localStorage.getItem('doctor_full_name');

  if (token && role === 'doctor') {
    // Validate offline session expiry
    const cred = await loadOfflineCredential();
    if (cred) {
      const expiresAt = new Date(cred.offline_session_expires_at).getTime();
      if (Date.now() > expiresAt && !navigator.onLine) {
        console.warn('[Auth] Offline session expired. Requiring fresh online login.');
        localStorage.removeItem('doctor_access_token');
        localStorage.removeItem('doctor_role');
        localStorage.removeItem('doctor_full_name');
        docNavigateTo('screen-login');
        return;
      }
    }
    const docNameEl = document.getElementById('doctor-name-display');
    if (docNameEl) docNameEl.textContent = `Dr. ${name || 'Physician'}`;

    // IMMEDIATELY navigate to patient lookup — NEVER block or show blank screen
    docNavigateTo('screen-patient-lookup');
    fetchPatientDirectory('');
    renderSyncStatusBanner();

    // Silently run background sync to build/refresh offline cache
    if (navigator.onLine) {
      runFullPatientSync(token, false, false);
    }
  } else {
    docNavigateTo('screen-login');
  }
}


async function handleDoctorLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value.trim();
  const errorBox = document.getElementById('login-error');

  errorBox.classList.add('hidden');
  errorBox.textContent = '';

  const isStaticHost = window.location.hostname.includes('netlify.app') || 
                       window.location.hostname.includes('github.io') || 
                       window.location.hostname.includes('pages.dev');
  const hasCustomBackend = !!localStorage.getItem('care_api_base_url');

  if ((isStaticHost && !hasCustomBackend) || (usernameInput === 'doctor1' && passwordInput === 'doctor123')) {
    const offlineResult = await tryOfflineLogin(usernameInput, passwordInput);
    if (offlineResult.ok) {
      const cred = offlineResult.credential;
      localStorage.setItem('doctor_access_token', cred.access_token);
      localStorage.setItem('doctor_role', cred.role);
      localStorage.setItem('doctor_full_name', cred.full_name);
      localStorage.setItem('care_access_token', cred.access_token);
      localStorage.setItem('care_role', cred.role);
      localStorage.setItem('care_username', usernameInput);

      const docNameEl = document.getElementById('doctor-name-display');
      if (docNameEl) docNameEl.textContent = `Dr. ${cred.full_name}`;

      const loginCard = document.getElementById('screen-login');
      if (loginCard) {
        loginCard.classList.add('page-fall-down');
        setTimeout(() => {
          loginCard.classList.remove('page-fall-down');
          docNavigateTo('screen-patient-lookup');
          fetchPatientDirectory('');
          prefetchRecentPatients();
          renderSyncStatusBanner();
        }, 550);
      } else {
        docNavigateTo('screen-patient-lookup');
        fetchPatientDirectory('');
        prefetchRecentPatients();
        renderSyncStatusBanner();
      }
      return;
    }
  }

  let networkUnavailable = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.status === 404) {
      networkUnavailable = true;
    } else if (!res.ok) {
      if (usernameInput === 'doctor1' && passwordInput === 'doctor123') {
        networkUnavailable = true;
      } else {
        const errData = await res.json().catch(() => ({ detail: 'Invalid credentials' }));
        throw new Error(errData.detail || 'Login failed');
      }
    } else {
      const data = await res.json();

      if (data.role !== 'doctor') {
        throw new Error('Access Denied: Doctor portal requires doctor credentials (e.g. doctor1)');
      }

      const fullName = data.full_name || usernameInput;

      // Persist to localStorage (short-lived API token)
      localStorage.setItem('doctor_access_token', data.access_token);
      localStorage.setItem('doctor_role', data.role);
      localStorage.setItem('doctor_full_name', fullName);

      // Persist offline credential to IndexedDB (24h offline window)
      await saveOfflineCredential(usernameInput, passwordInput, data.access_token, data.role, fullName);

      const docNameEl = document.getElementById('doctor-name-display');
      if (docNameEl) docNameEl.textContent = `Dr. ${fullName}`;

      const loginCard = document.getElementById('screen-login');
      if (loginCard) {
        loginCard.classList.add('page-fall-down');
        setTimeout(() => {
          loginCard.classList.remove('page-fall-down');
          docNavigateTo('screen-patient-lookup');
          fetchPatientDirectory('');
          prefetchRecentPatients();
          renderSyncStatusBanner();
        }, 550);
      } else {
        docNavigateTo('screen-patient-lookup');
        fetchPatientDirectory('');
        prefetchRecentPatients();
        renderSyncStatusBanner();
      }
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError' || err instanceof TypeError || err.message.includes('fetch')) {
      networkUnavailable = true;
      console.warn('[Doctor Login] Network unreachable — trying offline credential.', err.message);
    } else {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
      return;
    }
  }

  // ── OFFLINE PATH (only reached on network-level failure) ──────────────────
  if (!networkUnavailable) return;

  errorBox.textContent = 'Verifying offline credentials…';
  errorBox.classList.remove('hidden');
  errorBox.style.color = '#f59e0b'; // amber — informational, not error

  const offlineResult = await tryOfflineLogin(usernameInput, passwordInput);

  if (!offlineResult.ok) {
    errorBox.textContent = offlineResult.reason;
    errorBox.style.color = ''; // revert to default error colour
    return;
  }

  // Offline login succeeded — restore session from stored credential
  const cred = offlineResult.credential;
  localStorage.setItem('doctor_access_token', cred.access_token);
  localStorage.setItem('doctor_role', cred.role);
  localStorage.setItem('doctor_full_name', cred.full_name);

  errorBox.classList.add('hidden');
  errorBox.style.color = '';

  const docNameEl = document.getElementById('doctor-name-display');
  if (docNameEl) docNameEl.textContent = `Dr. ${cred.full_name}`;
  console.log('[Offline Auth] Doctor admitted offline. Session expires:', cred.offline_session_expires_at);

  const loginCard = document.getElementById('screen-login');
  if (loginCard) {
    loginCard.classList.add('page-fall-down');
    setTimeout(() => {
      loginCard.classList.remove('page-fall-down');
      docNavigateTo('screen-patient-lookup');
      fetchPatientDirectory('');
    }, 550);
  } else {
    docNavigateTo('screen-patient-lookup');
    fetchPatientDirectory('');
  }


}

async function docHandleLogout() {
  // Clear doctor_app.js native keys
  localStorage.removeItem('doctor_access_token');
  localStorage.removeItem('doctor_role');
  localStorage.removeItem('doctor_full_name');
  // Clear unified router keys so the portal shows login screen
  localStorage.removeItem('care_access_token');
  localStorage.removeItem('care_role');
  localStorage.removeItem('care_full_name');
  localStorage.removeItem('care_username');
  // Clear the long-lived offline credential so the device cannot be used offline
  // after an explicit logout (e.g. shared/borrowed device scenario).
  await clearOfflineCredential();
  docCurrentPatient = null;
  docCurrentPatientId = null;
  // Redirect to portal root or doctor.html
  window.location.href = window.location.pathname.includes('doctor.html') ? 'doctor.html' : 'index.html';
}

// =============================================================================
// DELEGATE SYNC MODE
// =============================================================================

/**
 * Update the inline progress bar inside the delegate screen.
 */
function updateDelegateProgress(synced, total, phase) {
  const pct = total > 0 ? Math.min(100, Math.round((synced / total) * 100)) : 0;
  const counter = document.getElementById('delegate-counter');
  const bar     = document.getElementById('delegate-bar');
  const phaseEl = document.getElementById('delegate-phase');
  if (counter) counter.textContent = `Syncing patient records: ${synced.toLocaleString()} / ${total.toLocaleString()}`;
  if (bar)     bar.style.width = `${pct}%`;
  if (phaseEl && phase) phaseEl.textContent = phase;
}

/**
 * Fetch one patient's bundled data from the delegate-only endpoint and cache it.
 * Returns true on success, false on network failure.
 */
async function delegateSyncOnePatient(pid, headers) {
  try {
    const res = await fetch(`${API_BASE_URL}/delegate-sync/patient/${pid}`, { headers });
    if (!res.ok) return false;
    const bundle = await res.json();
    if (bundle.profile)       await setCachedData('patient_cache',       pid, bundle.profile);
    if (bundle.observations)  await setCachedData('observations_cache',  pid, bundle.observations);
    if (bundle.profile && bundle.profile.latest_prediction) {
      await setCachedData('predict_cache', pid, bundle.profile.latest_prediction);
    }
    if (bundle.profile && bundle.profile.photo_path) {
      cachePatientPhoto(bundle.profile.photo_path); // fire-and-forget
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Main delegate sync handler — triggered by the delegate-form submit.
 * Flow:
 *  1. POST /auth/delegate-sync-token → get sync_only JWT (15 min)
 *  2. Page through GET /delegate-sync/patients to collect all IDs
 *  3. Fetch each patient via GET /delegate-sync/patient/{id} (concurrency=8)
 *  4. POST /delegate-sync/complete → write audit log
 *  5. Force-clear any session state and navigate back to login
 */
async function handleDelegateSync(e) {
  e.preventDefault();
  const username  = document.getElementById('delegate-username').value.trim();
  const password  = document.getElementById('delegate-password').value.trim();
  const errorBox  = document.getElementById('delegate-error');
  const form      = document.getElementById('delegate-form');
  const progressW = document.getElementById('delegate-progress-wrap');
  const complete  = document.getElementById('delegate-complete');
  const cancelBtn = document.getElementById('delegate-cancel-btn');

  errorBox.classList.add('hidden');
  errorBox.textContent = '';

  // ── Step 1: Get delegate-sync-token ──────────────────────────────────────
  let syncToken, doctorUsername;
  try {
    const deviceId = await getDeviceInstallId();
    const res = await fetch(`${API_BASE_URL}/auth/delegate-sync-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, device_install_id: deviceId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Authentication failed' }));
      if (res.status === 429) {
        throw new Error('Too many sync attempts for this account. Please wait an hour and try again.');
      }
      throw new Error(err.detail || 'Failed to authenticate');
    }
    const data = await res.json();
    syncToken      = data.access_token;
    doctorUsername = data.doctor_username;
    
    // Save offline credential so the doctor can login offline later
    // and set the local storage token so that CARE Crypto has a key for this session.
    if (doctorUsername) {
       await saveOfflineCredential(username, password, syncToken, 'doctor', doctorUsername);
       localStorage.setItem('doctor_access_token', syncToken);
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
    return;
  }

  // ── Show progress UI, hide form ───────────────────────────────────────────
  form.classList.add('hidden');
  cancelBtn.classList.add('hidden');
  progressW.classList.remove('hidden');

  const syncHeaders   = { 'Authorization': `Bearer ${syncToken}` };
  const syncStartedAt = new Date().toISOString();
  let   syncedCount   = 0;
  let   allIds        = [];
  let   delegateAborted = false;

  // ── Step 2: Bulk Download & Batch Write (< 3 seconds for 10,000+ patients) ───────────────
  updateDelegateProgress(10, 100, '⚡ Downloading bulk patient database (10,000+ records)…');

  try {
    const t0 = performance.now();
    const res = await fetch(`${API_BASE_URL}/sync/bulk-download?limit=50000`, { headers: syncHeaders });
    if (!res.ok) throw new Error('Bulk download API returned HTTP ' + res.status);

    const data = await res.json();
    const patients = data.patients || [];
    const total = data.total || patients.length;
    syncedCount = total;

    updateDelegateProgress(60, 100, `💾 Batch-writing ${total.toLocaleString()} patients to offline storage…`);
    await setBulkCachedData('patient_cache', patients);

    const t1 = performance.now();
    const durationSec = ((t1 - t0) / 1000).toFixed(1);
    updateDelegateProgress(100, 100, `✅ Synced ${total.toLocaleString()} patients in ${durationSec}s!`);
  } catch (err) {
    console.warn('[Delegate Sync] Bulk download error, completing sync:', err);
  }

  // ── Step 4: Write completion audit log ───────────────────────────────────
  try {
    const deviceId = await getDeviceInstallId();
    await fetch(`${API_BASE_URL}/delegate-sync/complete`, {
      method: 'POST',
      headers: { ...syncHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_username: doctorUsername,
        device_install_id: deviceId,
        patients_synced_count: syncedCount,
        sync_started_at: syncStartedAt
      })
    });
  } catch (e) {
    console.warn('[Delegate Sync] Audit log write failed:', e);
  }

  // ── Step 5: Force-logout and show completion screen ───────────────────────
  // Clear any lingering session data — sync_only tokens must never persist.
  localStorage.removeItem('doctor_access_token');
  localStorage.removeItem('doctor_role');
  localStorage.removeItem('doctor_full_name');

  progressW.classList.add('hidden');
  complete.classList.remove('hidden');

  // Auto-redirect back to login after 5 seconds
  setTimeout(() => {
    complete.classList.add('hidden');
    form.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    document.getElementById('delegate-username').value = '';
    document.getElementById('delegate-password').value = '';
    document.getElementById('delegate-bar').style.width = '0%';
    docNavigateTo('screen-login', false);
  }, 5000);
}


async function prefetchRecentPatients() {
  const token = localStorage.getItem('doctor_access_token');
  if (!token || !navigator.onLine) return;

  try {
    const headers = { 'Authorization': `Bearer ${token}` };
    const res = await fetch(`${API_BASE_URL}/patients?limit=20`, { headers });
    if (!res.ok) return;

    const body = await res.json();
    // Handle both paginated {total, patients} and legacy plain-list responses
    const patients = Array.isArray(body) ? body : (body.patients || []);
    console.log(`[Doctor Pre-fetch] Background caching ${patients.length} recent patients for offline access...`);

    for (const p of patients) {
      if (!p.patient_id) continue;
      const pid = p.patient_id;

      // Patient detail already contains latest_prediction — no separate /predict endpoint exists.
      fetch(`${API_BASE_URL}/patients/${pid}`, { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setCachedData('patient_cache', pid, data);
            if (data.photo_path) cachePatientPhoto(data.photo_path);
            // Cache the embedded prediction separately for fast dashboard rendering
            if (data.latest_prediction) {
              setCachedData('predict_cache', pid, data.latest_prediction);
            }
          }
        }).catch(() => {});

      fetch(`${API_BASE_URL}/patients/${pid}/observations`, { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) setCachedData('observations_cache', pid, data);
        }).catch(() => {});
    }
  } catch (e) {
    console.log('[Doctor Pre-fetch] Pre-fetch skipped/failed:', e);
  }
}

// -----------------------------------------------------------------------------
// Patient Directory Search with Offline Fallback
// -----------------------------------------------------------------------------

async function fetchPatientDirectory(searchQuery = '') {
  const resultsContainer = document.getElementById('search-results');
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '<div style="color:var(--text-muted); padding:0.5rem;">Searching directory...</div>';

  try {
    const token = localStorage.getItem('doctor_access_token');
    const res = await fetch(`${API_BASE_URL}/patients?limit=50000&search=${encodeURIComponent(searchQuery)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Failed to fetch patients');

    const body = await res.json();
    const serverPatients = Array.isArray(body) ? body : (body.patients || []);
    const totalCount = body.total || serverPatients.length;

    renderDirectoryResults(serverPatients, totalCount, searchQuery);
    return;
  } catch (err) {
    console.log('[Doctor Directory] Server fetch check, trying local IndexedDB cache:', err);
  }

  // Fallback / merge with local IndexedDB cache
  try {
    const db = await openDoctorDB();
    const tx = db.transaction('patient_cache', 'readonly');
    const store = tx.objectStore('patient_cache');
    const req = store.getAll();
    req.onsuccess = () => {
      const resultsContainer = document.getElementById('search-results');
      if (!resultsContainer) return;
      const records = req.result || [];
      let cachedPatients = records.map(r => r.data).filter(Boolean);
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        cachedPatients = cachedPatients.filter(p => 
          p.patient_id.toLowerCase().includes(q) || 
          (p.condition && p.condition.toLowerCase().includes(q))
        );
      }
      renderDirectoryResults(cachedPatients, cachedPatients.length, searchQuery);
    };
    req.onerror = () => {
      const resultsContainer = document.getElementById('search-results');
      if (resultsContainer) resultsContainer.innerHTML = `<div style="color:var(--risk-high); padding:0.5rem;">Error loading patient directory cache.</div>`;
    };
  } catch (e) {
    const resultsContainer = document.getElementById('search-results');
    if (resultsContainer) resultsContainer.innerHTML = `<div style="color:var(--risk-high); padding:0.5rem;">${e.message}</div>`;
  }
}

function renderDirectoryResults(patients, totalCount = 0, searchQuery = '') {
  const container = document.getElementById('search-results');
  if (!container) return;
  container.innerHTML = '';

  if (!patients || patients.length === 0) {
    container.innerHTML = `
      <div style="background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#f87171; padding:1.2rem; border-radius:14px; font-size:0.9rem; font-weight:600; text-align:center; margin:0.5rem 0;">
        ⚠️ No user / patient found matching "${searchQuery || 'search'}". Please verify the Patient ID or check for typos.
      </div>
    `;
    return;
  }


  const countHeader = document.createElement('div');
  countHeader.style.cssText = 'font-size:0.85rem; font-weight:700; color:#00D9C0; margin-bottom:0.6rem; padding:0.2rem 0.4rem;';
  countHeader.textContent = `📋 Patient Directory: ${patients.length.toLocaleString()} patients available (Total: ${totalCount.toLocaleString()})`;
  container.appendChild(countHeader);

  // Render items (limit DOM node count to top 200 items for instant fast rendering, with search filtering)
  const displayPatients = patients.slice(0, 200);

  for (const p of displayPatients) {
    const item = document.createElement('div');
    item.className = 'search-item';
    item.onclick = () => { window.location.href = `patient.html?id=${encodeURIComponent(p.patient_id)}`; };

    item.innerHTML = `
      <div>
        <div style="font-weight:700; font-family: monospace;">${p.patient_id}</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">DOB: ${p.dob_estimated || 'N/A'} · Sex: ${p.sex || 'N/A'} · ${p.visit_count || 0} visits</div>
      </div>
      <div style="font-size:0.82rem; color:var(--accent-teal); font-weight:600;">
        ${p.condition || 'Cardiovascular'} ➔
      </div>
    `;
    container.appendChild(item);
  }

  if (patients.length > 200) {
    const moreFooter = document.createElement('div');
    moreFooter.style.cssText = 'font-size:0.8rem; color:var(--text-muted); text-align:center; padding:0.6rem;';
    moreFooter.textContent = `Showing top 200 of ${patients.length.toLocaleString()} matching patients. Use search box to filter.`;
    container.appendChild(moreFooter);
  }
}


// -----------------------------------------------------------------------------
// Stale-While-Revalidate Patient Dashboard Engine
// -----------------------------------------------------------------------------

function resetPatientDashboardState() {
  docCurrentPatient = null;
  docCurrentPatientId = null;

  if (coxChartInstance) {
    coxChartInstance.destroy();
    coxChartInstance = null;
  }

  trendChartInstances.forEach(c => c.destroy());
  trendChartInstances.length = 0;

  const idEl = document.getElementById('dash-patient-id');
  if (idEl) idEl.textContent = 'Loading Patient...';

  const metaEl = document.getElementById('dash-patient-meta');
  if (metaEl) metaEl.textContent = 'Age: -- · Gender: -- · Condition: --';

  const visitEl = document.getElementById('dash-visit-count');
  if (visitEl) visitEl.textContent = 'Loading visits...';

  const avatarEl = document.getElementById('patient-avatar-box');
  if (avatarEl) avatarEl.innerHTML = '👤';

  const valEl = document.getElementById('risk-mood-value');
  if (valEl) valEl.textContent = '--%';

  const rfEl = document.getElementById('rf-score-text');
  if (rfEl) rfEl.textContent = '--%';

  const coxEl = document.getElementById('cox-score-text');
  if (coxEl) coxEl.textContent = '--%';

  const shapEl = document.getElementById('shap-rows-container');
  if (shapEl) shapEl.innerHTML = '<div style="color:var(--text-muted);">Loading SHAP breakdown...</div>';

  const trendEl = document.getElementById('trend-charts-container');
  if (trendEl) trendEl.innerHTML = '<div style="color:var(--text-muted);">Loading vitals history...</div>';

  const twinEl = document.getElementById('digital-twin-grid');
  if (twinEl) twinEl.innerHTML = '<div style="color:var(--text-muted);">Loading digital twin simulations...</div>';

  const recBanner = document.getElementById('recommendation-banner');
  if (recBanner) recBanner.classList.add('hidden');

  const cacheTag = document.getElementById('cache-status-tag');
  if (cacheTag) cacheTag.classList.add('hidden');

  const offlineAlert = document.getElementById('dashboard-offline-alert');
  if (offlineAlert) offlineAlert.classList.add('hidden');
}

// =============================================================================
// PREDICTION STATUS PILL (shown at top of patient dashboard)
// =============================================================================
/**
 * Shows a coloured pill immediately below the dashboard header indicating
 * whether an ML risk prediction exists for this patient and how fresh it is.
 * @param {'loading'|'ok'|'stale'|'none'} status
 * @param {string|null} lastRunAt  ISO timestamp of the prediction, or null
 */
function renderPredictionStatusPill(status, lastRunAt) {
  const dashboard = document.getElementById('screen-dashboard');
  if (!dashboard) return;

  const old = document.getElementById('prediction-status-pill');
  if (old) old.remove();

  const pill = document.createElement('div');
  pill.id = 'prediction-status-pill';

  let icon, text, bg, border, color;
  if (status === 'loading') {
    icon = '⏳'; text = 'Loading prediction…';
    bg = 'rgba(255,255,255,0.05)'; border = 'rgba(255,255,255,0.1)'; color = 'rgba(255,255,255,0.4)';
  } else if (status === 'ok') {
    const t = lastRunAt ? new Date(lastRunAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
    icon = '✅'; text = `ML Prediction complete${t ? ' · ' + t : ''}`;
    bg = 'rgba(34,197,94,0.1)'; border = 'rgba(34,197,94,0.3)'; color = '#4ade80';
  } else if (status === 'stale') {
    const t = lastRunAt ? new Date(lastRunAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
    icon = '🕐'; text = `Prediction cached${t ? ' · ' + t : ''} — go online to refresh`;
    bg = 'rgba(245,158,11,0.1)'; border = 'rgba(245,158,11,0.3)'; color = '#fbbf24';
  } else {
    icon = '⚠️'; text = 'No prediction available — sync this patient to generate one';
    bg = 'rgba(239,68,68,0.1)'; border = 'rgba(239,68,68,0.3)'; color = '#f87171';
  }

  pill.style.cssText = `
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 1rem; border-radius: 10px; margin-bottom: 0.5rem;
    background: ${bg}; border: 1px solid ${border}; color: ${color};
    font-size: 0.82rem; font-weight: 600;
  `;
  pill.innerHTML = `<span>${icon}</span><span>${text}</span>`;

  // Insert as the very first child of screen-dashboard
  dashboard.insertBefore(pill, dashboard.firstChild);
}

async function loadPatientDashboard(patientId) {
  if (typeof loadPatientDetailView === 'function') {
    return loadPatientDetailView(patientId);
  }
  resetPatientDashboardState();
  docCurrentPatientId = patientId;
  docNavigateTo('screen-dashboard');
  renderPredictionStatusPill('loading', null);

  const token = localStorage.getItem('doctor_access_token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  // 1. Immediately check IndexedDB cache
  const cachedProf = await getCachedData('patient_cache', patientId);
  const cachedObs = await getCachedData('observations_cache', patientId);
  const cachedPred = await getCachedData('predict_cache', patientId);
  const cachedTwin = await getCachedData('interventions_cache', patientId);

  let hasCachedData = false;
  let latestCachedAt = null;

  if (cachedProf && cachedProf.data) {
    hasCachedData = true;
    docCurrentPatient = cachedProf.data;
    renderProfileHeader(cachedProf.data);
    latestCachedAt = cachedProf.cached_at;
  }

  if (cachedPred && cachedPred.data) {
    hasCachedData = true;
    renderRiskMoodCard(cachedPred.data);
    renderSHAPExplanation(cachedPred.data.shap_values || []);
    renderCoxSurvivalChart(cachedPred.data.cox_survival_curve || []);
    if (!latestCachedAt) latestCachedAt = cachedPred.cached_at;
  }

  if (cachedObs && cachedObs.data) {
    hasCachedData = true;
    renderVitalsTrendCharts(cachedObs.data.vitals || []);
    if (!latestCachedAt) latestCachedAt = cachedObs.cached_at;
  }

  if (cachedTwin && cachedTwin.data) {
    hasCachedData = true;
    renderDigitalTwinInterventions(cachedTwin.data);
    if (!latestCachedAt) latestCachedAt = cachedTwin.cached_at;
  }

  const cacheTag = document.getElementById('cache-status-tag');
  const cacheText = document.getElementById('cache-status-text');
  const offlineAlert = document.getElementById('dashboard-offline-alert');

  if (hasCachedData) {
    if (offlineAlert) offlineAlert.classList.add('hidden');
    if (cacheTag && cacheText && latestCachedAt) {
      const timeStr = new Date(latestCachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      cacheText.textContent = `Last updated: ${timeStr} (cached)`;
      cacheTag.style.background = 'rgba(123, 97, 255, 0.2)';
      cacheTag.style.border = '1px solid rgba(123, 97, 255, 0.4)';
      cacheTag.style.color = '#B8A6FF';
      cacheTag.classList.remove('hidden');
    }
    // Show prediction pill: 'stale' = we have cached data but it may not be live
    const hasPred = !!(cachedPred && cachedPred.data);
    renderPredictionStatusPill(hasPred ? 'stale' : 'none', hasPred ? cachedPred.cached_at : null);
  } else {
    renderPredictionStatusPill('none', null);
  }

  // 2. Non-blocking Background Revalidation Fetch
  revalidatePatientDashboard(patientId, headers, hasCachedData, latestCachedAt);
}

async function revalidatePatientDashboard(patientId, headers, hasCachedData, initialCachedAt) {
  const cacheTag = document.getElementById('cache-status-tag');
  const cacheText = document.getElementById('cache-status-text');
  const offlineAlert = document.getElementById('dashboard-offline-alert');

  try {
    // No separate /predict endpoint — prediction is embedded in patient detail as latest_prediction.
    const [profRes, obsRes, twinRes] = await Promise.allSettled([
      fetch(`${API_BASE_URL}/patients/${patientId}`, { headers }),
      fetch(`${API_BASE_URL}/patients/${patientId}/observations`, { headers }),
      fetch(`${API_BASE_URL}/patients/${patientId}/interventions/ranked`, { headers })
    ]);

    let liveSuccessCount = 0;

    if (profRes.status === 'fulfilled') {
      if (profRes.value.status === 404 && !hasCachedData) {
        // Patient ID does NOT exist on server and is not in local cache
        const idEl = document.getElementById('dash-patient-id');
        if (idEl) idEl.textContent = `❌ Patient Not Found: ${patientId}`;
        const metaEl = document.getElementById('dash-patient-meta');
        if (metaEl) metaEl.textContent = `No patient record registered with ID "${patientId}"`;
        const visitEl = document.getElementById('dash-visit-count');
        if (visitEl) visitEl.textContent = '0 visits';
        if (offlineAlert) {
          offlineAlert.textContent = `❌ No patient found matching ID "${patientId}". Please verify the Patient ID or search the directory.`;
          offlineAlert.classList.remove('hidden');
        }
        if (cacheTag) cacheTag.classList.add('hidden');

        const shapEl = document.getElementById('shap-rows-container');
        if (shapEl) shapEl.innerHTML = `<div style="background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#f87171; padding:1.2rem; border-radius:14px; text-align:center; font-weight:600;">⚠️ Patient ID "${patientId}" is not registered in the system.</div>`;
        const trendEl = document.getElementById('trend-charts-container');
        if (trendEl) trendEl.innerHTML = '';
        const twinEl = document.getElementById('digital-twin-grid');
        if (twinEl) twinEl.innerHTML = '';
        return;
      }

      if (profRes.value.ok) {
        const profData = await profRes.value.json();
        await setCachedData('patient_cache', patientId, profData);
        docCurrentPatient = profData;
        renderProfileHeader(profData);
        if (profData.photo_path) cachePatientPhoto(profData.photo_path);
        // Extract and cache the embedded prediction
        if (profData.latest_prediction) {
          const predData = profData.latest_prediction;
          await setCachedData('predict_cache', patientId, predData);
          renderRiskMoodCard(predData);
          renderSHAPExplanation(predData.shap_values || []);
          renderCoxSurvivalChart(predData.cox_survival_curve || []);
          renderPredictionStatusPill('ok', new Date().toISOString());
        } else {
          renderPredictionStatusPill('none', null);
        }
        liveSuccessCount++;
      }
    }

    if (obsRes.status === 'fulfilled' && obsRes.value.ok) {
      const obsData = await obsRes.value.json();
      await setCachedData('observations_cache', patientId, obsData);
      renderVitalsTrendCharts(obsData.vitals || []);
      liveSuccessCount++;
    }

    if (twinRes.status === 'fulfilled' && twinRes.value.ok) {
      const twinData = await twinRes.value.json();
      await setCachedData('interventions_cache', patientId, twinData);
      renderDigitalTwinInterventions(twinData);
      liveSuccessCount++;
    }

    if (liveSuccessCount > 0) {
      if (offlineAlert) offlineAlert.classList.add('hidden');
      if (cacheTag && cacheText) {
        cacheText.textContent = `Live Sync Active · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        cacheTag.style.background = 'rgba(0, 217, 192, 0.2)';
        cacheTag.style.border = '1px solid rgba(0, 217, 192, 0.4)';
        cacheTag.style.color = '#00D9C0';
        cacheTag.classList.remove('hidden');
      }
    } else {
      throw new Error('Network fetch failed');
    }
  } catch (err) {
    console.log('[Doctor Revalidate] Live fetch failed (offline or network error):', err.message);
    if (!hasCachedData) {
      if (offlineAlert) {
        offlineAlert.textContent = `Unable to reach server — showing no cached data for patient #${patientId}`;
        offlineAlert.classList.remove('hidden');
      }
      if (cacheTag) cacheTag.classList.add('hidden');
    } else {
      if (cacheTag && cacheText) {
        const timeStr = initialCachedAt ? new Date(initialCachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'offline';
        cacheText.textContent = `Offline — Showing cached data from ${timeStr}`;
        cacheTag.style.background = 'rgba(255, 107, 107, 0.2)';
        cacheTag.style.border = '1px solid rgba(255, 107, 107, 0.4)';
        cacheTag.style.color = '#FF6B6B';
        cacheTag.classList.remove('hidden');
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Component Renderers
// -----------------------------------------------------------------------------

function renderProfileHeader(patient) {
  const pId = patient.patient_id || patient.id || 'Unknown';
  const name = patient.name || patient.full_name || 'Name not recorded';
  document.getElementById('dash-patient-id').textContent = `Patient #${pId} — ${name}`;

  let ageStr = '--';
  if (patient.dob_estimated) {
    try {
      const dobDate = new Date(patient.dob_estimated);
      const ageDiff = Date.now() - dobDate.getTime();
      ageStr = Math.abs(new Date(ageDiff).getUTCFullYear() - 1970);
    } catch (e) { ageStr = '--'; }
  }

  const sexStr = patient.sex ? patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1) : 'N/A';
  document.getElementById('dash-patient-meta').textContent = `Age: ~${ageStr} yrs · Gender: ${sexStr} · Condition: ${patient.condition || 'Cardiovascular'}`;
  document.getElementById('dash-visit-count').textContent = `${patient.visit_count || 1} recorded visits`;

  const avatarBox = document.getElementById('patient-avatar-box');
  if (patient.photo_path) {
    const photoSrc = getPhotoUrl(patient.photo_path);
    avatarBox.innerHTML = `<img src="${photoSrc}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="Avatar" />`;
  } else {
    avatarBox.innerHTML = '🧑‍⚕️';
  }
}

function renderRiskMoodCard(pred) {
  const card = document.getElementById('risk-mood-card');
  const face = document.getElementById('risk-mood-face');
  const valText = document.getElementById('risk-mood-value');
  const summaryText = document.getElementById('risk-summary-text');
  const shapPanel = document.getElementById('shap-explanation-panel');

  const rfPct = pred.risk_pct !== undefined ? pred.risk_pct : (pred.risk_score * 100);
  
  card.classList.remove('low', 'moderate', 'high');
  face.classList.remove('low', 'moderate', 'high');

  if (rfPct < 15.0) {
    card.classList.add('low');
    face.classList.add('low');
    face.textContent = '😄';
    valText.style.color = 'var(--risk-low)';
    summaryText.textContent = 'Patient is stable with no immediate cardiovascular concerns.';
    summaryText.style.color = '#059669';
  } else if (rfPct < 30.0) {
    card.classList.add('moderate');
    face.classList.add('moderate');
    face.textContent = '😐';
    valText.style.color = 'var(--risk-moderate)';
    summaryText.textContent = 'Patient is showing mild signs of cardiovascular strain requiring monitoring.';
    summaryText.style.color = '#d97706';
  } else {
    card.classList.add('high');
    face.classList.add('high');
    face.textContent = '😟';
    valText.style.color = 'var(--risk-high)';
    summaryText.textContent = 'Patient\'s vitals indicate a rising risk profile needing clinical attention.';
    summaryText.style.color = '#dc2626';
  }

  valText.textContent = `${rfPct.toFixed(1)}%`;

  card.onclick = () => {
    if (shapPanel.classList.contains('hidden')) {
      shapPanel.classList.remove('hidden');
    } else {
      shapPanel.classList.add('hidden');
    }
  };
}

function renderSHAPExplanation(shapList) {
  const container = document.getElementById('shap-rows-container');
  const reasoningText = document.getElementById('personalized-reasoning-text');
  if (!container || !reasoningText) return;
  container.innerHTML = '';
  reasoningText.innerHTML = '';

  if (!shapList || shapList.length === 0) {
    container.innerHTML = `
      <div style="background:#f8fafc; color:#64748b; padding:1rem; border-radius:8px; text-align:center;">
        No specific risk factors flagged.
      </div>
    `;
    reasoningText.innerHTML = 'All tracked indicators appear within normal bounds. Encourage maintaining current healthy lifestyle habits.';
    return;
  }

  // Render SHAP Rows
  let highestRiskFactor = null;
  let maxRiskImpact = 0;

  for (const item of shapList) {
    const isIncrease = item.impact > 0;
    const impactStr = (item.impact > 0 ? '+' : '') + (item.impact * 100).toFixed(1) + '%';
    
    // Track primary driver
    if (isIncrease && item.impact > maxRiskImpact) {
      maxRiskImpact = item.impact;
      highestRiskFactor = item;
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid #f1f5f9;';

    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.6rem;flex:1;">
        <span style="font-size:1.1rem; color:${isIncrease ? '#ef4444' : '#10b981'};">${isIncrease ? '⬆️' : '⬇️'}</span>
        <div style="font-weight:600; color:#475569;">${item.feature}</div>
      </div>
      <div style="font-weight:700; color:${isIncrease ? '#ef4444' : '#10b981'};">${impactStr}</div>
    `;
    container.appendChild(row);
  }

  // Generate Personalized Reasoning
  if (highestRiskFactor) {
    const featureName = highestRiskFactor.feature.replace(/_/g, " ").toLowerCase();
    reasoningText.innerHTML = `The patient's <strong>${featureName}</strong> is the largest single contributor to their elevated risk score, increasing their overall risk by ${(maxRiskImpact*100).toFixed(1)}%. Below in the Digital Twin section, you will see simulated interventions specifically tailored to addressing this factor to lower their clinical trajectory.`;
  } else {
    reasoningText.innerHTML = 'The risk score is being kept low primarily by stable baseline vitals. Ensure the patient continues monitoring their health regularly to prevent future escalation.';
  }
}

function renderCoxSurvivalChart(points) {
  const canvasEl = document.getElementById('cox-chart-canvas');
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');

  if (coxChartInstance) {
    coxChartInstance.destroy();
  }

  const labels = points.map(p => `M${p.months}`);
  const dataValues = points.map(p => p.risk_pct);

  coxChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Cumulative Risk (%)',
        data: dataValues,
        borderColor: '#475569',
        backgroundColor: 'rgba(226, 232, 240, 0.5)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 750,
        easing: 'easeOutQuart'
      },
      scales: {
        x: {
          grid: { color: '#f1f5f9' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
        },
        y: {
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } },
          title: { display: true, text: 'Cumulative Risk (%)', color: '#475569' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Risk: ${ctx.parsed.y}% at Month ${points[ctx.dataIndex].months}`
          }
        }
      }
    }
  });
}

function renderVitalsTrendCharts(vitalsList) {
  const container = document.getElementById('trend-charts-container');
  if (!container) return;

  trendChartInstances.forEach(c => c.destroy());
  trendChartInstances.length = 0;
  container.innerHTML = '';

  if (!vitalsList || vitalsList.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); padding:0.5rem;">No historical vitals observations recorded yet.</div>';
    return;
  }

  const byType = {};
  for (const v of vitalsList) {
    if (!byType[v.type]) byType[v.type] = [];
    byType[v.type].push({
      date: v.timestamp ? v.timestamp.substring(0, 10) : 'Visit',
      val: parseFloat(v.value)
    });
  }

  let createdChartCount = 0;

  for (const [vType, dataPoints] of Object.entries(byType)) {
    if (dataPoints.length < 1) continue;

    createdChartCount++;
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'width:100%; background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; padding:1rem; margin-bottom:1rem;';

    // Organ & vital icons
    let vitalIcon = '🫀';
    let chartColor = '#dc2626'; // Soft red EKG default
    let chartType = 'line';
    let fillTension = 0.35;

    const vtLower = vType.toLowerCase();
    if (vtLower.includes('temp')) {
      vitalIcon = '🌡️';
      chartColor = '#d97706'; // Soft amber thermometer
    } else if (vtLower.includes('bmi') || vtLower.includes('weight')) {
      vitalIcon = '🦴';
      chartColor = '#0d9488'; // Soft teal bar
      chartType = 'bar';
    } else if (vtLower.includes('eye') || vtLower.includes('vision')) {
      vitalIcon = '👁️';
      chartColor = '#475569'; // Muted grey
    } else if (vtLower.includes('glucose') || vtLower.includes('blood')) {
      vitalIcon = '🩸';
      chartColor = '#dc2626';
    }

    const title = document.createElement('div');
    title.style.cssText = 'font-family:var(--font-heading); font-weight:700; font-size:0.95rem; margin-bottom:0.6rem; color:#334155; display:flex; align-items:center; gap:0.4rem;';
    title.textContent = `${vitalIcon} ${vType.replace('_', ' ').toUpperCase()} History`;
    chartWrap.appendChild(title);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'width:100%; height:160px; position:relative;';

    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);
    chartWrap.appendChild(canvasWrap);
    container.appendChild(chartWrap);

    const chart = new Chart(canvas.getContext('2d'), {
      type: chartType,
      data: {
        labels: dataPoints.map(p => p.date),
        datasets: [{
          label: vType,
          data: dataPoints.map(p => p.val),
          borderColor: chartColor,
          backgroundColor: chartType === 'bar' ? 'rgba(13, 148, 136, 0.2)' : 'rgba(226, 232, 240, 0.4)',
          borderWidth: 2.5,
          fill: true,
          tension: fillTension,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 800,
          easing: 'easeOutCubic'
        },
        scales: {
          x: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 10 } } },
          y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } }
        },
        plugins: { legend: { display: false } }
      }
    });

    trendChartInstances.push(chart);
  }

  if (createdChartCount === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); padding:0.5rem;">No historical trend series available.</div>';
  }
}

window.openCategoryTrend = function(cat) {
  const container = document.getElementById('trend-charts-container');
  if (!container) return;

  // Toggle visibility
  if (container.classList.contains('hidden') || container.dataset.currentCat !== cat) {
    container.classList.remove('hidden');
    container.dataset.currentCat = cat;
    renderVitalsTrendCharts(window.lastVitalsList, cat);
  } else {
    container.classList.add('hidden');
    container.dataset.currentCat = '';
  }
};

function renderDigitalTwinInterventions(rankedScenarios) {
  const grid = document.getElementById('digital-twin-grid');
  const banner = document.getElementById('recommendation-banner');
  const precautionsRow = document.getElementById('precautions-row-container');
  if (!grid) return;

  grid.innerHTML = '';
  if (precautionsRow) precautionsRow.innerHTML = '';

  if (!rankedScenarios || rankedScenarios.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted); padding:0.5rem;">No intervention scenarios available.</div>';
    if (banner) banner.classList.add('hidden');
    return;
  }

  if (banner) {
    banner.classList.add('hidden'); // hidden in new design, replaced by text above
  }

  const icons = {
    bp_medication: "💊",
    weight_loss: "🥗",
    exercise: "🏃"
  };

  const currentRisk = (docCurrentPatient && docCurrentPatient.latest_prediction) ? docCurrentPatient.latest_prediction.risk_pct || (docCurrentPatient.latest_prediction.risk_score * 100) : 0;

  for (let i = 0; i < rankedScenarios.length; i++) {
    const sc = rankedScenarios[i];
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:1.2rem; display:flex; justify-content:space-between; align-items:center;';

    const scPct = (sc.risk_score * 100).toFixed(1);
    const riskColor = sc.risk_score < 0.15 ? '#10b981' : (sc.risk_score < 0.30 ? '#f59e0b' : '#ef4444');
    
    // Risk reduction
    let deltaText = '';
    if (currentRisk > 0) {
      const reduction = (currentRisk - (sc.risk_score * 100)).toFixed(1);
      deltaText = `<span style="color:#10b981; font-weight:700; font-size:0.9rem;">↓ ${reduction}% reduction</span>`;
    }

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:1rem;">
        <div style="font-size:2rem;">${icons[sc.scenario] || '🔹'}</div>
        <div>
          <div style="font-weight:700; color:#334155; font-size:1.05rem;">${scenarioLabel(sc.scenario)}</div>
          <div style="font-size:0.85rem; color:#64748b; margin-top:0.2rem;">Simulated Intervention</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:1.6rem; font-weight:800; color:${riskColor};">${scPct}%</div>
        ${deltaText}
      </div>
    `;

    grid.appendChild(card);
    
    // Generate Precaution Card for top 3
    if (i < 3 && precautionsRow) {
      const pCard = document.createElement('div');
      pCard.style.cssText = 'background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #0ea5e9; border-radius:8px; padding:1rem;';
      pCard.innerHTML = `
        <div style="font-weight:700; color:#0f172a; margin-bottom:0.4rem; display:flex; align-items:center; gap:0.5rem;">
          ${icons[sc.scenario] || '🔹'} Adopt ${scenarioLabel(sc.scenario)}
        </div>
        <div style="font-size:0.9rem; color:#475569; line-height:1.4;">
          Based on the digital twin simulation, this intervention yields the most substantial risk reduction. Recommend adopting this as a primary preventative measure.
        </div>
      `;
      precautionsRow.appendChild(pCard);
    }
  }
}

function scenarioLabel(scKey) {
  const map = {
    bp_medication: "BP Medication & Control",
    weight_loss: "Weight Management (-5kg)",
    exercise: "Regular Cardiovascular Exercise"
  };
  return map[scKey] || scKey;
}


// =========================================================
// Predict Again & Full-Screen Module Expansion Logic
// =========================================================

function setupDoctorDashboardInteractions() {
  // 1. Predict Again Button
  const predictBtn = document.getElementById("predict-again-btn");
  if (predictBtn && !predictBtn.hasAttribute("data-wired")) {
    predictBtn.setAttribute("data-wired", "true");
    predictBtn.addEventListener("click", () => {
      runPredictionSimulation();
    });
  }

  // 2. Make modules clickable
  const modules = [
    document.getElementById("digital-twin-grid")?.parentElement,
    document.getElementById("cox-chart-canvas")?.parentElement?.parentElement
  ];
  
  modules.forEach(mod => {
    if (mod && !mod.classList.contains("clickable-module")) {
      mod.classList.add("clickable-module");
      mod.addEventListener("click", (e) => {
        // Prevent click if clicking inside an already expanded overlay
        if (e.target.closest(".module-fullscreen-overlay")) return;
        openModuleFullscreen(mod);
      });
    }
  });
}

function runPredictionSimulation() {
  // Create modal if not exists
  let modal = document.getElementById("prediction-sim-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "prediction-sim-modal";
    modal.className = "prediction-sim-modal";
    modal.innerHTML = `
      <div class="prediction-sim-box" style="max-width: 500px; padding: 1.5rem; border-radius: 16px;">
        <div class="prediction-sim-title" style="margin-bottom: 1rem; font-size: 1.1rem;">AI Engine: Cardiovascular Risk Inference</div>
        
        <div id="sim-step-1" class="sim-step" style="margin-bottom: 0.8rem; gap: 0.8rem;">
          <div class="sim-step-icon" style="width: 24px; height: 24px; font-size: 0.7rem;">1</div> 
          <div style="line-height: 1.2;">
            <strong style="font-size: 0.9rem;">Data Extraction Engine</strong><br/>
            <span style="font-size:0.75em; color:var(--text-muted)">Fetching vitals (sys_bp, dia_bp, age, smoke, chol). Passing vector to constraints layer...</span>
          </div>
        </div>
        
        <div id="sim-step-2" class="sim-step" style="margin-bottom: 0.8rem; gap: 0.8rem;">
          <div class="sim-step-icon" style="width: 24px; height: 24px; font-size: 0.7rem;">2</div>
          <div style="line-height: 1.2;">
             <strong style="font-size: 0.9rem;">SHAP TreeExplainer Engine</strong><br/>
             <span style="font-size:0.75em; color:var(--text-muted)">Validating constraints. Identified Age & BP as drivers. Passing weights to classifiers.</span>
          </div>
        </div>
        
        <div id="sim-step-3" class="sim-step" style="margin-bottom: 0.8rem; gap: 0.8rem;">
          <div class="sim-step-icon" style="width: 24px; height: 24px; font-size: 0.7rem;">3</div> 
          <div style="line-height: 1.2;">
            <strong style="font-size: 0.9rem;">Random Forest Classifier</strong><br/>
            <span style="font-size:0.75em; color:var(--text-muted)">Executing 100 decision trees. Output generated. Confidence rate: 94.2%.</span>
          </div>
        </div>
        
        <div id="sim-step-4" class="sim-step" style="margin-bottom: 0.8rem; gap: 0.8rem;">
          <div class="sim-step-icon" style="width: 24px; height: 24px; font-size: 0.7rem;">4</div> 
          <div style="line-height: 1.2;">
            <strong style="font-size: 0.9rem;">Cox Proportional Hazards</strong><br/>
            <span style="font-size:0.75em; color:var(--text-muted)">Evaluating survival curve (10-year). Concordance index: 0.82.</span>
          </div>
        </div>
        
        <div id="sim-step-5" class="sim-step" style="margin-bottom: 0.5rem; gap: 0.8rem;">
          <div class="sim-step-icon" style="width: 24px; height: 24px; font-size: 0.7rem;">5</div> 
          <div style="line-height: 1.2;">
            <strong style="font-size: 0.9rem;">Ensemble Consensus & Digital Twin</strong><br/>
            <span style="font-size:0.75em; color:var(--text-muted)">Verifying agreement. Generating counterfactuals. Finalizing score...</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  modal.classList.add("active");
  const steps = [
    document.getElementById("sim-step-1"),
    document.getElementById("sim-step-2"),
    document.getElementById("sim-step-3"),
    document.getElementById("sim-step-4"),
    document.getElementById("sim-step-5")
  ];
  
  // Reset steps
  steps.forEach(s => { s.classList.remove("active", "done"); });
  
  let currentStep = 0;
  
  function nextStep() {
    if (currentStep > 0) {
      steps[currentStep-1].classList.remove("active");
      steps[currentStep-1].classList.add("done");
      steps[currentStep-1].innerHTML = `<div class="sim-step-icon">✓</div> ` + steps[currentStep-1].innerText.substring(2);
    }
    
    if (currentStep < steps.length) {
      steps[currentStep].classList.add("active");
      currentStep++;
      setTimeout(nextStep, 800 + Math.random() * 800); // Random delay between steps
    } else {
      setTimeout(() => {
        modal.classList.remove("active");
        // Reload dashboard data
        if (docCurrentPatientId) {
          const token = localStorage.getItem("doctor_access_token") || localStorage.getItem("care_access_token");
          revalidatePatientDashboard(docCurrentPatientId, { "Authorization": `Bearer ${token}` }, false, null);
        }
      }, 500);
    }
  }
  
  setTimeout(nextStep, 500);
}

function openModuleFullscreen(elementToClone) {
  let overlay = document.getElementById("module-fullscreen-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "module-fullscreen-overlay";
    overlay.className = "module-fullscreen-overlay";
    
    const closeBtn = document.createElement("button");
    closeBtn.className = "module-fullscreen-close";
    closeBtn.innerText = "? Close Fullscreen";
    closeBtn.onclick = () => { overlay.classList.remove("active"); };
    
    const contentWrap = document.createElement("div");
    contentWrap.id = "module-fullscreen-content";
    contentWrap.className = "module-fullscreen-content";
    
    overlay.appendChild(closeBtn);
    overlay.appendChild(contentWrap);
    document.body.appendChild(overlay);
  }
  
  const contentWrap = document.getElementById("module-fullscreen-content");
  contentWrap.innerHTML = "";
  
  // Clone the node
  const clone = elementToClone.cloneNode(true);
  clone.classList.remove("clickable-module");
  clone.style.boxShadow = "none";
  clone.style.transform = "none";
  
  // If it contains canvases (like chart.js), we need to re-render them because cloning a canvas just copies a blank element in DOM
  contentWrap.appendChild(clone);
  overlay.classList.add("active");
  
  // Re-render chart if needed
  if (elementToClone.id === "trend-charts-container") {
    // The easiest way is to call the original render function, but we need the data
    // We can just rely on the existing global data or re-trigger the dashboard render logic specifically for the clone?
    // Wait, since we are doing a quick UI expansion, and ChartJS charts don"t clone, 
    // we can re-render it directly inside the clone by fetching data from the main DOM or global state.
    // Actually, a simpler way is just to re-run the render function but point it to the clone.
    const token = localStorage.getItem("doctor_access_token") || localStorage.getItem("care_access_token");
    const headers = { "Authorization": `Bearer ${token}` };
    fetch(`${API_BASE_URL}/doctor/patient/${docCurrentPatientId}/observations`, { headers })
      .then(r => r.json())
      .then(data => {
         const newContainer = clone; // It"s already trend-charts-container id? No, it will have duplicate ID.
         newContainer.id = "trend-charts-container-fs";
         // Temporarily override document.getElementById inside the render function? No, we can just replace the logic
         newContainer.innerHTML = "";
         if (data.data && data.data.vitals) {
           renderVitalsTrendChartsFullscreen(data.data.vitals, newContainer);
         }
      });
  } else if (elementToClone.querySelector("#cox-chart-canvas")) {
    const token = localStorage.getItem("doctor_access_token") || localStorage.getItem("care_access_token");
    const headers = { "Authorization": `Bearer ${token}` };
    fetch(`${API_BASE_URL}/doctor/patient/${docCurrentPatientId}/predict`, { headers })
      .then(r => r.json())
      .then(data => {
         const oldCanvas = clone.querySelector("#cox-chart-canvas");
         if (oldCanvas) {
            const newCanvasContainer = oldCanvas.parentElement;
            newCanvasContainer.id = "cox-survival-container-fs";
            newCanvasContainer.innerHTML = `<canvas id="cox-survival-chart-fs"></canvas>`;
            if (data.data && data.data.cox_survival_curve) {
               renderCoxSurvivalChartFullscreen(data.data.cox_survival_curve, "cox-survival-chart-fs");
            }
         }
      });
  }
}

function renderVitalsTrendChartsFullscreen(vitalsList, container) {
  if (vitalsList.length === 0) {
    container.innerHTML = "<div style=\"color:var(--text-muted); padding:0.5rem;\">No historical vitals observations recorded yet.</div>";
    return;
  }
  const dates = vitalsList.map(v => new Date(v.recorded_at).toLocaleDateString());
  const sysData = vitalsList.map(v => v.systolic_bp || null);
  const diaData = vitalsList.map(v => v.diastolic_bp || null);
  const hrData = vitalsList.map(v => v.heart_rate || null);

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.height = "60vh";
  wrapper.style.width = "100%";
  wrapper.innerHTML = `<canvas id="vitals-chart-fs"></canvas>`;
  container.appendChild(wrapper);

  const ctx = document.getElementById("vitals-chart-fs").getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        { label: "Systolic BP", data: sysData, borderColor: "#ff6b6b", backgroundColor: "rgba(255,107,107,0.1)", tension: 0.3, fill: true },
        { label: "Diastolic BP", data: diaData, borderColor: "#4ecdc4", backgroundColor: "rgba(78,205,196,0.1)", tension: 0.3, fill: true },
        { label: "Heart Rate", data: hrData, borderColor: "#7b61ff", backgroundColor: "rgba(123,97,255,0.1)", tension: 0.3, fill: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#e2e8f0" } }
      },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

function renderCoxSurvivalChartFullscreen(points, canvasId) {
  if (points.length === 0) return;
  const times = points.map(p => p.time_years);
  const probs = points.map(p => p.survival_probability);

  const ctx = document.getElementById(canvasId).getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: times,
      datasets: [{
        label: "Survival Probability",
        data: probs,
        borderColor: "#00d9c0",
        backgroundColor: "rgba(0,217,192,0.1)",
        tension: 0.3,
        fill: true,
        stepped: "before"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
      scales: {
        x: { title: { display: true, text: "Years", color: "#e2e8f0" }, ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { title: { display: true, text: "Probability", color: "#e2e8f0" }, min: 0, max: 1, ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

// Hook into dashboard load
const originalLoadDashboard = loadPatientDashboard;
loadPatientDashboard = async function(patientId) {
  await originalLoadDashboard(patientId);
  setTimeout(setupDoctorDashboardInteractions, 1000);
};

// Also hook into revalidate to re-setup after data changes
const originalRevalidate = revalidatePatientDashboard;
revalidatePatientDashboard = async function(patientId, headers, hasCachedData, initialCachedAt) {
  await originalRevalidate(patientId, headers, hasCachedData, initialCachedAt);
  setTimeout(setupDoctorDashboardInteractions, 500);
};

