"""
CARE Dashboard: patient history, LSTM forecasting, digital twin simulation,
intervention ranking, SHAP explanations, and Cox survival risk trajectory.
Glassmorphic / neomorphic styling with animated risk cards.

Run with: streamlit run dashboard.py
"""
import json
import sqlite3
import joblib
import shap
import numpy as np
import pandas as pd
import streamlit as st
from pathlib import Path
from datetime import datetime
from tensorflow.keras.models import load_model

DB_PATH = Path(__file__).parent / "care.db"
MODEL_PATH = Path(__file__).parent / "models" / "bp_lstm_model_v3.keras"
NORM_PATH = Path(__file__).parent / "models" / "norm_constants.json"
RISK_MODEL_PATH = Path(__file__).parent / "models" / "framingham_risk_model.pkl"
COX_MODEL_PATH = Path(__file__).parent / "models" / "framingham_cox_model.pkl"
GAP_FILLERS_PATH = Path(__file__).parent / "models" / "gap_fillers.pkl"
FRAMINGHAM_CSV = Path(__file__).parent / "data" / "framingham.csv"

# Fields we can't reliably get from Synthea — these get the three-tier
# fallback: real patient data > clinician-entered > model-estimated.
GAP_FIELDS = {
    "totChol": {"label": "Total Cholesterol (mg/dL)", "type": "number", "min": 100.0, "max": 400.0, "step": 1.0},
    "glucose": {"label": "Glucose (mg/dL)", "type": "number", "min": 40.0, "max": 300.0, "step": 1.0},
    "currentSmoker": {"label": "Current Smoker?", "type": "bool"},
    "prevalentHyp": {"label": "Existing Hypertension Diagnosis?", "type": "bool"},
    "BPMeds": {"label": "On BP Medication?", "type": "bool"},
}

INTERVENTIONS = {
    "Baseline (no intervention)": {},
    "Started BP medication": {"systolic_bp": -12.0, "diastolic_bp": -8.0},
    "Lost weight (lifestyle change)": {"bmi": -2.0, "systolic_bp": -5.0},
    "Improved fitness (exercise)": {"heart_rate": -8.0, "systolic_bp": -4.0},
}

INTERVENTION_ICONS = {
    "Baseline (no intervention)": "⏸️",
    "Started BP medication": "💊",
    "Lost weight (lifestyle change)": "🥗",
    "Improved fitness (exercise)": "🏃",
}

st.set_page_config(page_title="CARE Dashboard", layout="wide", page_icon="🫀")

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
html, body, [class*="css"]  { font-family: 'Inter', sans-serif; }
.stApp {
    background: radial-gradient(circle at 15% 0%, #1b2147 0%, #0b0f1f 55%, #060812 100%);
    color: #EAEAF5;
}
#MainMenu, footer, header {visibility: hidden;}
.care-hero {
    font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 2.6rem;
    background: linear-gradient(90deg, #7B61FF 0%, #00D9C0 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 0; animation: fadeInDown 0.7s ease-out;
}
.care-sub {
    color: #9AA0C3; font-size: 1.02rem; margin-top: 0.2rem; margin-bottom: 1.6rem;
    animation: fadeInDown 0.9s ease-out;
}
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
.glass-card {
    background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.09);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border-radius: 20px; padding: 1.3rem 1.5rem; box-shadow: 0 8px 30px rgba(0,0,0,0.35);
    animation: fadeInUp 0.6s ease-out; transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.glass-card:hover { transform: translateY(-4px); box-shadow: 0 14px 40px rgba(123,97,255,0.25); }
.section-label {
    font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 1.15rem; color: #EAEAF5;
    margin: 1.6rem 0 0.8rem 0; display: flex; align-items: center; gap: 0.5rem;
}
.mood-card {
    border-radius: 26px; padding: 2rem; text-align: center; position: relative;
    overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.4); animation: fadeInUp 0.7s ease-out;
}
.mood-face { font-size: 4.2rem; display: inline-block; margin-bottom: 0.4rem; }
.mood-face.low { animation: floatHappy 2.2s ease-in-out infinite; }
.mood-face.moderate { animation: pulseNeutral 2.4s ease-in-out infinite; }
.mood-face.high { animation: shakeWorried 0.6s ease-in-out infinite; }
@keyframes floatHappy { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(-3deg); } }
@keyframes pulseNeutral { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes shakeWorried { 0%,100% { transform: translateX(0) rotate(0deg); } 25% { transform: translateX(-4px) rotate(-2deg); } 75% { transform: translateX(4px) rotate(2deg); } }
.mood-risk-value { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 2.6rem; margin: 0.2rem 0 0.1rem 0; }
.mood-risk-label { font-size: 0.95rem; opacity: 0.85; letter-spacing: 0.03em; text-transform: uppercase; }
.mood-card.low { background: linear-gradient(135deg, rgba(46,204,113,0.18), rgba(46,204,113,0.05)); border: 1px solid rgba(46,204,113,0.4); }
.mood-card.moderate { background: linear-gradient(135deg, rgba(245,166,35,0.18), rgba(245,166,35,0.05)); border: 1px solid rgba(245,166,35,0.4); }
.mood-card.high { background: linear-gradient(135deg, rgba(255,95,109,0.20), rgba(255,95,109,0.06)); border: 1px solid rgba(255,95,109,0.45); }
.mood-card.low .mood-risk-value { color: #2ECC71; }
.mood-card.moderate .mood-risk-value { color: #F5A623; }
.mood-card.high .mood-risk-value { color: #FF5F6D; }
.interv-card {
    border-radius: 18px; padding: 1.1rem 1.3rem; margin-bottom: 0.7rem;
    background: linear-gradient(145deg, #171c37, #10142a);
    box-shadow: 6px 6px 14px rgba(0,0,0,0.45), -6px -6px 14px rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
    transition: transform 0.22s ease, box-shadow 0.22s ease; animation: fadeInUp 0.6s ease-out;
}
.interv-card:hover { transform: translateY(-3px) scale(1.01); box-shadow: 8px 8px 20px rgba(0,0,0,0.55), -8px -8px 20px rgba(255,255,255,0.04); }
.interv-card.best { border: 1px solid rgba(46,204,113,0.55); box-shadow: 0 0 0 1px rgba(46,204,113,0.25), 6px 6px 18px rgba(0,0,0,0.5); }
.interv-title { font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem; }
.interv-badge {
    display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    background: linear-gradient(90deg,#2ECC71,#00D9C0); color: #08120c; padding: 0.15rem 0.55rem; border-radius: 999px; margin-left: 0.5rem;
}
.interv-risk { font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 1.4rem; margin-top: 0.3rem; }
.interv-vitals { font-size: 0.82rem; color: #9AA0C3; margin-top: 0.35rem; }
.risk-bar-track { width: 100%; height: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); margin-top: 0.5rem; overflow: hidden; }
.risk-bar-fill { height: 100%; border-radius: 6px; animation: growBar 1s ease-out; }
@keyframes growBar { from { width: 0%; } }
.shap-row { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.55rem; animation: fadeInUp 0.5s ease-out; }
.shap-label { width: 140px; font-size: 0.85rem; color: #C9CCE8; flex-shrink: 0; }
.shap-track { flex: 1; height: 14px; background: rgba(255,255,255,0.06); border-radius: 8px; position: relative; overflow: hidden; }
.shap-fill { height: 100%; border-radius: 8px; animation: growBar 1s ease-out; }
.shap-value { width: 60px; text-align: right; font-size: 0.8rem; color: #9AA0C3; flex-shrink: 0; }
.agree-badge {
    display: inline-flex; align-items: center; gap: 0.4rem; background: rgba(46,204,113,0.12);
    border: 1px solid rgba(46,204,113,0.4); color: #2ECC71; padding: 0.35rem 0.9rem; border-radius: 999px;
    font-size: 0.85rem; font-weight: 600; margin-top: 0.6rem; animation: fadeInUp 0.6s ease-out;
}
.agree-badge.disagree { background: rgba(245,166,35,0.12); border: 1px solid rgba(245,166,35,0.4); color: #F5A623; }
.model-tag {
    display: inline-block; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    background: rgba(123,97,255,0.18); color: #B7A9FF; padding: 0.12rem 0.5rem; border-radius: 999px; margin-left: 0.4rem;
}
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)

@st.cache_resource
def load_lstm():
    return load_model(MODEL_PATH)

@st.cache_resource
def load_risk_model():
    return joblib.load(RISK_MODEL_PATH)

@st.cache_resource
def load_cox_model():
    if COX_MODEL_PATH.exists():
        return joblib.load(COX_MODEL_PATH)
    return None

@st.cache_resource
def load_gap_fillers():
    if GAP_FILLERS_PATH.exists():
        return joblib.load(GAP_FILLERS_PATH)
    return None

def estimate_gap_fields(gap_bundle, age, male, sysBP, diaBP, bmi, heartRate):
    """Returns {field: estimated_value} using the trained gap-filler models."""
    if gap_bundle is None:
        return {}
    input_features = gap_bundle["input_features"]
    X = pd.DataFrame([{
        "age": age, "male": male, "sysBP": sysBP,
        "diaBP": diaBP, "BMI": bmi, "heartRate": heartRate,
    }])[input_features]

    estimates = {}
    for field, bundle in gap_bundle["models"].items():
        model = bundle["model"]
        if bundle["type"] == "regression":
            estimates[field] = float(model.predict(X)[0])
        else:
            estimates[field] = float(model.predict_proba(X)[0, 1])  # probability of "yes"
    return estimates

@st.cache_data
def load_norm_constants():
    with open(NORM_PATH) as f:
        return json.load(f)

@st.cache_data
def load_framingham_defaults():
    df = pd.read_csv(FRAMINGHAM_CSV).dropna()
    return df.median(numeric_only=True).to_dict()

def get_patient_list(conn, limit=200):
    rows = conn.execute(
        "SELECT patient_id FROM patients WHERE source='synthea' LIMIT ?", (limit,)
    ).fetchall()
    return [r[0] for r in rows]

def load_patient_sequence(conn, patient_id, vitals_order):
    q = """
        SELECT v.visit_timestamp, vt.type, vt.value
        FROM visits v JOIN vitals vt ON vt.visit_id = v.visit_id
        WHERE v.patient_id = ?
        ORDER BY v.visit_timestamp ASC
    """
    rows = conn.execute(q, (patient_id,)).fetchall()
    by_visit = {}
    for ts, vtype, value in rows:
        by_visit.setdefault(ts, {})[vtype] = value
    sequence, timestamps = [], []
    for ts in sorted(by_visit.keys()):
        visit_vitals = by_visit[ts]
        row = [visit_vitals.get(v) for v in vitals_order]
        if any(x is None for x in row):
            continue
        sequence.append(row)
        timestamps.append(ts)
    return sequence, timestamps

def get_patient_demographics(conn, patient_id):
    row = conn.execute(
        "SELECT dob_estimated, sex FROM patients WHERE patient_id = ?",
        (patient_id,),
    ).fetchone()
    dob_str, sex = row
    try:
        dob = datetime.fromisoformat(dob_str.replace("Z", ""))
        age = (datetime.now() - dob).days // 365
    except Exception:
        age = 50
    male = 1 if sex == "male" else 0
    return age, male

def risk_bucket(risk_prob):
    if risk_prob < 0.15:
        return "low", "😄", "#2ECC71"
    elif risk_prob < 0.30:
        return "moderate", "😐", "#F5A623"
    else:
        return "high", "😟", "#FF5F6D"

def build_feature_row(defaults, age, male, sysBP, diaBP, bmi, heartRate):
    row = defaults.copy()
    row["age"] = age
    row["male"] = male
    row["sysBP"] = sysBP
    row["diaBP"] = diaBP
    row["BMI"] = bmi
    row["heartRate"] = heartRate
    return row

st.markdown('<div class="care-hero">🫀 CARE — Clinical AI Reasoning Engine</div>', unsafe_allow_html=True)
st.markdown('<div class="care-sub">Cardiovascular risk forecasting · Digital twin simulation · Explainable AI, in one view</div>', unsafe_allow_html=True)

conn = sqlite3.connect(DB_PATH, check_same_thread=False)
norm = load_norm_constants()
vitals_order = norm["vitals_order"]
vmin = np.array(norm["VITAL_MIN"])
vmax = np.array(norm["VITAL_MAX"])

patient_ids = get_patient_list(conn)
selected_patient = st.selectbox("Select a patient", patient_ids)

if selected_patient:
    sequence, timestamps = load_patient_sequence(conn, selected_patient, vitals_order)
    age, male = get_patient_demographics(conn, selected_patient)

    if len(sequence) < 2:
        st.warning("This patient doesn't have enough complete visit history "
                    "for prediction (needs 2+ visits with all 4 vitals recorded).")
    else:
        lstm_model = load_lstm()
        risk_bundle = load_risk_model()
        risk_model = risk_bundle["model"]
        feature_names = risk_bundle["feature_names"]
        defaults = load_framingham_defaults()
        cox_bundle = load_cox_model()
        gap_bundle = load_gap_fillers()

        latest_sysBP = sequence[-1][vitals_order.index("systolic_bp")]
        latest_diaBP = sequence[-1][vitals_order.index("diastolic_bp")]
        latest_bmi = sequence[-1][vitals_order.index("bmi")]
        latest_hr = sequence[-1][vitals_order.index("heart_rate")]

        # ---------- Three-tier risk factor resolution ----------
        # Tier 1: real patient data (not available for these fields from
        #         Synthea — see GAP_FIELDS). Tier 2: clinician-entered via
        #         the form below. Tier 3: model-estimated fallback.
        gap_estimates = estimate_gap_fields(
            gap_bundle, age, male, latest_sysBP, latest_diaBP, latest_bmi, latest_hr
        )

        st.markdown('<div class="section-label">🩺 Risk Factors <span class="model-tag">Editable</span></div>', unsafe_allow_html=True)
        st.markdown('<div class="glass-card">', unsafe_allow_html=True)
        st.caption("These aren't consistently recorded in the source data. Values below are "
                   "model-estimated from this patient's vitals — edit any field you have a real reading for.")

        gap_values = {}
        input_cols = st.columns(len(GAP_FIELDS))
        for col, (field, spec) in zip(input_cols, GAP_FIELDS.items()):
            est = gap_estimates.get(field, 0.0)
            with col:
                if spec["type"] == "number":
                    gap_values[field] = st.number_input(
                        spec["label"], min_value=spec["min"], max_value=spec["max"],
                        value=round(est, 1), step=spec["step"],
                        key=f"gap_{field}_{selected_patient}",
                        help="Model-estimated — edit if you have a real reading.",
                    )
                else:
                    default_bool = est >= 0.5
                    choice = st.selectbox(
                        spec["label"], options=["Estimated: No", "Estimated: Yes"] if not default_bool
                                        else ["Estimated: Yes", "Estimated: No"],
                        key=f"gap_{field}_{selected_patient}",
                    )
                    gap_values[field] = 1 if "Yes" in choice else 0
        st.markdown('</div>', unsafe_allow_html=True)

        baseline_row = build_feature_row(
            defaults, age, male, latest_sysBP, latest_diaBP, latest_bmi, latest_hr,
        )
        baseline_row.update(gap_values)  # override defaults with tier-2/tier-3 resolved values
        X_baseline = pd.DataFrame([[baseline_row[f] for f in feature_names]], columns=feature_names)
        baseline_risk = risk_model.predict_proba(X_baseline)[0, 1]
        bucket, emoji, color = risk_bucket(baseline_risk)
        bucket_text = {"low": "Low risk — steady as she goes", "moderate": "Moderate risk — worth a closer look", "high": "High risk — recommend early intervention"}[bucket]

        cox_risk = None
        if cox_bundle is not None:
            cox_model = cox_bundle["model"]
            cox_features = cox_bundle["feature_names"]
            followup = cox_bundle["followup_months"]
            X_cox = pd.DataFrame([[baseline_row[f] for f in cox_features]], columns=cox_features)
            survival_prob = cox_model.predict_survival_function(X_cox, times=[followup]).values[0][0]
            cox_risk = 1 - survival_prob

        col1, col2 = st.columns([1, 1.6])

        with col1:
            st.markdown(f"""
            <div class="mood-card {bucket}">
                <div class="mood-face {bucket}">{emoji}</div>
                <div class="mood-risk-value">{baseline_risk*100:.1f}%</div>
                <div class="mood-risk-label">Predicted 10-year CHD risk <span class="model-tag">RandomForest</span></div>
                <div style="margin-top:0.7rem; font-size:0.95rem; color:#EAEAF5;">{bucket_text}</div>
            """, unsafe_allow_html=True)

            if cox_risk is not None:
                agree = abs(cox_risk - baseline_risk) < 0.07
                badge_class = "agree-badge" if agree else "agree-badge disagree"
                badge_icon = "✅" if agree else "⚠️"
                agree_text = "Models agree" if agree else "Models differ — review"
                st.markdown(f"""
                <div style="margin-top:0.9rem; font-size:0.85rem; color:#9AA0C3;">
                    Cox survival model: <b style="color:#EAEAF5;">{cox_risk*100:.1f}%</b>
                </div>
                <div class="{badge_class}">{badge_icon} {agree_text}</div>
                """, unsafe_allow_html=True)

            st.markdown("</div>", unsafe_allow_html=True)

        with col2:
            st.markdown(f"""
            <div class="glass-card">
                <div style="font-family:'Poppins',sans-serif; font-weight:600; font-size:1.05rem;">Patient snapshot</div>
                <div style="color:#9AA0C3; margin-top:0.3rem;">Age ~{age} · {"Male" if male else "Female"} · {len(sequence)} recorded visits</div>
                <div style="margin-top:0.8rem; display:flex; gap:1.4rem; flex-wrap:wrap;">
                    <div><div style="font-size:1.4rem; font-weight:700;">{sequence[-1][vitals_order.index('systolic_bp')]:.0f}</div><div style="font-size:0.78rem; color:#9AA0C3;">Systolic BP</div></div>
                    <div><div style="font-size:1.4rem; font-weight:700;">{sequence[-1][vitals_order.index('diastolic_bp')]:.0f}</div><div style="font-size:0.78rem; color:#9AA0C3;">Diastolic BP</div></div>
                    <div><div style="font-size:1.4rem; font-weight:700;">{sequence[-1][vitals_order.index('heart_rate')]:.0f}</div><div style="font-size:0.78rem; color:#9AA0C3;">Heart Rate</div></div>
                    <div><div style="font-size:1.4rem; font-weight:700;">{sequence[-1][vitals_order.index('bmi')]:.1f}</div><div style="font-size:0.78rem; color:#9AA0C3;">BMI</div></div>
                </div>
            </div>
            """, unsafe_allow_html=True)

            hist_df = pd.DataFrame(sequence, columns=vitals_order)
            hist_df.insert(0, "visit_date", [t[:10] for t in timestamps])
            st.line_chart(hist_df.set_index("visit_date")[["systolic_bp", "diastolic_bp"]], height=180)

        if cox_bundle is not None:
            st.markdown('<div class="section-label">📈 Risk Over Time <span class="model-tag">Cox Survival Model</span></div>', unsafe_allow_html=True)
            st.markdown('<div class="glass-card">', unsafe_allow_html=True)
            st.caption("Unlike the single 10-year score above, the Cox model estimates how this patient's "
                       "cumulative CHD risk builds up month by month across the full follow-up window.")

            cox_model = cox_bundle["model"]
            cox_features = cox_bundle["feature_names"]
            followup = cox_bundle["followup_months"]
            X_cox = pd.DataFrame([[baseline_row[f] for f in cox_features]], columns=cox_features)

            time_points = list(range(0, followup + 1, 6))
            surv_fn = cox_model.predict_survival_function(X_cox, times=time_points)
            risk_over_time = (1 - surv_fn.values.flatten()) * 100

            curve_df = pd.DataFrame({
                "Months": time_points,
                "Cumulative Risk (%)": risk_over_time,
            }).set_index("Months")
            st.line_chart(curve_df, height=220)
            st.markdown('</div>', unsafe_allow_html=True)

        st.markdown('<div class="section-label">🧬 Digital Twin — Intervention Comparison</div>', unsafe_allow_html=True)

        results = []
        for label, deltas in INTERVENTIONS.items():
            modified_seq = [list(v) for v in sequence]
            last_visit = modified_seq[-1]
            for vital_name, delta in deltas.items():
                idx = vitals_order.index(vital_name)
                last_visit[idx] += delta

            X = np.array([modified_seq], dtype="float32")
            X_norm = (X - vmin) / (vmax - vmin)
            pred_norm = lstm_model.predict(X_norm, verbose=0)
            pred_real = pred_norm[0] * (vmax - vmin) + vmin
            pred_dict = dict(zip(vitals_order, pred_real))

            row = build_feature_row(defaults, age, male, pred_dict["systolic_bp"],
                                     pred_dict["diastolic_bp"], pred_dict["bmi"], pred_dict["heart_rate"])
            row.update(gap_values)
            X_risk = pd.DataFrame([[row[f] for f in feature_names]], columns=feature_names)
            risk_prob = risk_model.predict_proba(X_risk)[0, 1]

            results.append({"label": label, "risk": risk_prob, "vitals": pred_dict})

        results.sort(key=lambda r: r["risk"])
        best_label = results[0]["label"]

        cols = st.columns(len(results))
        for col, r in zip(cols, results):
            b, _, c = risk_bucket(r["risk"])
            is_best = r["label"] == best_label
            badge_html = '<span class="interv-badge">Best</span>' if is_best else ''
            icon = INTERVENTION_ICONS.get(r["label"], "🔹")
            with col:
                st.markdown(f"""
                <div class="interv-card {'best' if is_best else ''}">
                    <div class="interv-title">{icon} {r['label']}{badge_html}</div>
                    <div class="interv-risk" style="color:{c};">{r['risk']*100:.1f}%</div>
                    <div class="risk-bar-track"><div class="risk-bar-fill" style="width:{min(r['risk']*100*2.5,100):.0f}%; background:{c};"></div></div>
                    <div class="interv-vitals">
                        BP {r['vitals']['systolic_bp']:.0f}/{r['vitals']['diastolic_bp']:.0f} ·
                        HR {r['vitals']['heart_rate']:.0f} · BMI {r['vitals']['bmi']:.1f}
                    </div>
                </div>
                """, unsafe_allow_html=True)

        best_result = results[0]
        st.success(f"✅ Recommended: **{best_result['label']}** — lowest predicted risk ({best_result['risk']*100:.1f}%)")

        st.markdown('<div class="section-label">🔍 Why this risk score? (SHAP explanation)</div>', unsafe_allow_html=True)

        explainer = shap.TreeExplainer(risk_model)
        shap_values = explainer.shap_values(X_baseline)

        if isinstance(shap_values, list):
            contributions = shap_values[1][0]
        else:
            contributions = np.array(shap_values)
            contributions = contributions[0, :, 1] if contributions.ndim == 3 else contributions[0]

        impact_df = pd.DataFrame({
            "Feature": feature_names,
            "Value": X_baseline.iloc[0].values,
            "Impact": contributions,
        })
        impact_df = impact_df.reindex(impact_df["Impact"].abs().sort_values(ascending=False).index).head(8)
        max_abs = impact_df["Impact"].abs().max() or 1.0

        st.markdown('<div class="glass-card">', unsafe_allow_html=True)
        for _, row in impact_df.iterrows():
            pct = abs(row["Impact"]) / max_abs * 100
            bar_color = "#FF5F6D" if row["Impact"] > 0 else "#2ECC71"
            st.markdown(f"""
            <div class="shap-row">
                <div class="shap-label">{row['Feature']} = {row['Value']:.1f}</div>
                <div class="shap-track"><div class="shap-fill" style="width:{pct:.0f}%; background:{bar_color};"></div></div>
                <div class="shap-value">{row['Impact']:+.3f}</div>
            </div>
            """, unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)
        st.caption("🔴 Red = increases risk · 🟢 Green = decreases risk")

conn.close()