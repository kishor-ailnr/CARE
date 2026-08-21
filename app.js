/**
 * CARE ASHA Worker PWA Application Logic (app.js)
 * Vanilla JS SPA Engine - Offline-first, IndexedDB & Sync Integration.
 */

// Easily configurable API Base URL constant
function getCareApiBaseUrl() {
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
var API_BASE_URL = getCareApiBaseUrl();
window.API_BASE_URL = API_BASE_URL;

// Category field definitions matching extend_schema.py CATEGORIES dict
const CATEGORIES = {
  eye: {
    label: "👁️ Eye Related",
    fields: [
      { key: "vision_left", label: "Left Eye Vision (e.g. 6/6)", type: "text" },
      { key: "vision_right", label: "Right Eye Vision (e.g. 6/6)", type: "text" },
      { key: "redness", label: "Redness/Irritation?", type: "bool" },
      { key: "notes", label: "Notes", type: "text" }
    ]
  },
  skin: {
    label: "🧴 Skin Related",
    fields: [
      { key: "rash_present", label: "Rash Present?", type: "bool" },
      { key: "wound_present", label: "Wound/Injury Present?", type: "bool" },
      { key: "notes", label: "Notes", type: "text" }
    ]
  },
  body: {
    label: "🧍 Body Related",
    fields: [
      { key: "height_cm", label: "Height (cm)", type: "number" },
      { key: "weight_kg", label: "Weight (kg)", type: "number" },
      { key: "temperature_c", label: "Body Temperature (°C)", type: "number" },
      { key: "notes", label: "Notes", type: "text" }
    ]
  },
  heart: {
    label: "🫀 Heart Related",
    fields: [
      { key: "systolic_bp", label: "Systolic BP (mmHg)", type: "number" },
      { key: "diastolic_bp", label: "Diastolic BP (mmHg)", type: "number" },
      { key: "heart_rate", label: "Heart Rate (bpm)", type: "number" },
      { key: "chest_pain", label: "Chest Pain Reported?", type: "bool" },
      { key: "notes", label: "Notes", type: "text" }
    ]
  }
};

// State Variables
let currentScreen = 'screen-login';
const screenStack = [];
let currentPatient = null;
let currentCategoryKey = null;
let categoryFormValues = {};
let isServerOnline = false;
let isSyncing = false;

// -----------------------------------------------------------------------------
// DOM Initialization & Event Wiring
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initAuthCheck();
  initNetworkMonitoring();

  const safeOn = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  };

  // Navigation Buttons
  safeOn('nav-back-btn', 'click', handleNavBack);
  safeOn('nav-new-patient-btn', 'click', handleNewPatientReset);

  // Auth Forms
  safeOn('login-form', 'submit', handleLoginSubmit);
  safeOn('logout-btn', 'click', handleLogout);

  // Home Actions
  safeOn('lookup-patient-btn', 'click', handlePatientLookup);
  const lookupInput = document.getElementById('lookup-patient-id');
  if (lookupInput) {
    lookupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePatientLookup();
    });
  }
  safeOn('create-patient-form', 'submit', handleCreatePatientSubmit);

  // Profile Category Click Wiring
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      const categoryKey = card.getAttribute('data-category');
      openCategoryForm(categoryKey);
    });
  });

  // Photo Upload Wiring
  safeOn('upload-photo-btn', 'click', handlePhotoUpload);

  // Category Form Submit
  safeOn('category-observation-form', 'submit', handleCategoryFormSubmit);

  // Confirmation Screen Buttons
  safeOn('confirm-more-btn', 'click', () => {
    if (currentPatient) {
      navigateTo('screen-profile');
    } else {
      navigateTo('screen-home');
    }
  });

  safeOn('confirm-home-btn', 'click', () => {
    navigateTo('screen-home');
  });

  // Wire up all static toggle groups (like smoker/alcohol on create patient)
  document.querySelectorAll('.toggle-group').forEach(group => {
    const options = group.querySelectorAll('.toggle-option');
    options.forEach(opt => {
      opt.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        // If it's linked to a hidden input or just relies on DOM state, the active class holds the state.
      });
    });
  });

  // Start periodic background sync check (every 30 seconds)
  setInterval(triggerBackgroundSync, 30000);
});

// -----------------------------------------------------------------------------
// Service Worker & Network Health Monitoring
// -----------------------------------------------------------------------------

function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        console.log('CARE Service Worker registered with scope:', reg.scope);
      })
      .catch(err => {
        console.warn('CARE Service Worker registration failed:', err);
      });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'TRIGGER_SYNC') {
        triggerBackgroundSync();
      }
    });
  }
}

async function checkServerReachability() {
  if (!navigator.onLine) {
    updateSyncStatusUI(false);
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    isServerOnline = res.ok;
  } catch (err) {
    clearTimeout(timeoutId);
    isServerOnline = false;
  }

  updateSyncStatusUI(isServerOnline);
  return isServerOnline;
}

function initNetworkMonitoring() {
  window.addEventListener('online', () => {
    checkServerReachability().then(online => {
      if (online) triggerBackgroundSync();
    });
  });

  window.addEventListener('offline', () => {
    updateSyncStatusUI(false);
  });

  checkServerReachability();
}

function updateSyncStatusUI(online, syncing = false) {
  const pill = document.getElementById('sync-status');
  const text = document.getElementById('sync-status-text');

  pill.classList.remove('online', 'offline', 'syncing');

  if (syncing) {
    pill.classList.add('syncing');
    text.textContent = 'Syncing...';
  } else if (online) {
    pill.classList.add('online');
    text.textContent = 'Online';
  } else {
    pill.classList.add('offline');
    text.textContent = 'Offline';
  }
}

// -----------------------------------------------------------------------------
// Navigation Router
// -----------------------------------------------------------------------------

function navigateTo(screenId, pushToStack = true) {
  if (pushToStack && currentScreen !== screenId) {
    screenStack.push(currentScreen);
  }

  // Hide all screens
  document.querySelectorAll('section[id^="screen-"]').forEach(sec => {
    sec.classList.add('hidden');
  });

  // Show target screen
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove('hidden');
  }

  currentScreen = screenId;

  // Toggle Global Nav Bar visibility (hidden on login screen)
  const navBar = document.getElementById('global-nav');
  if (navBar) {
    if (screenId === 'screen-login') {
      navBar.classList.add('hidden');
    } else {
      navBar.classList.remove('hidden');
    }
  }
}

function handleNavBack() {
  if (screenStack.length > 0) {
    const prevScreen = screenStack.pop();
    navigateTo(prevScreen, false);
  } else {
    navigateTo('screen-home', false);
  }
}

function handleNewPatientReset() {
  currentPatient = null;
  document.getElementById('lookup-patient-id').value = '';
  document.getElementById('create-patient-form').reset();
  navigateTo('screen-home');
}

// -----------------------------------------------------------------------------
// Auth Logic (Login / Logout)
// -----------------------------------------------------------------------------

function initAuthCheck() {
  const token = localStorage.getItem('care_access_token');
  const username = localStorage.getItem('care_username');
  const role = localStorage.getItem('care_role');

  if (role === 'doctor') return; // Handled by doctor portal

  if (token && username) {
    updateUserWelcomeText();
    navigateTo('screen-home');
  } else {
    navigateTo('screen-login');
  }
}

function updateUserWelcomeText() {
  const name = localStorage.getItem('care_full_name') || localStorage.getItem('care_username') || 'ASHA Worker';
  const role = localStorage.getItem('care_role') || 'asha_worker';
  document.getElementById('welcome-user-text').textContent = `Logged in as ${name} (${role})`;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value.trim();
  const errorBox = document.getElementById('login-error');

  errorBox.classList.add('hidden');
  errorBox.textContent = '';

  const online = await checkServerReachability();

  if (online) {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: 'Invalid credentials' }));
        throw new Error(data.detail || 'Login failed');
      }

      const tokenData = await res.json();
      localStorage.setItem('care_access_token', tokenData.access_token);
      localStorage.setItem('care_role', tokenData.role || 'asha_worker');
      localStorage.setItem('care_full_name', tokenData.full_name || usernameInput);
      localStorage.setItem('care_username', usernameInput);
      
      // Save token for Background Sync service worker
      await CARE_DB.saveAuthToken(tokenData.access_token);

      updateUserWelcomeText();
      navigateTo('screen-home');
      triggerBackgroundSync();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
    }
  } else {
    // Offline Login Fallback (allow demo account login if matching asha1 or cached credentials)
    if ((usernameInput === 'asha1' && passwordInput === 'asha123') || localStorage.getItem('care_username') === usernameInput) {
      localStorage.setItem('care_access_token', 'offline_demo_token');
      localStorage.setItem('care_role', 'asha_worker');
      localStorage.setItem('care_full_name', usernameInput === 'asha1' ? 'Priya (ASHA Worker)' : usernameInput);
      localStorage.setItem('care_username', usernameInput);

      // Clear any previous valid token so SW doesn't use it
      await CARE_DB.removeAuthToken();

      updateUserWelcomeText();
      navigateTo('screen-home');
    } else {
      errorBox.textContent = 'Offline login failed. Use demo account: asha1 / asha123';
      errorBox.classList.remove('hidden');
    }
  }
}

function handleLogout() {
  localStorage.removeItem('care_access_token');
  localStorage.removeItem('care_role');
  localStorage.removeItem('care_full_name');
  localStorage.removeItem('care_username');
  localStorage.removeItem('doctor_access_token');
  localStorage.removeItem('doctor_role');
  localStorage.removeItem('doctor_full_name');
  if (typeof CARE_DB !== 'undefined' && CARE_DB.removeAuthToken) {
    CARE_DB.removeAuthToken().catch(() => {});
  }

  currentPatient = null;
  window.location.href = 'index.html';
}

// -----------------------------------------------------------------------------
// Home Screen (Lookup & Create Patient)
// -----------------------------------------------------------------------------

async function handlePatientLookup() {
  const patientIdInput = document.getElementById('lookup-patient-id').value.trim();
  if (!patientIdInput) return;

  // Try opening cached patient or fetching from API
  let patient = await CARE_DB.getPatient(patientIdInput);

  if (!patient && isServerOnline) {
    try {
      const token = localStorage.getItem('care_access_token');
      const res = await fetch(`${API_BASE_URL}/patients/${patientIdInput}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        patient = await res.json();
        await CARE_DB.cachePatient(patient);
      }
    } catch (err) {
      console.warn('Error fetching patient detail online:', err);
    }
  }

  // If still not found, create a placeholder structure so field worker can record observations
  if (!patient) {
    patient = {
      patient_id: patientIdInput,
      dob_estimated: '1985-01-01',
      sex: 'female',
      condition: 'cardiovascular',
      source: 'lookup',
      photo_path: null,
      synced: 1
    };
    await CARE_DB.cachePatient(patient);
  }

  openPatientProfile(patient);
}

async function handleCreatePatientSubmit(e) {
  e.preventDefault();
  const dob = document.getElementById('create-dob').value;
  const sex = document.getElementById('create-sex').value;
  const condition = document.getElementById('create-condition').value;
  const customId = document.getElementById('create-patient-id').value.trim();

  const patientId = customId ? customId : (crypto.randomUUID ? crypto.randomUUID() : 'pat_' + Date.now());

  const smokerOpt = document.querySelector('#create-smoker-toggle .active');
  const alcoholOpt = document.querySelector('#create-alcohol-toggle .active');
  
  const isSmoker = smokerOpt ? (smokerOpt.dataset.val === 'true') : false;
  const isAlcohol = alcoholOpt ? (alcoholOpt.dataset.val === 'true') : false;

  const patientData = {
    patient_id: patientId,
    dob_estimated: dob,
    sex: sex,
    condition: condition,
    source: 'asha_pwa',
    photo_path: null,
    synced: 0,
    is_smoker: isSmoker,
    alcohol_history: isAlcohol
  };

  // Cache locally in IndexedDB first
  await CARE_DB.cachePatient(patientData);

  // If online, try registering on backend immediately
  const online = await checkServerReachability();
  if (online) {
    try {
      const token = localStorage.getItem('care_access_token');
      const res = await fetch(`${API_BASE_URL}/patients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(patientData)
      });
      if (res.ok) {
        await CARE_DB.markPatientSynced(patientId);
      }
    } catch (err) {
      console.warn('Could not register patient online immediately, cached for sync:', err);
    }
  }

  openPatientProfile(patientData);
}

// -----------------------------------------------------------------------------
// Patient Profile Screen
// -----------------------------------------------------------------------------

function openPatientProfile(patient) {
  currentPatient = patient;

  document.getElementById('profile-patient-id').textContent = `Patient #${patient.patient_id.substring(0, 16)}`;
  document.getElementById('profile-patient-condition').textContent = patient.condition || 'Cardiovascular';

  // Calculate Age from DOB
  let ageStr = '--';
  if (patient.dob_estimated) {
    try {
      const dobDate = new Date(patient.dob_estimated);
      const diffMs = Date.now() - dobDate.getTime();
      const ageDate = new Date(diffMs);
      ageStr = Math.abs(ageDate.getUTCFullYear() - 1970);
    } catch (e) {
      ageStr = '--';
    }
  }

  const sexStr = patient.sex ? patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1) : '--';
  document.getElementById('profile-patient-meta').textContent = `Age: ${ageStr} yrs | Sex: ${sexStr}`;

  // Avatar display
  const avatarContainer = document.getElementById('patient-avatar-container');
  if (patient.photo_path) {
    avatarContainer.innerHTML = `<img src="${patient.photo_path}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="Avatar" />`;
  } else {
    avatarContainer.innerHTML = '👤';
  }

  navigateTo('screen-profile');
}

async function handlePhotoUpload() {
  if (!currentPatient) return;

  const fileInput = document.getElementById('upload-photo-input');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select an image file first.');
    return;
  }

  const file = fileInput.files[0];
  const online = await checkServerReachability();

  if (online) {
    try {
      const token = localStorage.getItem('care_access_token');
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE_URL}/patients/${currentPatient.patient_id}/photo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        currentPatient.photo_path = data.photo_path;
        await CARE_DB.cachePatient(currentPatient);
        openPatientProfile(currentPatient);
        alert('Profile photo uploaded successfully!');
        return;
      }
    } catch (err) {
      console.warn('Photo upload online failed:', err);
    }
  }

  // Local Data URL preview fallback
  const reader = new FileReader();
  reader.onload = async (e) => {
    currentPatient.photo_path = e.target.result;
    await CARE_DB.cachePatient(currentPatient);
    openPatientProfile(currentPatient);
    alert('Photo saved locally in cache.');
  };
  reader.readAsDataURL(file);
}

// -----------------------------------------------------------------------------
// Category Form Screen ("Last Recorded" Prefill & Submissions)
// -----------------------------------------------------------------------------

async function openCategoryForm(categoryKey) {
  if (!currentPatient) return;

  currentCategoryKey = categoryKey;
  const categoryConfig = CATEGORIES[categoryKey];
  if (!categoryConfig) return;

  document.getElementById('category-screen-title').textContent = categoryConfig.label;
  const fieldsContainer = document.getElementById('category-form-fields');
  fieldsContainer.innerHTML = '';
  categoryFormValues = {};

  // Try fetching observations from server or cache to get latest values
  let serverObservations = [];
  if (isServerOnline) {
    try {
      const token = localStorage.getItem('care_access_token');
      const res = await fetch(`${API_BASE_URL}/patients/${currentPatient.patient_id}/observations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.vitals) {
          serverObservations = data.vitals;
        }
      }
    } catch (err) {
      console.warn('Error fetching observations online:', err);
    }
  }

  // Render fields dynamically
  for (const field of categoryConfig.fields) {
    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'form-group';

    // 1. Fetch latest previous observation for this field
    const latestLocal = await CARE_DB.getLatestObservationForField(
      currentPatient.patient_id,
      categoryKey,
      field.key
    );

    let latestVal = null;
    let latestDateStr = null;

    if (latestLocal) {
      latestVal = latestLocal.field_value;
      latestDateStr = formatDate(latestLocal.recorded_at);
    } else if (serverObservations.length > 0) {
      const match = serverObservations.find(v => v.type === field.key || v.field_key === field.key);
      if (match) {
        latestVal = match.value;
        latestDateStr = formatDate(match.timestamp || new Date().toISOString());
      }
    }

    // Render "Last recorded" helper text ONLY if a prior value exists
    if (latestVal !== null && latestVal !== undefined) {
      const badge = document.createElement('div');
      badge.className = 'last-recorded-badge';
      badge.innerHTML = `🕒 Last recorded: <strong>${latestVal}</strong> ${latestDateStr ? 'on ' + latestDateStr : ''}`;
      fieldWrap.appendChild(badge);
    }

    // Render Label
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = field.label;
    fieldWrap.appendChild(label);

    // Render Inputs by Field Type
    if (field.type === 'bool') {
      const toggleWrap = document.createElement('div');
      toggleWrap.className = 'toggle-group';

      const optNo = document.createElement('div');
      optNo.className = 'toggle-option';
      optNo.textContent = 'No';

      const optYes = document.createElement('div');
      optYes.className = 'toggle-option';
      optYes.textContent = 'Yes';

      categoryFormValues[field.key] = null; // Default unselected

      optNo.onclick = () => {
        optNo.classList.add('active');
        optYes.classList.remove('active');
        categoryFormValues[field.key] = 'false';
      };

      optYes.onclick = () => {
        optYes.classList.add('active');
        optNo.classList.remove('active');
        categoryFormValues[field.key] = 'true';
      };

      toggleWrap.appendChild(optNo);
      toggleWrap.appendChild(optYes);
      fieldWrap.appendChild(toggleWrap);
    } else if (field.key === 'notes') {
      const textarea = document.createElement('textarea');
      textarea.className = 'form-textarea';
      textarea.placeholder = 'Add observation notes...';
      textarea.oninput = (e) => { categoryFormValues[field.key] = e.target.value; };
      fieldWrap.appendChild(textarea);
    } else {
      const input = document.createElement('input');
      input.className = 'form-input';
      input.type = field.type === 'number' ? 'number' : 'text';
      if (field.type === 'number') input.step = 'any';
      input.placeholder = `Enter ${field.label.toLowerCase()}`;
      input.oninput = (e) => { categoryFormValues[field.key] = e.target.value; };
      fieldWrap.appendChild(input);
    }

    fieldsContainer.appendChild(fieldWrap);
  }

  navigateTo('screen-category');
}

async function handleCategoryFormSubmit(e) {
  e.preventDefault();
  if (!currentPatient || !currentCategoryKey) return;

  const username = localStorage.getItem('care_username') || 'asha1';
  const recordedAt = new Date().toISOString();
  const newRecords = [];

  // Create an observation for every field with an entered value
  for (const [fKey, fVal] of Object.entries(categoryFormValues)) {
    if (fVal !== null && fVal !== undefined && String(fVal).trim() !== '') {
      const obsRecord = {
        patient_id: currentPatient.patient_id,
        category: currentCategoryKey,
        field_key: fKey,
        field_value: String(fVal).trim(),
        recorded_by: username,
        recorded_at: recordedAt,
        synced: 0
      };
      await CARE_DB.saveObservation(obsRecord);
      newRecords.push(obsRecord);
    }
  }

  // Show Confirmation Screen immediately
  renderConfirmationSummary(newRecords);
  navigateTo('screen-confirmation');

  // Trigger background sync non-blockingly
  triggerBackgroundSync();
}

function renderConfirmationSummary(records) {
  const container = document.getElementById('confirmation-summary');
  if (records.length === 0) {
    container.innerHTML = '<em>No new field values were entered.</em>';
    return;
  }

  let html = `<div style="font-weight:700;margin-bottom:0.4rem;">Patient: ${currentPatient.patient_id.substring(0, 16)}</div>`;
  html += `<div style="color:var(--accent-teal);font-weight:600;margin-bottom:0.6rem;">Category: ${CATEGORIES[currentCategoryKey].label}</div>`;
  html += `<ul style="padding-left:1.2rem;display:flex;flex-direction:column;gap:0.3rem;">`;

  for (const r of records) {
    html += `<li><strong>${r.field_key}:</strong> ${r.field_value}</li>`;
  }
  html += `</ul>`;

  container.innerHTML = html;
}

// -----------------------------------------------------------------------------
// Offline-First Sync Engine
// -----------------------------------------------------------------------------

async function triggerBackgroundSync() {
  if (isSyncing) return;
  const role = localStorage.getItem('care_role');
  if (role && role !== 'asha_worker') return; // Only ASHA workers sync offline observations
  
  isSyncing = true;

  const online = await checkServerReachability();
  if (!online) {
    isSyncing = false;
    return;
  }

  updateSyncStatusUI(true, true);

  try {
    const token = localStorage.getItem('care_access_token');
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    // 1. Sync Unsynced Patients first
    const unsyncedPatients = await CARE_DB.getUnsyncedPatients();
    for (const p of unsyncedPatients) {
      try {
        const res = await fetch(`${API_BASE_URL}/patients`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(p)
        });
        if (res.ok) {
          await CARE_DB.markPatientSynced(p.patient_id);
        }
      } catch (err) {
        console.warn('Patient sync retry error:', err);
      }
    }

    // 2. Sync Unsynced Observations Batch
    const unsyncedObs = await CARE_DB.getUnsyncedObservations();
    if (unsyncedObs.length > 0) {
      const payload = {
        observations: unsyncedObs.map(o => ({
          patient_id: o.patient_id,
          category: o.category,
          field_key: o.field_key,
          field_value: o.field_value,
          recorded_by: o.recorded_by,
          recorded_at: o.recorded_at
        }))
      };

      const res = await fetch(`${API_BASE_URL}/sync`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const localIds = unsyncedObs.map(o => o.id);
        await CARE_DB.markObservationsSynced(localIds);
        console.log(`[Sync Engine] Successfully synced ${unsyncedObs.length} observations to server.`);
      }
    }
  } catch (err) {
    console.warn('[Sync Engine] Background sync error:', err);
  } finally {
    isSyncing = false;
    updateSyncStatusUI(true, false);
  }
}

// Helper: Format ISO date string into readable "Jan 15, 2026"
function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return isoStr;
  }
}
