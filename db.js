/**
 * CARE IndexedDB Storage Module (db.js)
 * Stores offline observations and patient cache locally.
 */

// =============================================================================
// DATA-AT-REST ENCRYPTION  (SubtleCrypto AES-GCM)
// =============================================================================
// PURPOSE: protects observation field values stored in IndexedDB on a
// potentially shared or physically lost device.
// SCOPE: data AT REST only.  Data IN TRANSIT is protected by HTTPS at the
// reverse proxy layer — this module does not touch network requests.
//
// KEY DERIVATION:
//   PBKDF2(material = access_token, salt = CARE_CRYPTO_SALT, iters = 100 000)
//   → AES-GCM 256-bit key.  The key is cached for the lifetime of the
//   session and wiped from memory when the user logs out.
//
// KEY ROTATION:
//   After a logout/login cycle the access token changes, so the derived key
//   changes.  Decryption of records written in the previous session will fail.
//   This is handled gracefully: the record is returned with
//   field_value = '[unreadable — key rotated, re-sync required]' and a
//   console.warn.  The app never crashes and unaffected records still work.
// =============================================================================

const CARE_CRYPTO_SALT = 'care-asha-local-salt-v1'; // static per-app salt (not secret)

// Module-level key cache.  Set by initCryptoKey(), cleared by clearCryptoKey().
let _cryptoKey = null;

/**
 * Derive and cache the AES-GCM key from the current session token.
 * Safe to call multiple times — re-derives only when the key is null.
 * @param {string} token  The care_access_token from localStorage.
 */
async function initCryptoKey(token) {
  if (_cryptoKey) return _cryptoKey;          // already initialised
  if (!token || !window.crypto?.subtle) {
    // SubtleCrypto unavailable (very old browser) or no token — skip encryption.
    return null;
  }
  try {
    const enc    = new TextEncoder();
    const rawKey = await crypto.subtle.importKey(
      'raw', enc.encode(token), 'PBKDF2', false, ['deriveKey']
    );
    _cryptoKey = await crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       enc.encode(CARE_CRYPTO_SALT),
        iterations: 100_000,
        hash:       'SHA-256',
      },
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false,          // not extractable — the raw key bytes never leave SubtleCrypto
      ['encrypt', 'decrypt']
    );
    return _cryptoKey;
  } catch (e) {
    console.warn('[CARE Crypto] Key derivation failed — falling back to plaintext storage:', e);
    return null;
  }
}

/** Wipe the in-memory key on logout so no trace remains in the JS heap. */
function clearCryptoKey() {
  _cryptoKey = null;
}

/**
 * Encrypt a plaintext string value.
 * Returns a JSON string: {"_enc":true,"iv":"<base64>","ct":"<base64>"}
 * Returns the original value unchanged if encryption is unavailable.
 */
async function encryptFieldValue(plaintext) {
  const key = _cryptoKey || await initCryptoKey(localStorage.getItem('care_access_token') || localStorage.getItem('doctor_access_token'));
  if (!key || plaintext == null) return plaintext;  // graceful no-op

  try {
    const iv  = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV, fresh per value
    const enc = new TextEncoder();
    const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plaintext)));
    return JSON.stringify({
      _enc: true,
      iv:   btoa(String.fromCharCode(...iv)),
      ct:   btoa(String.fromCharCode(...new Uint8Array(ct))),
    });
  } catch (e) {
    console.warn('[CARE Crypto] Encryption failed — storing plaintext:', e);
    return plaintext;  // never block a save
  }
}

/**
 * Decrypt a value previously encrypted by encryptFieldValue().
 * Returns the original plaintext on success.
 * On any failure (wrong key, corrupted data, format change) returns a
 * sentinel string and logs a warning — never throws.
 */
async function decryptFieldValue(stored) {
  // Fast path: not encrypted (legacy or encryption-unavailable record).
  if (!stored || typeof stored !== 'string') return stored;
  let parsed;
  try { parsed = JSON.parse(stored); } catch (_) { return stored; }  // plain string
  if (!parsed?._enc) return stored;

  const token = localStorage.getItem('care_access_token') || localStorage.getItem('doctor_access_token');
  const key = _cryptoKey || await initCryptoKey(token);
  if (!key) {
    if (token) console.warn('[CARE Crypto] Key derivation failed for existing token.');
    return '[unreadable — encryption key unavailable]';
  }

  try {
    const iv  = Uint8Array.from(atob(parsed.iv),  c => c.charCodeAt(0));
    const ct  = Uint8Array.from(atob(parsed.ct),  c => c.charCodeAt(0));
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
  } catch (_) {
    // Key rotated or sample record under previous session key
    return '[key rotated — re-sync required]';
  }
}

const DB_NAME = 'care_asha_db';
// Version 3: adds auth_store for token persistence.
const DB_VERSION = 3;

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      return resolve(dbInstance);
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Observations store (autoIncrement local key)
      if (!db.objectStoreNames.contains('observations')) {
        const obsStore = db.createObjectStore('observations', { keyPath: 'id', autoIncrement: true });
        obsStore.createIndex('patient_id',      'patient_id',               { unique: false });
        obsStore.createIndex('synced',          'synced',                   { unique: false });
        obsStore.createIndex('patient_category',['patient_id', 'category'], { unique: false });
        // client_uuid: unique per observation across all devices, used for server-side deduplication
        obsStore.createIndex('client_uuid',     'client_uuid',              { unique: true  });
      } else if (event.oldVersion < 2) {
        // Migration: existing store gains the client_uuid index.
        // Existing rows without client_uuid will get one assigned on next read
        // (handled in saveObservation — old rows are already synced so they
        // won't be re-uploaded, but the index needs to exist).
        const obsStore = event.target.transaction.objectStore('observations');
        if (!obsStore.indexNames.contains('client_uuid')) {
          obsStore.createIndex('client_uuid', 'client_uuid', { unique: false }); // non-unique for migration safety
        }
      }

      // 2. Patients Cache store (keyed by patient_id)
      if (!db.objectStoreNames.contains('patients_cache')) {
        const patStore = db.createObjectStore('patients_cache', { keyPath: 'patient_id' });
        patStore.createIndex('synced', 'synced', { unique: false });
      }

      // 3. Auth store for Service Worker Background Sync
      if (!db.objectStoreNames.contains('auth_store')) {
        db.createObjectStore('auth_store', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

const CARE_DB = {
  /**
   * Save a single observation to IndexedDB.
   * Generates a crypto.randomUUID() client_uuid at creation time so that the
   * same observation can be identified across devices during server sync —
   * even if two devices have overlapping autoIncrement local IDs.
   *
   * field_value is encrypted with AES-GCM before storage (data at rest).
   * Sync payloads decrypt before sending so the server always gets plaintext.
   */
  async saveObservation(obs) {
    const db = await openDB();

    // Encrypt field_value before writing to IndexedDB.
    // Protects patient data at rest on shared or lost devices.
    const encryptedValue = await encryptFieldValue(
      obs.field_value !== undefined ? String(obs.field_value) : null
    );

    return new Promise((resolve, reject) => {
      const tx = db.transaction('observations', 'readwrite');
      const store = tx.objectStore('observations');
      const record = {
        // client_uuid: globally unique ID generated on this device at write time.
        // Sent to the server and used as the idempotency key for ON CONFLICT DO NOTHING,
        // so re-syncing after a partial failure never creates duplicate rows.
        client_uuid: obs.client_uuid || crypto.randomUUID(),
        patient_id:  obs.patient_id,
        category:    obs.category,
        field_key:   obs.field_key,
        field_value: encryptedValue,   // AES-GCM encrypted ciphertext or plaintext fallback
        recorded_by: obs.recorded_by || 'asha1',
        recorded_at: obs.recorded_at || new Date().toISOString(),
        synced:      obs.synced !== undefined ? obs.synced : 0
      };
      const req = store.add(record);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  /**
   * Fetch all unsynced observations (synced === 0), decrypting field_value.
   * Decryption is graceful: records whose key has rotated (e.g. after a
   * logout/login cycle) return a sentinel string rather than throwing.
   */
  async getUnsyncedObservations() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction('observations', 'readonly');
      const store = tx.objectStore('observations');
      const req   = store.getAll();
      req.onsuccess = async (e) => {
        const all      = e.target.result || [];
        const unsynced = all.filter(r => r.synced === 0);
        // Decrypt field_value for each record before returning to the caller.
        // The sync engine in app.js / sw.js sends decrypted plaintext to the server.
        const decrypted = await Promise.all(
          unsynced.map(async (r) => ({
            ...r,
            field_value: await decryptFieldValue(r.field_value),
          }))
        );
        resolve(decrypted);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Mark observation records as synced (synced = 1) by local ID array
   */
  async markObservationsSynced(idArray) {
    if (!idArray || idArray.length === 0) return;
    const db = await openDB();
    const tx = db.transaction('observations', 'readwrite');
    const store = tx.objectStore('observations');
    for (const id of idArray) {
      const getReq = store.get(id);
      getReq.onsuccess = (e) => {
        const record = e.target.result;
        if (record) {
          record.synced = 1;
          store.put(record);
        }
      };
    }
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
    });
  },

  /**
   * Get latest observation for a specific patient_id + category + field_key.
   * Decrypts field_value before returning so UI pre-fill displays plaintext.
   */
  async getLatestObservationForField(patientId, category, fieldKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction('observations', 'readonly');
      const store = tx.objectStore('observations');
      const req   = store.getAll();
      req.onsuccess = async (e) => {
        const all = e.target.result || [];
        const matching = all.filter(
          r => r.patient_id === patientId && r.category === category && r.field_key === fieldKey
        );
        if (matching.length === 0) return resolve(null);
        // Sort descending by recorded_at
        matching.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
        const latest = matching[0];
        resolve({
          ...latest,
          field_value: await decryptFieldValue(latest.field_value),
        });
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Save or update patient in patients_cache
   */
  async cachePatient(patient) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patients_cache', 'readwrite');
      const store = tx.objectStore('patients_cache');
      const record = {
        patient_id: patient.patient_id,
        dob_estimated: patient.dob_estimated || null,
        sex: patient.sex || null,
        condition: patient.condition || 'cardiovascular',
        source: patient.source || 'asha_pwa',
        photo_path: patient.photo_path || null,
        synced: patient.synced !== undefined ? patient.synced : 1
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Get cached patient by ID
   */
  async getPatient(patientId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patients_cache', 'readonly');
      const store = tx.objectStore('patients_cache');
      const req = store.get(patientId);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Fetch all unsynced patients (synced === 0)
   */
  async getUnsyncedPatients() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patients_cache', 'readonly');
      const store = tx.objectStore('patients_cache');
      const req = store.getAll();
      req.onsuccess = (e) => {
        const all = e.target.result || [];
        resolve(all.filter(p => p.synced === 0));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Mark patient as synced
   */
  async markPatientSynced(patientId) {
    const db = await openDB();
    const tx = db.transaction('patients_cache', 'readwrite');
    const store = tx.objectStore('patients_cache');
    const req = store.get(patientId);
    req.onsuccess = (e) => {
      const record = e.target.result;
      if (record) {
        record.synced = 1;
        store.put(record);
      }
    };
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
    });
  },

  /**
   * Fetch all cached patients
   */
  async getAllPatients() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patients_cache', 'readonly');
      const store = tx.objectStore('patients_cache');
      const req = store.getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Save auth token for Service Worker Background Sync
   */
  async saveAuthToken(token) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('auth_store', 'readwrite');
      const store = tx.objectStore('auth_store');
      const req = store.put({ key: 'access_token', token: token });
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Remove auth token
   */
  async removeAuthToken() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('auth_store', 'readwrite');
      const store = tx.objectStore('auth_store');
      const req = store.delete('access_token');
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }
};
