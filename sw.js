/**
 * CARE Service Worker (sw.js)
 * Fetch Strategy:
 *  - JS / HTML files  → Network-First (fresh code always when online, cache fallback offline)
 *  - Photos           → Cache-First  (binary blobs don't change; serve instantly offline)
 *  - CSS / manifest   → Cache-First  (stable assets)
 *  - API calls        → Pass-through (let app.js handle with IndexedDB fallback)
 */

const CACHE_NAME = 'care-app-shell-v17';
const PHOTO_CACHE_NAME = 'care-doctor-photos-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './asha.html',
  './doctor.html',
  './patient.html',
  './bg-silk.png',
  './stethoscope.jpg',
  './styles.css',
  './doctor_styles.css',
  './app.js',
  './doctor_app.js',
  './doctor_patient_detail.js',
  './db.js',
  './manifest.json'
];

// 1. Install event: Cache App Shell safely
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching CARE app shell assets');
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.warn('[SW] Cache add warning for', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate event: Cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== PHOTO_CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch event
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // ── Photos: Cache-First ───────────────────────────────────────────────────
  if (requestUrl.pathname.startsWith('/photos/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (event.request.method === 'GET' && networkResponse.status === 200) {
            const respToCache = networkResponse.clone();
            caches.open(PHOTO_CACHE_NAME).then((cache) => cache.put(event.request, respToCache));
          }
          return networkResponse;
        }).catch(() => {
          return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24"><text y="20" font-size="20">👤</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
        });
      })
    );
    return;
  }

  // ── API calls: Pass-through (app.js handles offline via IndexedDB) ─────────
  if (requestUrl.pathname.startsWith('/auth') ||
      requestUrl.pathname.startsWith('/patients') ||
      requestUrl.pathname.startsWith('/sync') ||
      requestUrl.pathname.startsWith('/health')) {
    return;
  }

  // ── JS and HTML: Network-First ────────────────────────────────────────────
  // Always try network so code changes reach the browser immediately.
  // Fall back to cache only when the network is genuinely unavailable.
  const isJsOrHtml = requestUrl.pathname.endsWith('.js') ||
                     requestUrl.pathname.endsWith('.html') ||
                     requestUrl.pathname === '/' ||
                     requestUrl.pathname === '';

  if (isJsOrHtml) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        // Update the cache with the fresh response
        if (event.request.method === 'GET' && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Network failed — serve from cache (offline mode)
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Last-resort: return the main shell page for navigation requests
          if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./doctor.html').then(res => res || caches.match('./index.html'));
          }
        });
      })
    );
    return;
  }

  // ── Everything else (CSS, manifest, etc.): Cache-First ───────────────────
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (event.request.method === 'GET' && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      });
    })
  );
});

// =============================================================================
// 4. Background Sync — True offline-first upload
// =============================================================================
//
// SW_API_BASE: The SW runs without a window context so window.location is
// unavailable.  We hardcode the local dev URL; in production this should be
// set to the real server origin via a SW message or a build-time constant.
const SW_API_BASE = 'http://127.0.0.1:8000';

// ── Minimal IndexedDB helpers (SW context, no CARE_DB class available) ───────

/** Open the same DB that db.js uses in the page context. */
function idbOpenSW() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('care_asha_db', 3);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
    // If the DB doesn't exist yet the SW shouldn't create it — onupgradeneeded
    // firing here would mean the page never opened it, so there's nothing to sync.
    req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error('DB not initialised yet')); };
  });
}

/** Return all observations where synced === 0. */
function idbGetUnsyncedObs(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('observations', 'readonly');
    const store = tx.objectStore('observations');
    const req   = store.getAll();
    req.onsuccess = e => resolve((e.target.result || []).filter(r => r.synced === 0));
    req.onerror   = e => reject(e.target.error);
  });
}

/** Mark a list of local IDs as synced (synced = 1). */
function idbMarkSynced(db, ids) {
  if (!ids || ids.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const tx    = db.transaction('observations', 'readwrite');
    const store = tx.objectStore('observations');
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = e => {
        const rec = e.target.result;
        if (rec) { rec.synced = 1; store.put(rec); }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror    = () => resolve(); // best-effort; retry next sync
  });
}

/**
 * Core sync function — runs entirely inside the service worker.
 * Reads unsynced observations from IndexedDB, POSTs them to /sync,
 * and marks them synced on success.
 *
 * The browser guarantees this will be retried automatically if it rejects
 * (e.g. network still unavailable), so throwing on fetch failure is correct.
 */
async function syncQueuedObservations() {
  console.log('[SW BG Sync] syncQueuedObservations() starting…');

  let db;
  try {
    db = await idbOpenSW();
  } catch (e) {
    // DB not yet initialised — nothing to sync, resolve cleanly.
    console.log('[SW BG Sync] DB not ready yet:', e.message);
    return;
  }

  const unsynced = await idbGetUnsyncedObs(db);
  if (unsynced.length === 0) {
    console.log('[SW BG Sync] No unsynced observations found.');
    db.close();
    return;
  }

  console.log(`[SW BG Sync] Uploading ${unsynced.length} queued observations…`);

  const payload = {
    observations: unsynced.map(o => ({
      client_uuid: o.client_uuid || (self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : ('obs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9))),
      patient_id:  o.patient_id,
      category:    o.category,
      field_key:   o.field_key,
      field_value: o.field_value,
      recorded_by: o.recorded_by,
      recorded_at: o.recorded_at
    }))
  };

  // Fetch token from IndexedDB auth_store
  let token = null;
  try {
    token = await new Promise((resolve, reject) => {
      const tx = db.transaction('auth_store', 'readonly');
      const store = tx.objectStore('auth_store');
      const req = store.get('access_token');
      req.onsuccess = e => resolve(e.target.result ? e.target.result.token : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('[SW BG Sync] Failed to read token from IndexedDB:', e);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // This fetch throw will cause the browser to retry the sync tag later.
  const res = await fetch(`${SW_API_BASE}/sync`, {
    method:  'POST',
    headers: headers,
    body:    JSON.stringify(payload)
  });

  if (!res.ok) {
    if (res.status === 401) {
      // Clear token to prevent infinite retry loops on invalid/expired tokens
      const tx = db.transaction('auth_store', 'readwrite');
      tx.objectStore('auth_store').delete('access_token');
      console.warn('[SW BG Sync] Server returned 401. Token cleared.');
      db.close();
      return; // Do not throw, so it stops retrying until new token is given
    }
    db.close();
    throw new Error(`[SW BG Sync] Server returned ${res.status} — will retry.`);
  }

  const ids = unsynced.map(o => o.id);
  await idbMarkSynced(db, ids);
  db.close();

  console.log(`[SW BG Sync] ✅ ${unsynced.length} observations synced successfully.`);

  // Notify any open app tabs so they can update the pending-sync badge.
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETE', count: unsynced.length }));
}

// ── Sync event listener ───────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-observations') {
    // True Background Sync path: handle upload entirely in the SW.
    console.log('[SW] Background sync fired: sync-observations');
    event.waitUntil(syncQueuedObservations());
  }

  if (event.tag === 'care-sync-queue') {
    // Legacy tag kept for backward-compat: also run the full sync rather than
    // just messaging clients (which would be a no-op when the app is closed).
    console.log('[SW] Background sync fired: care-sync-queue (legacy)');
    event.waitUntil(syncQueuedObservations());
  }
});
