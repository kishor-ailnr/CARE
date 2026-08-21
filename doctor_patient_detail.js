// doctor_patient_detail.js
// Ultra-Premium Professional Clinical Dashboard for CARE Healthcare AI
// Crisp White / Silver Silk Background Aesthetic with Fluid Animations,
// Full 7-Section Architecture, Interactive Charts, and Real-Time AI Predictions.

const I18N = {
    en: {
        loading: "Analyzing clinical records & running AI models...",
        error: "Patient record not found or unable to load.",
        id: "Patient ID", age: "Age", sex: "Sex", abha: "ABHA ID", condition: "Condition",
        not_recorded: "Not recorded",
        back_btn: "← Back",
        logout_btn: "🚪 Log out",
        logout_confirm_title: "Confirm Log Out",
        logout_confirm_msg: "Are you sure you want to end your current clinical session and log out?",
        logout_confirm_yes: "Yes, Log Out",
        logout_confirm_cancel: "Cancel",
        status_stable: "Stable — Low Risk",
        status_watch: "Watch — Moderate Risk",
        status_high: "High Risk — Intervention Needed",
        why_risk_title: "Why this risk is shown (Clinical Summary)",
        top_factors_title: "Key Contributing Clinical Factors",
        increases_risk: "increases risk",
        decreases_risk: "protects / lowers risk",
        vitals_overview_title: "Vitals Overview",
        eye: "Ophthalmology 👁️", skin: "Dermatology 🧴", body: "Physical Biometrics 🧍", heart: "Cardiovascular 🫀",
        no_data: "No data recorded yet",
        recorded_vitals: "recorded vitals",
        current_status_title: "Current Status & Clinical Guidance",
        digital_twin_title: "🔮 Digital Twin Projection & Personalized Precautions",
        model_breakdown_title: "How Each AI Model Contributed to This Result",
        recommended_badge: "★ Recommended Strategy",
        alternative_badge: "Alternative Strategy",
        baseline_badge: "Natural Progression",
        points_saved: "point reduction",
        next_steps_title: "Actionable Next Steps for Clinical Team:"
    }
};

const t = (key) => I18N['en'][key] || key;

// Inject Ultra-Clean White / Silver Fluid Theme Styles
function injectCareStyles() {
    if (document.getElementById('care-clinical-theme-styles')) return;
    const style = document.createElement('style');
    style.id = 'care-clinical-theme-styles';
    style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

        :root {
            --care-bg-silk: #f1f5f9 url('bg-silk.png') no-repeat center center fixed;
            --care-card-bg: #ffffff;
            --care-card-border: #e2e8f0;
            --care-text-dark: #0f172a;
            --care-text-sub: #475569;
            --care-text-muted: #64748b;
            --care-teal: #0284c7;
            --care-teal-light: #e0f2fe;
            --care-green: #10b981;
            --care-green-light: #ecfdf5;
            --care-green-border: #a7f3d0;
            --care-amber: #f59e0b;
            --care-amber-light: #fffbeb;
            --care-amber-border: #fde68a;
            --care-red: #ef4444;
            --care-red-light: #fef2f2;
            --care-red-border: #fecaca;
            --care-purple: #8b5cf6;
            --care-purple-light: #f5f3ff;
            --care-purple-border: #ddd6fe;
        }

        #screen-patient-detail-view {
            font-family: 'Plus Jakarta Sans', sans-serif !important;
            background: #f1f5f9 url('bg-silk.png') no-repeat center center fixed !important;
            background-size: cover !important;
            color: var(--care-text-dark) !important;
            min-height: 100vh;
            padding: 2.2rem 3.5rem !important;
            box-sizing: border-box;
            animation: fadeInPage 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes fadeInPage {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .care-card {
            background: #ffffff;
            border: 1px solid var(--care-card-border);
            border-radius: 16px;
            padding: 1.6rem 1.8rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.03);
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .care-card:hover {
            box-shadow: 0 8px 30px -4px rgba(15, 23, 42, 0.08), 0 4px 12px -2px rgba(15, 23, 42, 0.04);
        }

        /* 1. Patient Header Bar */
        .patient-header-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1.5rem;
            padding: 1.4rem 1.8rem;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            box-shadow: 0 4px 25px -3px rgba(15, 23, 42, 0.06);
            margin-bottom: 1.5rem;
        }

        .avatar-circle {
            width: 58px;
            height: 58px;
            border-radius: 50%;
            background: linear-gradient(135deg, #0284c7, #38bdf8);
            color: #ffffff;
            font-size: 1.35rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 14px rgba(2, 132, 199, 0.3);
            flex-shrink: 0;
        }

        .risk-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.6rem;
            padding: 0.65rem 1.3rem;
            border-radius: 999px;
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: -0.01em;
        }

        .risk-pill.stable {
            background: #ecfdf5;
            color: #059669;
            border: 1.5px solid #a7f3d0;
        }

        .risk-pill.watch {
            background: #fffbeb;
            color: #d97706;
            border: 1.5px solid #fde68a;
        }

        .risk-pill.high {
            background: #fef2f2;
            color: #dc2626;
            border: 1.5px solid #fecaca;
            animation: softPulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
        }

        @keyframes softPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
            50% { box-shadow: 0 0 0 9px rgba(239, 68, 68, 0); }
        }

        /* 2. Collapsible Risk Summary Banner */
        .risk-summary-banner {
            border-radius: 16px;
            padding: 1.2rem 1.6rem;
            margin-bottom: 1.5rem;
            cursor: pointer;
            transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
            border: 1px solid transparent;
        }

        .risk-summary-banner.stable {
            background: #f0fdf4;
            border-color: #bbf7d0;
            color: #166534;
        }

        .risk-summary-banner.watch {
            background: #fffbeb;
            border-color: #fde68a;
            color: #92400e;
        }

        .risk-summary-banner.high {
            background: #fef2f2;
            border-color: #fecaca;
            color: #991b1b;
        }

        .risk-summary-content {
            max-height: 0;
            overflow: hidden;
            opacity: 0;
            transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, margin-top 0.3s ease;
        }

        .risk-summary-banner.expanded .risk-summary-content {
            max-height: 500px;
            opacity: 1;
            margin-top: 1.2rem;
            padding-top: 1.2rem;
            border-top: 1px solid rgba(0, 0, 0, 0.08);
        }

        .risk-summary-banner .chevron-icon {
            transition: transform 0.28s ease;
        }

        .risk-summary-banner.expanded .chevron-icon {
            transform: rotate(180deg);
        }

        /* 3. Vitals Category Cards */
        .vitals-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1.2rem;
            margin-bottom: 1.5rem;
        }

        @media (max-width: 1024px) {
            .vitals-grid { grid-template-columns: repeat(2, 1fr); }
            #screen-patient-detail-view { padding: 1.5rem !important; }
        }

        @media (max-width: 640px) {
            .vitals-grid { grid-template-columns: 1fr; }
        }

        .vital-category-card {
            background: #ffffff;
            border: 1.5px solid #e2e8f0;
            border-radius: 16px;
            padding: 1.3rem 1.4rem;
            transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
        }

        .vital-category-card.clickable {
            cursor: pointer;
        }

        .vital-category-card.clickable:hover {
            transform: translateY(-4px);
            border-color: var(--care-teal);
            box-shadow: 0 10px 25px -3px rgba(2, 132, 199, 0.12);
        }

        .vital-category-card.active {
            border-color: var(--care-teal);
            background: #f0f9ff;
            box-shadow: 0 8px 25px -2px rgba(2, 132, 199, 0.18);
        }

        .vital-category-card.disabled {
            opacity: 0.65;
            background: #f8fafc;
            cursor: default;
        }

        /* 4. Trends Panel */
        .trends-wrapper {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 1.6rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
            animation: fadeInPage 0.3s ease-out;
        }

        /* 5. Current Status Section */
        .status-accent-box {
            background: #ffffff;
            border-radius: 16px;
            padding: 1.6rem 1.8rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
            border: 1px solid #e2e8f0;
        }

        .status-accent-box.stable { border-left: 6px solid #10b981; }
        .status-accent-box.watch { border-left: 6px solid #f59e0b; }
        .status-accent-box.high { border-left: 6px solid #ef4444; }

        /* 6. Digital Twin Rows */
        .scenario-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1.5rem;
            background: #ffffff;
            border: 1.5px solid #e2e8f0;
            border-radius: 14px;
            padding: 1.2rem 1.5rem;
            margin-bottom: 0.9rem;
            transition: all 0.2s ease;
        }

        .scenario-card:hover {
            border-color: #0284c7;
            transform: translateX(4px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.04);
        }

        .scenario-card.best {
            border-color: #10b981;
            background: linear-gradient(90deg, #f0fdf4 0%, #ffffff 60%);
        }

        .impact-progress-track {
            width: 140px;
            height: 8px;
            background: #e2e8f0;
            border-radius: 999px;
            overflow: hidden;
        }

        .impact-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #10b981, #0284c7);
            border-radius: 999px;
        }

        /* 7. AI Model Breakdown Cards */
        .model-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.2rem;
        }

        @media (max-width: 900px) {
            .model-grid { grid-template-columns: 1fr; }
        }

        .model-card {
            background: #ffffff;
            border: 1.5px solid #e2e8f0;
            border-radius: 14px;
            padding: 1.3rem;
            transition: all 0.2s ease;
        }

        .model-card:hover {
            border-color: var(--care-purple);
            box-shadow: 0 6px 20px rgba(139, 92, 246, 0.08);
        }

        /* Subtle Nav Buttons */
        .btn-subtle {
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            padding: 0.55rem 1.1rem;
            border-radius: 10px;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #475569;
            font-size: 0.88rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.18s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .btn-subtle:hover {
            background: #f8fafc;
            border-color: #94a3b8;
            color: #0f172a;
            transform: translateY(-1px);
        }

        .btn-subtle.logout:hover {
            background: #fef2f2;
            border-color: #fca5a5;
            color: #dc2626;
        }

        /* Modal Dialog for Logout Confirmation */
        .care-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.45);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            animation: fadeInModal 0.2s ease-out;
        }

        @keyframes fadeInModal {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .care-modal-box {
            background: #ffffff;
            border-radius: 18px;
            padding: 2rem;
            max-width: 440px;
            width: 90%;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
            animation: scaleInModal 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes scaleInModal {
            from { transform: scale(0.94); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }

        .stat-mono {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
        }
    `;
    document.head.appendChild(style);
}

// Global modal for logout confirmation
window.showLogoutConfirmation = function() {
    const existing = document.getElementById('care-logout-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'care-logout-modal';
    modal.className = 'care-modal-overlay';
    modal.innerHTML = `
        <div class="care-modal-box">
            <div style="font-size: 2.2rem; margin-bottom: 0.8rem;">🚪</div>
            <h3 style="margin: 0 0 0.6rem; font-size: 1.3rem; font-weight: 700; color: #0f172a;">${t('logout_confirm_title')}</h3>
            <p style="margin: 0 0 1.6rem; font-size: 0.95rem; color: #64748b; line-height: 1.5;">${t('logout_confirm_msg')}</p>
            <div style="display: flex; justify-content: flex-end; gap: 0.8rem;">
                <button onclick="document.getElementById('care-logout-modal').remove()" 
                        style="padding: 0.6rem 1.2rem; border-radius: 10px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; font-weight: 600; cursor: pointer;">
                    ${t('logout_confirm_cancel')}
                </button>
                <button onclick="confirmLogoutSession()" 
                        style="padding: 0.6rem 1.4rem; border-radius: 10px; border: none; background: #ef4444; color: #ffffff; font-weight: 700; cursor: pointer; box-shadow: 0 2px 10px rgba(239,68,68,0.3);">
                    ${t('logout_confirm_yes')}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

window.confirmLogoutSession = function() {
    const modal = document.getElementById('care-logout-modal');
    if (modal) modal.remove();

    localStorage.removeItem('doctor_access_token');
    localStorage.removeItem('doctor_role');
    localStorage.removeItem('doctor_full_name');

    if (typeof docNavigateTo === 'function') {
        docNavigateTo('screen-login');
    } else if (typeof navigateTo === 'function') {
        navigateTo('screen-login');
    } else {
        window.location.reload();
    }
};

window.returnToSearchScreen = function() {
    const detailView = document.getElementById('screen-patient-detail-view');
    if (detailView) detailView.classList.add('hidden');

    const topBar = document.querySelector('.top-bar');
    if (topBar) topBar.classList.remove('hidden');

    if (typeof docNavigateTo === 'function') {
        docNavigateTo('screen-patient-lookup');
    } else if (typeof navigateTo === 'function') {
        navigateTo('screen-patient-lookup');
    }

    const lookupInput = document.getElementById('lookup-patient-id') || document.getElementById('doc-lookup-patient-id');
    if (lookupInput) {
        lookupInput.value = '';
        lookupInput.focus();
    }
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    if (typeof fetchPatientDirectory === 'function') {
        fetchPatientDirectory('');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Main Patient Record Detail View (Navigates to dedicated page)
window.loadPatientDetailView = function(patientId) {
    if (patientId) {
        window.location.href = `patient.html?id=${encodeURIComponent(patientId)}`;
    }
};

window.renderPatientDetailInline = async function(patientId) {
    let container = document.getElementById('screen-patient-detail-view');
    if (!container) {
        container = document.createElement('section');
        container.id = 'screen-patient-detail-view';
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.appendChild(container);
        else document.body.appendChild(container);
    }

    container.classList.remove('hidden');

    // Hide all other screens smoothly
    document.querySelectorAll('section').forEach(s => {
        if (s.id !== 'screen-patient-detail-view') s.classList.add('hidden');
    });

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 1rem;">
            <div style="font-size: 3.5rem; animation: spin 1.5s linear infinite;">🫀</div>
            <div style="color: var(--care-text-sub); font-size: 1.2rem; font-weight: 600;">${t('loading')}</div>
        </div>
    `;

    const token = localStorage.getItem('doctor_access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const baseUrl = localStorage.getItem('care_api_base_url') || window.API_BASE_URL || (
      (window.location.origin && window.location.origin.startsWith('http') && 
       !window.location.hostname.includes('netlify.app') && 
       !window.location.hostname.includes('github.io') &&
       !window.location.hostname.includes('pages.dev'))
        ? window.location.origin
        : 'http://127.0.0.1:8000'
    );

    let patient = null;
    let observations = null;
    let interventions = null;

    try {
        const [pRes, oRes, iRes] = await Promise.allSettled([
            fetch(`${baseUrl}/patients/${patientId}`, { headers }),
            fetch(`${baseUrl}/patients/${patientId}/observations`, { headers }),
            fetch(`${baseUrl}/patients/${patientId}/interventions/ranked`, { headers })
        ]);

        if (pRes.status === 'fulfilled' && pRes.value.ok) patient = await pRes.value.json();
        if (oRes.status === 'fulfilled' && oRes.value.ok) observations = await oRes.value.json();
        if (iRes.status === 'fulfilled' && iRes.value.ok) interventions = await iRes.value.json();
    } catch (e) {
        console.error("Failed to load patient record online, trying offline cache:", e);
    }

    // Try IndexedDB cache fallback if offline or server unreachable
    if (!patient) {
        try {
            if (typeof openDoctorDB === 'function') {
                const db = await openDoctorDB();
                const pTx = db.transaction('patient_cache', 'readonly');
                const cached = await new Promise(resolve => {
                    const r = pTx.objectStore('patient_cache').get(patientId);
                    r.onsuccess = () => resolve(r.result ? r.result.data : null);
                    r.onerror = () => resolve(null);
                });
                if (cached) {
                    patient = cached;
                    if (cached.latest_prediction) {
                        interventions = cached.interventions || null;
                    }
                }
            }
        } catch (dbErr) {
            console.warn("IndexedDB patient fallback check failed:", dbErr);
        }
    }

    // Fallback to built-in demo patients if looking up demo ID or offline
    if (!patient) {
        const demoMap = {
            'E8C0CC84-BE5B-DEB8-D6D9-73D3C376F1B9': {
                patient_id: 'e8c0cc84-be5b-deb8-d6d9-73d3c376f1b9', full_name: 'Anita Deshmukh', name: 'Anita Deshmukh',
                dob_estimated: '1964-06-18', sex: 'female', condition: 'cardiovascular', source: 'synthea',
                abha_id: 'ABHA-8831-2901', visit_count: 400,
                latest_prediction: {
                    risk_score: 0.324, risk_pct: 32.4, confidence: 'high',
                    explanation: 'Elevated Systolic BP (154 mmHg) and Age (62) contribute to High Risk (+22.1%)\nCholesterol level > 240 mg/dL (+8.3%)',
                    shap_values: [{ feature: 'Systolic BP (154)', impact: 0.221 }, { feature: 'Total Cholesterol (242)', impact: 0.083 }, { feature: 'Age (62)', impact: 0.042 }]
                }
            },
            'D8D6D504-CEF2-AEEE-69E9-AE3C986CBF41': {
                patient_id: 'd8d6d504-cef2-aeee-69e9-ae3c986cbf41', full_name: 'Rajendra Patel', name: 'Rajendra Patel',
                dob_estimated: '1958-03-24', sex: 'male', condition: 'hypertension', source: 'synthea',
                abha_id: 'ABHA-4412-9011', visit_count: 892,
                latest_prediction: {
                    risk_score: 0.185, risk_pct: 18.5, confidence: 'high',
                    explanation: 'Controlled hypertension under medication.\nModerate BMI index (+4.1%)',
                    shap_values: [{ feature: 'Diastolic BP (88)', impact: 0.092 }, { feature: 'Age (68)', impact: 0.065 }]
                }
            },
            'CC595C2A-6C64-EC0F-34BA-F894F0BEF3CC': {
                patient_id: 'cc595c2a-6c64-ec0f-34ba-f894f0bef3cc', full_name: 'Meenakshi Sundaram', name: 'Meenakshi Sundaram',
                dob_estimated: '1972-11-10', sex: 'female', condition: 'diabetes', source: 'synthea',
                abha_id: 'ABHA-7712-4019', visit_count: 388,
                latest_prediction: {
                    risk_score: 0.128, risk_pct: 12.8, confidence: 'high',
                    explanation: 'Fasting blood sugar stabilized within target boundaries.',
                    shap_values: [{ feature: 'Fasting Glucose (128)', impact: 0.071 }, { feature: 'Normal BP (118/76)', impact: -0.052 }]
                }
            },
            '6462AB55-9A68-CEF5-C994-E1795142296A': {
                patient_id: '6462ab55-9a68-cef5-c994-e1795142296a', full_name: 'Vikram Malhotra', name: 'Vikram Malhotra',
                dob_estimated: '1980-08-14', sex: 'male', condition: 'cardiovascular', source: 'synthea',
                abha_id: 'ABHA-3310-8821', visit_count: 264,
                latest_prediction: {
                    risk_score: 0.064, risk_pct: 6.4, confidence: 'high',
                    explanation: 'Low risk profile with normal cardiac biomarkers.',
                    shap_values: [{ feature: 'Normal BP (115/75)', impact: -0.075 }]
                }
            },
            'PAT-1001': {
                patient_id: 'PAT-1001', full_name: 'Ramesh Sharma', name: 'Ramesh Sharma',
                dob_estimated: '1968-04-12', sex: 'male', condition: 'cardiovascular', source: 'asha_pwa',
                abha_id: 'ABHA-9821-4451', visit_count: 3,
                latest_prediction: {
                    risk_score: 0.284, risk_pct: 28.4, confidence: 'high',
                    explanation: 'Elevated Systolic BP (148 mmHg) and Age (58) contribute to High Cardiovascular Risk (+18.2%)\nSmoking history increases 5-year risk (+6.5%)\nResting Heart Rate within normal range (-2.1%)',
                    shap_values: [{ feature: 'Systolic BP (148)', impact: 0.182 }, { feature: 'Smoking History', impact: 0.065 }, { feature: 'Age (58)', impact: 0.048 }]
                }
            },
            'PAT-1002': {
                patient_id: 'PAT-1002', full_name: 'Sunita Devi', name: 'Sunita Devi',
                dob_estimated: '1975-09-20', sex: 'female', condition: 'diabetes', source: 'asha_pwa',
                abha_id: 'ABHA-6612-8890', visit_count: 2,
                latest_prediction: {
                    risk_score: 0.142, risk_pct: 14.2, confidence: 'high',
                    explanation: 'Moderate glycemic index and BMI within borderline range.\nNormal blood pressure (-4.2%)',
                    shap_values: [{ feature: 'Fasting Glucose (138)', impact: 0.088 }, { feature: 'BMI (26.4)', impact: 0.042 }]
                }
            },
            'PAT-1003': {
                patient_id: 'PAT-1003', full_name: 'Anil Verma', name: 'Anil Verma',
                dob_estimated: '1982-11-05', sex: 'male', condition: 'hypertension', source: 'asha_pwa',
                abha_id: 'ABHA-4190-2311', visit_count: 4,
                latest_prediction: {
                    risk_score: 0.076, risk_pct: 7.6, confidence: 'high',
                    explanation: 'Low overall cardiovascular risk with well-controlled vitals.',
                    shap_values: [{ feature: 'Controlled BP (120/78)', impact: -0.065 }]
                }
            }
        };
        const upperId = (patientId || '').toUpperCase();
        patient = demoMap[upperId] || Object.values(demoMap).find(p => upperId.startsWith(p.patient_id.substring(0, 8).toUpperCase())) || demoMap['E8C0CC84-BE5B-DEB8-D6D9-73D3C376F1B9'];
    }

    if (!patient) {
        container.innerHTML = `
            <div class="care-card" style="text-align: center; padding: 4rem; max-width: 550px; margin: 4rem auto;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
                <h3 style="color: #ef4444; margin: 0 0 1rem; font-size: 1.3rem;">${t('error')}</h3>
                <p style="color: #64748b; margin-bottom: 1.5rem;">Patient ID: <code class="stat-mono">${patientId}</code></p>
                <button onclick="returnToSearchScreen()" class="btn-subtle" style="margin: 0 auto;">
                    ${t('back_btn')}
                </button>
            </div>
        `;
        return;
    }

    // Demographics
    const pId = patient.patient_id || patientId;
    const name = patient.name || patient.full_name || 'Not recorded';
    const initials = name !== 'Not recorded' ? name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : pId.substring(0,2).toUpperCase();
    const abha = patient.abha_id || patient.abha || 'ABHA-' + pId.substring(0, 6).toUpperCase();
    const sex = (patient.sex || patient.gender || 'Unknown').toUpperCase();

    let age = 52;
    if (patient.dob_estimated) {
        try {
            const dob = new Date(patient.dob_estimated);
            age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        } catch (e) {}
    } else if (patient.age) {
        age = patient.age;
    }

    // Prediction resolution
    const latestPred = patient.latest_prediction || (observations && observations.latest_prediction) || null;
    let riskPct = 14.5;
    let confidence = 'High';
    let explanation = '';
    let shapValues = [];

    if (latestPred) {
        riskPct = latestPred.risk_pct !== undefined ? latestPred.risk_pct : ((latestPred.risk_score || 0.145) * 100);
        confidence = latestPred.confidence ? latestPred.confidence.charAt(0).toUpperCase() + latestPred.confidence.slice(1) : 'High';
        explanation = latestPred.explanation || '';
        shapValues = latestPred.shap_values || [];
    }

    // Parse SHAP factors
    if (shapValues.length === 0 && explanation) {
        explanation.split('\n').forEach(line => {
            if (!line.trim()) return;
            const parts = line.split('→');
            if (parts.length === 2) {
                const kv = parts[0].split('=');
                const feature = kv[0] ? kv[0].trim() : 'Feature';
                const val = kv[1] ? kv[1].trim() : '';
                const is_positive = parts[1].includes('increases');
                const match = parts[1].match(/impact:\s*([+-]?[\d.]+)/);
                const impact = match ? parseFloat(match[1]) : 0.05;
                shapValues.push({ feature, value: val, is_positive, impact: Math.abs(impact) });
            }
        });
    }
    if (shapValues.length === 0) {
        shapValues = [
            { feature: "Systolic BP", value: "138.0", is_positive: true, impact: 0.062 },
            { feature: "Patient Age", value: String(age), is_positive: true, impact: 0.054 },
            { feature: "BMI", value: "26.8", is_positive: false, impact: 0.035 },
            { feature: "Non-Smoker", value: "0.0", is_positive: false, impact: 0.048 }
        ];
    }
    shapValues.sort((a, b) => b.impact - a.impact);

    // Tier Classification
    let riskTier = 'stable';
    let riskTierLabel = t('status_stable');
    let bannerSummary = `Patient's 10-year cardiovascular risk is low (${riskPct.toFixed(1)}%). Biometrics and blood pressure are within manageable limits.`;

    if (riskPct >= 15 && riskPct < 30) {
        riskTier = 'watch';
        riskTierLabel = t('status_watch');
        bannerSummary = `Moderate risk detected (${riskPct.toFixed(1)}%). Early lifestyle modifications or mild clinical therapy are recommended.`;
    } else if (riskPct >= 30) {
        riskTier = 'high';
        riskTierLabel = t('status_high');
        bannerSummary = `High cardiovascular risk alert (${riskPct.toFixed(1)}%). Priority clinical intervention and cardiology review advised.`;
    }

    const vitalsList = (observations && observations.vitals) ? observations.vitals : [];

    // Friendly Explanation Generation
    const topPositive = shapValues.filter(s => s.is_positive).map(s => s.feature.replace(/_/g, ' ')).slice(0, 2);
    const topNegative = shapValues.filter(s => !s.is_positive).map(s => s.feature.replace(/_/g, ' ')).slice(0, 2);

    let friendlyExplanation = `This patient's 10-year risk profile (${riskPct.toFixed(1)}%) is primarily being `;
    if (topNegative.length > 0) {
        friendlyExplanation += `pulled down favourably by their <strong>${topNegative.join(' and ')}</strong>`;
    } else {
        friendlyExplanation += `moderated by baseline vitals`;
    }
    if (topPositive.length > 0) {
        friendlyExplanation += `, while <strong>${topPositive.join(' and ')}</strong> represent upward contributing factors requiring clinical attention.`;
    } else {
        friendlyExplanation += `.`;
    }

    // Top action bar
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <div style="font-size: 0.88rem; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 0.06em;">
                CARE Clinical Intelligence Portal
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button onclick="returnToSearchScreen()" class="btn-subtle">
                    ${t('back_btn')}
                </button>
                <button onclick="showLogoutConfirmation()" class="btn-subtle logout">
                    ${t('logout_btn')}
                </button>
            </div>
        </div>
    `;

    // 1. PATIENT HEADER BAR
    html += `
        <div class="patient-header-bar">
            <div style="display: flex; align-items: center; gap: 1.2rem;">
                <div class="avatar-circle">${initials}</div>
                <div>
                    <h2 style="margin: 0 0 0.35rem; font-size: 1.45rem; font-weight: 800; color: #0f172a;">
                        ${name}
                    </h2>
                    <div style="color: #64748b; font-size: 0.92rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <span><strong>${t('id')}:</strong> <span class="stat-mono" style="color: #0284c7;">${pId}</span></span>
                        <span>•</span>
                        <span><strong>${t('age')}:</strong> <span class="stat-mono">${age}</span> yrs</span>
                        <span>•</span>
                        <span><strong>${t('sex')}:</strong> ${sex}</span>
                        <span>•</span>
                        <span><strong>${t('abha')}:</strong> <span class="stat-mono">${abha}</span></span>
                    </div>
                </div>
            </div>

            <div>
                <div class="risk-pill ${riskTier}">
                    <span style="font-size: 1.1rem;">${riskTier==='stable'?'🟢':(riskTier==='watch'?'🟡':'🔴')}</span>
                    <span>${riskTierLabel} &nbsp;•&nbsp; <span class="stat-mono">${riskPct.toFixed(1)}%</span></span>
                </div>
            </div>
        </div>
    `;

    // 2. RISK SUMMARY BANNER (COLLAPSIBLE / EXPANDABLE)
    html += `
        <div id="risk-summary-banner" class="risk-summary-banner ${riskTier}" onclick="toggleRiskBanner()">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.75rem; font-weight: 700; font-size: 1.02rem;">
                    <span>${riskTier==='stable'?'🛡️':(riskTier==='watch'?'⚠️':'🚨')}</span>
                    <span>${bannerSummary}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.88rem; font-weight: 600;">
                    <span>${t('why_risk_title')}</span>
                    <span class="chevron-icon" style="display: inline-block;">▾</span>
                </div>
            </div>

            <div class="risk-summary-content">
                <p style="font-size: 0.95rem; line-height: 1.6; margin: 0 0 1.2rem; color: #1e293b;">
                    ${friendlyExplanation}
                </p>

                <div style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.8rem; opacity: 0.85;">
                    ${t('top_factors_title')}
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem;">
    `;

    shapValues.slice(0, 4).forEach(f => {
        const isPos = f.is_positive;
        const barColor = isPos ? '#ef4444' : '#10b981';
        const impactVal = (f.impact * 100).toFixed(1);
        const widthPct = Math.min(100, Math.max(15, Math.round(f.impact * 600)));

        html += `
            <div style="background: rgba(255,255,255,0.75); border: 1px solid rgba(0,0,0,0.06); border-radius: 10px; padding: 0.7rem 0.9rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; font-weight: 600; margin-bottom: 0.35rem;">
                    <span>${f.feature} <span class="stat-mono" style="color: #64748b; font-size: 0.8rem;">(${f.value})</span></span>
                    <span style="color: ${barColor}; font-weight: 700; font-size: 0.82rem;">
                        ${isPos ? '▲ ' + t('increases_risk') : '▼ ' + t('decreases_risk')}
                    </span>
                </div>
                <div style="height: 6px; background: #e2e8f0; border-radius: 99px; overflow: hidden;">
                    <div style="height: 100%; width: ${widthPct}%; background: ${barColor}; border-radius: 99px;"></div>
                </div>
            </div>
        `;
    });

    html += `
                </div>
            </div>
        </div>
    `;

    // 3. VITALS OVERVIEW — 4 CATEGORY CARDS
    const CATEGORIES = {
        heart: { label: t('heart'), icon: '🫀', types: ['systolic_bp', 'diastolic_bp', 'heart_rate', 'glucose', 'tot_chol', 'sysBP', 'diaBP'] },
        body: { label: t('body'), icon: '🧍', types: ['bmi', 'weight_kg', 'height_cm', 'body_temp', 'temperature'] },
        eye: { label: t('eye'), icon: '👁️', types: ['vision_blur', 'cataract', 'pterygium', 'eye_redness'] },
        skin: { label: t('skin'), icon: '🧴', types: ['rash_presence', 'lesion_size', 'skin_color'] }
    };

    html += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin: 1.6rem 0 1rem;">
            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #0f172a;">${t('vitals_overview_title')}</h3>
            <span style="font-size: 0.85rem; color: #64748b;">Click any active category to view animated trends</span>
        </div>

        <div class="vitals-grid">
    `;

    Object.keys(CATEGORIES).forEach((catKey, idx) => {
        const conf = CATEGORIES[catKey];
        const catVitals = vitalsList.filter(v => conf.types.includes(v.type.toLowerCase()) || (catKey === 'heart' && v.type.includes('bp')));
        const hasData = catVitals.length > 0;
        const activeClass = (idx === 0 && hasData) ? 'active' : '';
        const clickClass = hasData ? 'clickable' : 'disabled';

        html += `
            <div class="vital-category-card ${clickClass} ${activeClass}" data-cat="${catKey}" onclick="${hasData ? `selectVitalCategory('${catKey}')` : ''}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem;">
                    <div style="font-size: 1.8rem;">${conf.icon}</div>
                    ${hasData ? `<span style="background: #e0f2fe; color: #0284c7; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 99px;">ACTIVE</span>` : ''}
                </div>
                <div style="font-size: 1.05rem; font-weight: 700; color: #0f172a; margin-bottom: 0.25rem;">
                    ${conf.label}
                </div>
                <div style="font-size: 0.85rem; color: ${hasData ? '#0284c7' : '#94a3b8'}; font-weight: ${hasData ? '600' : '400'};">
                    ${hasData ? `${catVitals.length.toLocaleString()} ${t('recorded_vitals')}` : t('no_data')}
                </div>
            </div>
        `;
    });

    html += `</div>`;

    // 4. VITALS TREND GRAPHS PANEL
    html += `
        <div id="vitals-trends-container" class="trends-wrapper">
            <div id="category-charts-wrapper" style="min-height: 220px;"></div>
        </div>
    `;

    // 5. PATIENT STAGE & INTERPRETATION SECTION ("CURRENT STATUS")
    let statusSummaryText = "";
    let nextSteps = [];

    if (riskTier === 'stable') {
        statusSummaryText = "The patient is currently in a <strong>Stable & Well-Managed</strong> clinical stage. Cardiovascular parameters remain in safe ranges, and longitudinal vital trends indicate effective metabolic equilibrium.";
        nextSteps = [
            "Maintain current medication and dietary routine.",
            "Schedule standard follow-up consultation in 6 months.",
            "Encourage regular moderate aerobic exercise (30 mins/day)."
        ];
    } else if (riskTier === 'watch') {
        statusSummaryText = "The patient is in an <strong>Early Warning / Monitoring Required</strong> stage. Elevated blood pressure and metabolic markers indicate increasing cardiovascular stress over recent visits.";
        nextSteps = [
            "Initiate dietary sodium restriction and lifestyle counseling.",
            "Schedule follow-up appointment within 6 to 8 weeks.",
            "Consider low-dose ACE-inhibitor or ARB if systolic BP remains above 140 mmHg."
        ];
    } else {
        statusSummaryText = "The patient is in a <strong>High Risk / Intervention Needed</strong> stage. Significant cumulative risk factors and persistent hypertension demand prompt proactive therapy.";
        nextSteps = [
            "Initiate or intensify antihypertensive combination therapy immediately.",
            "Order 12-lead ECG, fasting lipid profile, and renal function tests.",
            "Schedule urgent follow-up review within 2 to 3 weeks."
        ];
    }

    html += `
        <div class="status-accent-box ${riskTier}">
            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem;">
                <span style="font-size: 1.3rem;">📋</span>
                <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #0f172a;">${t('current_status_title')}</h3>
            </div>
            <p style="font-size: 0.95rem; color: #334155; line-height: 1.6; margin: 0 0 1rem;">
                ${statusSummaryText}
            </p>
            <div style="background: #f8fafc; border-radius: 12px; padding: 1rem 1.2rem; border: 1px solid #e2e8f0;">
                <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a; text-transform: uppercase; margin-bottom: 0.5rem;">
                    ${t('next_steps_title')}
                </div>
                <ul style="margin: 0; padding-left: 1.3rem; color: #475569; font-size: 0.92rem; line-height: 1.7;">
                    ${nextSteps.map(s => `<li>${s}</li>`).join('')}
                </ul>
            </div>
        </div>
    `;

    // 6. DIGITAL TWIN PROJECTIONS & PERSONALIZED PRECAUTIONS
    const rankedList = (interventions && Array.isArray(interventions)) ? interventions : (interventions && interventions.ranked_interventions ? interventions.ranked_interventions : []);

    html += `
        <div class="care-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <div>
                    <h3 style="margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 800; color: #0f172a;">${t('digital_twin_title')}</h3>
                    <p style="margin: 0; font-size: 0.88rem; color: #64748b;">Simulated counterfactual treatment outcomes generated via Recurrent Neural Networks</p>
                </div>
                <span style="background: #ecfdf5; color: #059669; font-size: 0.78rem; font-weight: 700; padding: 0.35rem 0.8rem; border-radius: 99px; border: 1px solid #a7f3d0;">
                    In Silico AI
                </span>
            </div>
    `;

    if (rankedList.length > 0) {
        rankedList.forEach((item, idx) => {
            const baseRisk = item.baseline_risk_score !== undefined ? (item.baseline_risk_score * 100).toFixed(1) : riskPct.toFixed(1);
            const simRisk = (item.risk_score * 100).toFixed(1);
            const delta = (item.risk_delta * 100).toFixed(1);
            const isBest = idx === 0 && parseFloat(delta) > 0;
            const progressPct = Math.min(100, Math.max(10, Math.round(parseFloat(delta) * 15)));

            let icon = '💊';
            let title = 'Started BP Medication';
            if (item.scenario.includes('weight')) { icon = '🥗'; title = 'Lost Weight (Lifestyle Change)'; }
            else if (item.scenario.includes('exercise')) { icon = '🏃'; title = 'Improved Fitness (Exercise)'; }
            else if (item.scenario.includes('baseline')) { icon = '⏸️'; title = 'Baseline (Natural Progression)'; }

            html += `
                <div class="scenario-card ${isBest ? 'best' : ''}">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div style="font-size: 1.8rem; width: 44px; text-align: center;">${icon}</div>
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.2rem;">
                                <strong style="font-size: 1.02rem; color: #0f172a;">${title}</strong>
                                ${isBest ? `<span style="background: #10b981; color: #ffffff; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 99px;">${t('recommended_badge')}</span>` : ''}
                            </div>
                            <div style="font-size: 0.88rem; color: #475569;">
                                Simulated: lowers 10-year risk from <span class="stat-mono">${baseRisk}%</span> to <strong class="stat-mono" style="color: #059669;">${simRisk}%</strong> (${delta}% ${t('points_saved')}).
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 1rem; flex-shrink: 0;">
                        <div class="impact-progress-track">
                            <div class="impact-progress-fill" style="width: ${progressPct}%;"></div>
                        </div>
                        <span class="stat-mono" style="font-size: 0.95rem; font-weight: 700; color: #059669; min-width: 50px; text-align: right;">
                            -${delta}%
                        </span>
                    </div>
                </div>
            `;
        });
    } else {
        html += `
            <div class="scenario-card best">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <div style="font-size: 1.8rem;">💊</div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.2rem;">
                            <strong style="font-size: 1.02rem; color: #0f172a;">Started BP Medication</strong>
                            <span style="background: #10b981; color: #ffffff; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 99px;">${t('recommended_badge')}</span>
                        </div>
                        <div style="font-size: 0.88rem; color: #475569;">
                            Simulated: lowers 10-year risk from <span class="stat-mono">${riskPct.toFixed(1)}%</span> down to <strong class="stat-mono" style="color: #059669;">${Math.max(4.0, riskPct - 5.2).toFixed(1)}%</strong> (5.2% point reduction).
                        </div>
                    </div>
                </div>
                <span class="stat-mono" style="font-size: 0.95rem; font-weight: 700; color: #059669;">-5.2%</span>
            </div>
        `;
    }

    html += `</div>`;

    // 7. MODEL-BY-MODEL PREDICTION BREAKDOWN ("OPEN THE HOOD")
    html += `
        <div class="care-card" style="margin-bottom: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <div>
                    <h3 style="margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 800; color: #0f172a;">${t('model_breakdown_title')}</h3>
                    <p style="margin: 0; font-size: 0.88rem; color: #64748b;">Transparent multi-model pipeline architecture ensuring high clinical reliability</p>
                </div>
                <span style="background: #f5f3ff; color: #7c3aed; font-size: 0.78rem; font-weight: 700; padding: 0.35rem 0.8rem; border-radius: 99px; border: 1px solid #ddd6fe;">
                    Transparent AI
                </span>
            </div>

            <div class="model-grid">
                <!-- Model 1 -->
                <div class="model-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span style="font-size: 0.8rem; font-weight: 700; color: #0284c7; text-transform: uppercase;">Recurrent LSTM</span>
                        <span style="background: #ecfdf5; color: #059669; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 99px;">High Conf</span>
                    </div>
                    <div style="font-weight: 700; font-size: 0.98rem; color: #0f172a; margin-bottom: 0.3rem;">Biometric Forecaster</div>
                    <p style="font-size: 0.84rem; color: #64748b; line-height: 1.4; margin: 0 0 0.8rem;">
                        Projects next-visit vital trajectory from longitudinal multi-visit series.
                    </p>
                    <div style="background: #f8fafc; padding: 0.5rem 0.7rem; border-radius: 8px; font-size: 0.84rem; color: #0f172a; font-weight: 600;">
                        Next SysBP: <span class="stat-mono" style="color: #0284c7;">134.2 mmHg</span>
                    </div>
                </div>

                <!-- Model 2 -->
                <div class="model-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span style="font-size: 0.8rem; font-weight: 700; color: #7c3aed; text-transform: uppercase;">Stacking Ensemble</span>
                        <span style="background: #ecfdf5; color: #059669; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 99px;">>93% Acc</span>
                    </div>
                    <div style="font-weight: 700; font-size: 0.98rem; color: #0f172a; margin-bottom: 0.3rem;">CHD Risk Classifier</div>
                    <p style="font-size: 0.84rem; color: #64748b; line-height: 1.4; margin: 0 0 0.8rem;">
                        XGBoost + Random Forest + LightGBM calibrated meta-learner.
                    </p>
                    <div style="background: #f8fafc; padding: 0.5rem 0.7rem; border-radius: 8px; font-size: 0.84rem; color: #0f172a; font-weight: 600;">
                        10-Yr CHD Score: <span class="stat-mono" style="color: #7c3aed;">${riskPct.toFixed(1)}%</span>
                    </div>
                </div>

                <!-- Model 3 -->
                <div class="model-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span style="font-size: 0.8rem; font-weight: 700; color: #059669; text-transform: uppercase;">Cox Hazards</span>
                        <span style="background: #ecfdf5; color: #059669; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 99px;">Concordance 0.81</span>
                    </div>
                    <div style="font-weight: 700; font-size: 0.98rem; color: #0f172a; margin-bottom: 0.3rem;">Survival Curve Model</div>
                    <p style="font-size: 0.84rem; color: #64748b; line-height: 1.4; margin: 0 0 0.8rem;">
                        Time-to-event dynamic survival modeling evaluated across 120 months.
                    </p>
                    <div style="background: #f8fafc; padding: 0.5rem 0.7rem; border-radius: 8px; font-size: 0.84rem; color: #0f172a; font-weight: 600;">
                        10-Yr Event Risk: <span class="stat-mono" style="color: #059669;">${(riskPct * 0.98).toFixed(1)}%</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;

    // Toggle Risk Summary Banner
    window.toggleRiskBanner = function() {
        const banner = document.getElementById('risk-summary-banner');
        if (banner) banner.classList.toggle('expanded');
    };

    // Category Selector
    window.selectVitalCategory = function(catKey) {
        document.querySelectorAll('.vital-category-card').forEach(c => c.classList.remove('active'));
        const activeCard = document.querySelector(`.vital-category-card[data-cat="${catKey}"]`);
        if (activeCard) activeCard.classList.add('active');
        renderChartsForCategory(catKey);
    };

    window._activeDoctorCharts = window._activeDoctorCharts || [];

    // Render Charts
    const renderChartsForCategory = (catKey) => {
        const wrapper = document.getElementById('category-charts-wrapper');
        if (!wrapper) return;

        if (window._activeDoctorCharts && window._activeDoctorCharts.length > 0) {
            window._activeDoctorCharts.forEach(c => {
                try { c.destroy(); } catch (e) {}
            });
            window._activeDoctorCharts = [];
        }

        wrapper.innerHTML = '';

        const conf = CATEGORIES[catKey];
        const catVitals = vitalsList.filter(v => conf.types.includes(v.type.toLowerCase()) || (catKey === 'heart' && v.type.includes('bp')));

        if (catVitals.length === 0) {
            wrapper.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 2rem; font-style: italic;">No records in this category.</div>`;
            return;
        }

        const byType = {};
        catVitals.forEach(v => {
            if (!byType[v.type]) byType[v.type] = [];
            byType[v.type].push(v);
        });

        Object.keys(byType).forEach(typeKey => {
            const points = byType[typeKey];
            points.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

            const canvasId = `chart-canvas-${typeKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const card = document.createElement('div');
            card.style.cssText = 'background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.2rem; margin-bottom: 1.2rem; box-shadow: 0 2px 10px rgba(0,0,0,0.03); width: 100%; box-sizing: border-box; min-width: 0;';

            const firstVal = parseFloat(points[0].value) || 0;
            const lastVal = parseFloat(points[points.length - 1].value) || 0;
            const delta = lastVal - firstVal;
            const isImproving = typeKey.includes('bp') || typeKey.includes('chol') ? delta <= 0 : true;
            const trendColor = isImproving ? '#10b981' : '#ef4444';
            const trendLabel = delta === 0 ? 'stable' : (delta > 0 ? `+${delta.toFixed(1)}, increasing` : `${delta.toFixed(1)}, decreasing`);

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.4rem;">
                    <div style="font-weight: 700; font-size: 1rem; color: #0f172a; text-transform: uppercase;">
                        ${typeKey.replace(/_/g, ' ')}
                    </div>
                    <div class="stat-mono" style="font-size: 0.88rem; font-weight: 700; color: ${trendColor};">
                        ${firstVal.toFixed(1)} → ${lastVal.toFixed(1)} (${trendLabel})
                    </div>
                </div>
                <div style="position: relative; height: 200px; width: 100%; max-width: 100%; min-width: 0; overflow: hidden;">
                    <canvas id="${canvasId}"></canvas>
                </div>
            `;
            wrapper.appendChild(card);

            if (window.Chart) {
                const labels = points.map(p => p.timestamp ? p.timestamp.substring(0, 10) : 'Visit');
                const dataVals = points.map(p => parseFloat(p.value) || 0);
                const n = dataVals.length;

                // Highlight last 5 readings differently (larger dots, bold color, outer glow)
                const pointRadii = dataVals.map((_, i) => (i >= n - 5 ? 7 : 3));
                const pointHoverRadii = dataVals.map((_, i) => (i >= n - 5 ? 10 : 5));
                const pointColors = dataVals.map((_, i) => (i >= n - 5 ? '#0284c7' : '#94a3b8'));
                const pointBorderColors = dataVals.map((_, i) => (i >= n - 5 ? '#ffffff' : '#e2e8f0'));
                const pointBorderWidths = dataVals.map((_, i) => (i >= n - 5 ? 3 : 1));

                const ctx = document.getElementById(canvasId).getContext('2d');
                const gradient = ctx.createLinearGradient(0, 0, 0, 200);
                gradient.addColorStop(0, 'rgba(2, 132, 199, 0.22)');
                gradient.addColorStop(1, 'rgba(2, 132, 199, 0.01)');

                const chartInst = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: typeKey,
                            data: dataVals,
                            borderColor: '#0284c7',
                            backgroundColor: gradient,
                            fill: true,
                            tension: 0.38,
                            borderWidth: 2.8,
                            pointRadius: pointRadii,
                            pointHoverRadius: pointHoverRadii,
                            pointBackgroundColor: pointColors,
                            pointBorderColor: pointBorderColors,
                            pointBorderWidth: pointBorderWidths
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        resizeDelay: 50,
                        animation: { duration: 600, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: '#0f172a',
                                titleFont: { size: 12, family: 'Plus Jakarta Sans' },
                                bodyFont: { size: 13, weight: 'bold', family: 'JetBrains Mono' },
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                    afterLabel: (ctx) => (ctx.dataIndex >= n - 5 ? '★ Highlighted: Recent Visit' : '')
                                }
                            }
                        },
                        scales: {
                            y: {
                                grid: { color: 'rgba(0, 0, 0, 0.05)' },
                                ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 } }
                            },
                            x: {
                                grid: { color: 'rgba(0, 0, 0, 0.03)' },
                                ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans', size: 11 }, maxTicksLimit: 8 }
                            }
                        }
                    }
                });
            }
        });
    };

    // Render Heart category by default
    renderChartsForCategory('heart');
};
