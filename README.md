# 🫀 CARE — Clinical AI Reasoning Engine

> **Offline-First Clinical Decision Support, "What-If" Digital Twin Simulation, 10-Year Cardiovascular Risk Trajectory, and Explainable AI (XAI) System.**

---

## 🔍 Architecture in 1 Glance

```
                      [ Patient / Field Worker Input ]
                (Systolic BP, Diastolic BP, BMI, Heart Rate)
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
[ Offline IndexedDB Cache ]                             [ Clinical Engine ]
 • Works 100% without internet                           • Rule-Based Trend Detector
 • Automatic sync via Service Worker                     • 3-Tier Missing Data Fallback
 • Zero data loss at remote clinics                      • Vitals Range Normalizer
           │                                                   │
           └─────────────────────────┬─────────────────────────┘
                                     ▼
                      [ AI & Deep Learning Core ]
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
  [ LSTM Forecaster ]     [ >93% Stacking Classifier ]   [ Cox Survival Engine ]
• Next-visit BP & BMI    • XGBoost + RF + LightGBM      • Dynamic 10-Year Curve
• TFLite edge model      • Meta-Learner Probability     • Multi-Model Agreement
         │                           │                           │
         └───────────────────────────┼───────────────────────────┘
                                     ▼
                    [ Digital Twin & Explainability ]
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
[ "What-If" Counterfactuals ]                             [ SHAP Explainability ]
 • Started BP Meds (↓12/8 mmHg)                          • Top 8 risk-driving factors
 • Weight Loss (↓2 BMI, ↓5 sysBP)                        • Positive impact: Increases risk
 • Exercise (↓8 HR, ↓4 sysBP)                            • Negative impact: Protects heart
 • Ranked by Risk Reduction (ΔRisk)                      • Plain English explanation
                                     │
                                     ▼
                  [ Interactive Glassmorphic Dashboards ]
        ┌────────────────────────────┴────────────────────────────┐
        ▼                                                         ▼
[ Doctor & Field Worker PWA ]                             [ Streamlit Analytics ]
• Patient List & Lab Entry                                • 3D Animated Risk Faces
• Instant Risk Score & Badges                             • What-If Interactive Sliders
• One-Click PDF Report Download                           • Live Survival Trajectory Chart
```

---

## 📋 Prerequisites
* **Windows 10 or 11** (64-bit)
* **Python 3.10 or 3.11** (check in terminal: `python --version`)
* **RAM:** 4 GB minimum (8 GB recommended)
* **Disk Space:** 500 MB free

---

## 🚀 Complete Step-by-Step Setup & Run Guide (Windows Only)

Follow these steps in order from top to bottom.

---

### Step 1 — Setup Virtual Environment & Install Dependencies

Open **PowerShell** or **Command Prompt (CMD)** in your `care` folder (`c:\Downloads\care_starter_1\care`) and run:

```powershell
# 1. Create a virtual environment
python -m venv venv

# 2. Activate the virtual environment
.\venv\Scripts\Activate.ps1
```

*(If you see an execution policy error in PowerShell, run this once: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`)*

Now install the required packages:

```powershell
pip install -r requirements.txt
```

*(Optional: If you plan to retrain the advanced models with gradient boosters, also install: `pip install xgboost lightgbm imbalanced-learn reportlab`)*

---

### Step 2 — Verify AI Model Artifacts

All pre-trained AI models are already located in the `models\` folder:
* `bp_lstm_model_v3.keras` — Deep Learning LSTM vital signs forecaster
* `bp_lstm_model_v3.tflite` — Quantized lightweight model for offline edge devices
* `framingham_risk_model.pkl` — High-precision Stacking Ensemble Classifier (>93% Accuracy)
* `framingham_cox_model.pkl` — Cox Proportional Hazards longitudinal survival model
* `gap_fillers.pkl` — Multi-target imputer for estimating missing patient labs
* `norm_constants.json` — Normalization boundaries for blood pressure, BMI, and heart rate

*(Optional: If you ever want to retrain all models from scratch, run `python train_advanced_model.py` and `python train_cox_model.py`)*

---

### Step 3 — Start the FastAPI Backend & Web Portals (Terminal 1)

Open **Terminal 1** in the `care` project folder and run:

```powershell
.\venv\Scripts\activate
uvicorn sync_server:app --host 127.0.0.1 --port 8000 --reload
```

* **Doctor & Clinician Management Portal:** **[http://localhost:8000/doctor.html](http://localhost:8000/doctor.html)**
* **Frontline Health Worker PWA:** **[http://localhost:8000/](http://localhost:8000/)**
* **Interactive Swagger API Documentation:** **[http://localhost:8000/docs](http://localhost:8000/docs)**

---

### Step 4 — Start the Clinical Intelligence Dashboard (Terminal 2)

Open a **new Terminal 2** in the `care` project folder and run:

```powershell
.\venv\Scripts\activate
streamlit run dashboard.py --server.port 8501
```

* **Open the Dashboard in your browser:** **[http://localhost:8501](http://localhost:8501)**
* This dashboard provides interactive patient history, 3D animated mood cards, what-if sliders, SHAP waterfall charts, and Cox survival curves.

---

### Step 5 — Run CLI Diagnostics, Digital Twin & Simulations (Terminal 3)

Open a **new Terminal 3** in the `care` project folder to test individual features directly from the command line:

```powershell
.\venv\Scripts\activate
```

Now you can run any of the simulation and reasoning tools below:

#### 1. Run Complete Patient Prediction:
```powershell
python -c "from prediction_pipeline import run_prediction_for_patient; print(run_prediction_for_patient('CARE-BP-0001'))"
```

#### 2. Run Counterfactual Digital Twin Simulation:
```powershell
python digital_twin.py CARE-BP-0001
```

#### 3. Run Intervention Ranking Engine:
```powershell
python intervention_ranking.py CARE-BP-0001
```

#### 4. Run SHAP Explainable AI (Why did the AI predict this?):
```powershell
python explain_risk.py CARE-BP-0001
```

#### 5. Run Lightweight Offline Edge Inference (TFLite):
```powershell
python predict_tflite.py CARE-BP-0001
```

---

## 🧠 How CARE Works & Simple Formulas Explained (Human-Friendly)

All medical calculations and AI predictions in CARE are based on clear, transparent formulas. Here is how each one works in plain English:

---

### 1. Body Mass Index (BMI)
Tells us whether a patient's weight is healthy relative to their height.

$$\text{BMI} = \frac{\text{Weight in kg}}{(\text{Height in meters})^2}$$

* **Example:** Weight = $75\text{ kg}$, Height = $175\text{ cm}\ (1.75\text{ m})$
* $\text{BMI} = \frac{75}{1.75 \times 1.75} = \frac{75}{3.0625} = 24.5\text{ (Normal weight)}$

---

### 2. Mean Arterial Pressure (MAP)
The average blood pressure in a patient's arteries during one complete cardiac cycle. It is a critical indicator of organ perfusion.

$$\text{MAP} = \frac{\text{Systolic BP} + (2 \times \text{Diastolic BP})}{3}$$

* **Example:** BP = $120 / 80\text{ mmHg}$
* $\text{MAP} = \frac{120 + (2 \times 80)}{3} = \frac{120 + 160}{3} = \frac{280}{3} = 93.3\text{ mmHg}$

---

### 3. Pulse Pressure
The difference between the systolic (top) and diastolic (bottom) blood pressure numbers. A wide pulse pressure ($> 60\text{ mmHg}$) indicates arterial stiffness.

$$\text{Pulse Pressure} = \text{Systolic BP} - \text{Diastolic BP}$$

* **Example:** BP = $140 / 80\text{ mmHg} \implies \text{Pulse Pressure} = 140 - 80 = 60\text{ mmHg}$

---

### 4. Early Warning Trend Slope (Checking if Patient is Getting Worse)
Before running complex AI, CARE checks if a vital sign is consistently climbing or dropping across recent visits using a straight-line slope calculation.

$$\text{Slope} = \frac{\text{Change in vital values}}{\text{Number of visits}}$$

* **Systolic BP:** If slope is **$\ge +2.0\text{ mmHg per visit}$**, CARE flags a **Worsening Hypertension Warning**.
* **Blood Glucose:** If slope is **$\ge +3.0\text{ mg/dL per visit}$**, CARE flags a **Glycemic Spike Warning**.
* **Kidney Function (eGFR):** If slope is **$\le -1.5\text{ per visit}$**, CARE flags a **Renal Decline Warning**.

---

### 5. Min-Max Normalization (Preparing Data for the LSTM AI Model)
Neural networks work best when numbers are scaled between $0$ (minimum) and $1$ (maximum).

$$\text{Normalized Value} = \frac{\text{Patient Value} - \text{Minimum Value}}{\text{Maximum Value} - \text{Minimum Value}}$$

* **Example for Systolic BP** ($\text{Min} = 80$, $\text{Max} = 220$):
* If patient has $\text{BP} = 150\text{ mmHg}$:
* $\text{Normalized Value} = \frac{150 - 80}{220 - 80} = \frac{70}{140} = 0.50$

---

### 6. Digital Twin "What-If" Simulation
A Digital Twin creates a digital clone of the patient's visit history and applies hypothetical medical or lifestyle changes to see how their future vitals respond:

* **Scenario A (Started BP Meds):** Lowers Systolic BP by $12\text{ mmHg}$ and Diastolic BP by $8\text{ mmHg}$.
* **Scenario B (Weight Loss & Diet):** Lowers BMI by $2.0\text{ kg/m}^2$ and Systolic BP by $5\text{ mmHg}$.
* **Scenario C (Exercise & Fitness):** Lowers Resting Heart Rate by $8\text{ bpm}$ and Systolic BP by $4\text{ mmHg}$.

The LSTM neural network runs this modified profile forward in time to project the patient's next visit vitals.

---

### 7. Intervention Ranking (Measuring Risk Reduction $\Delta\text{Risk}$)
CARE ranks different treatments to show doctors which option saves the most heart health for this specific patient:

$$\text{Risk Reduction } (\Delta\text{Risk}) = \text{Baseline Risk (No Action)} - \text{Scenario Risk (With Action)}$$

* **Example:**
  * Baseline 10-Year Heart Risk = $28.0\%$
  * Risk after BP Medication = $14.5\%$
  * **Risk Reduction ($\Delta\text{Risk}$)** = $28.0\% - 14.5\% = +13.5\%$ (Rank #1 Recommended Treatment)

---

### 8. Explainable AI (SHAP TreeExplainer in Plain Words)
Instead of acting like a "black box," CARE explains **why** a risk score was given by assigning an impact value to each factor:

$$\text{Final Risk} = \text{Average Population Baseline} + \text{Sum of All Individual Factor Impacts}$$

* **Positive Impact ($+$):** Pushes risk **UP** (e.g., Age 62 adds $+0.082$, Systolic BP 155 adds $+0.064$).
* **Negative Impact ($-$):** Pulls risk **DOWN** (e.g., Normal BMI 22.1 subtracts $-0.035$, Non-smoker subtracts $-0.050$).

---

### 9. AI Confidence Score (Data Completeness Check)
CARE automatically tells the doctor how trustworthy the AI prediction is:
* **High Confidence:** Patient has at least 3 historical visits and all major lab values.
* **Medium Confidence:** Patient has 1 or 2 visits with core vitals recorded.
* **Low Confidence:** More than half of the patient's lab values had to be estimated due to missing data.

---

## 🏆 What to Show the Judges / Evaluators During the Demo

Follow this 5-point presentation flow:

1. **🌐 Offline-First PWA Demonstration (Terminal 1 - `http://localhost:8000/`):**
   * Show the frontline worker interface where patient vitals are recorded.
   * Turn off Wi-Fi/disconnect network to prove that observations save seamlessly into local IndexedDB with zero lag.
2. **👨‍⚕️ Doctor Console & Instant Risk Stratification (`http://localhost:8000/doctor.html`):**
   * Search for patient `CARE-BP-0001`. Show the instant 10-year cardiovascular risk score, patient demographics, and visit timeline.
3. **📊 Interactive Clinical Dashboard (`http://localhost:8501`):**
   * Show the **3D animated Mood Cards** that react to patient risk level (Green Floating Smile for Low Risk $\to$ Red Shaking Alert for High Risk).
   * Review the **Cox Longitudinal Survival Curve** projecting risk from Year 1 to Year 10.
4. **🔮 "What-If" Counterfactual Digital Twin:**
   * Adjust the interactive sliders (e.g., lower BP by $12\text{ mmHg}$ or drop BMI by $2$).
   * Show how the AI recalculates future risk in real-time and displays the **Intervention Ranking Table** sorted by $\Delta\text{Risk}$.
5. **🔍 Explainable AI (SHAP Factor Attribution):**
   * Point out the plain-English explanation box showing the exact biometric drivers (e.g., `sysBP = 155.0 → increases risk by +0.064`).
   * Click **Download PDF Report** to generate a clinical-grade summary report.

---

## 🧪 Quick Test Commands (Run in Terminal 3 on Demand)

| Goal | Command | Expected Result |
|---|---|---|
| **Test Full Patient Prediction** | `python -c "from prediction_pipeline import run_prediction_for_patient; print(run_prediction_for_patient('CARE-BP-0001'))"` | Risk: ~24.5%, Confidence: High, SHAP values generated |
| **Test Digital Twin Simulation** | `python digital_twin.py CARE-BP-0001` | Displays predicted vitals for Baseline, Medication, Diet, and Exercise |
| **Test Intervention Ranking** | `python intervention_ranking.py CARE-BP-0001` | Outputs scenarios ranked from highest $\Delta\text{Risk}$ reduction to lowest |
| **Test Explainable AI (SHAP)** | `python explain_risk.py CARE-BP-0001` | Lists top 8 clinical factors driving the cardiovascular prediction |
| **Test Offline TFLite Inference** | `python predict_tflite.py CARE-BP-0001` | Sub-millisecond on-device forecasting without full TensorFlow |
| **Test Rule-Based Trend Detection**| `python reasoning_engine/trend_rules.py CARE-BP-0001` | Flags OLS slope anomalies for BP, glucose, or kidney function |
| **Run Full Automated QA Audit** | `python qa_audit.py` | Runs 38 comprehensive backend, auth, sync, and ML tests (All Pass) |

---

## 📁 Project Directory Structure

```
care/
├── app/                                 # Web application assets
├── data/                                # Clinical datasets & exports
│   ├── framingham.csv                   # Framingham Heart Study dataset (4,240 rows)
│   ├── export_for_training.json         # Longitudinal sequence data
│   └── synthea_output/                  # FHIR synthetic cohort bundles
├── db/                                  # Database initialization
│   ├── init_db.py                       # Local SQLite / PostgreSQL initializer
│   └── schema.sql                       # Database table definitions
├── ingestion/                           # Data loading scripts
│   ├── load_framingham.py               # Ingests Framingham dataset
│   └── load_synthea.py                  # Ingests FHIR JSON bundles
├── models/                              # Trained AI model weights
│   ├── bp_lstm_model_v3.keras           # TensorFlow Keras LSTM Forecaster
│   ├── bp_lstm_model_v3.tflite          # Quantized TFLite edge model
│   ├── framingham_risk_model.pkl        # Stacking Classifier (>93% Accuracy)
│   ├── framingham_cox_model.pkl         # Cox Proportional Hazards survival model
│   ├── gap_fillers.pkl                  # Random Forest lab imputation models
│   └── norm_constants.json              # Vitals min/max normalization values
├── photos/                              # Patient profile image uploads
├── reasoning_engine/                    # Heuristic rules & trend detectors
│   └── trend_rules.py                   # Linear slope early warning system
├── digital_twin.py                      # "What-if" physiological simulator
├── intervention_ranking.py              # Treatment ranking engine (ΔRisk)
├── explain_risk.py                      # SHAP TreeExplainer explanation tool
├── prediction_pipeline.py               # Core orchestrator (Vitals -> AI Risk -> SHAP -> Cox)
├── predict_tflite.py                    # Lightweight edge inference script
├── convert_to_tflite.py                 # TFLite converter & quantizer
├── train_advanced_model.py              # Trains Stacking Classifier (>93% Accuracy)
├── train_cox_model.py                   # Trains Cox survival analysis model
├── train_gap_fillers.py                 # Trains missing data imputation models
├── dashboard.py                         # Interactive Streamlit Clinical Dashboard
├── sync_server.py                       # FastAPI backend server & PWA host
├── db_sqlite_compat.py                  # SQLite compatibility layer (no PostgreSQL needed)
├── generate_pdf.py                      # Clinical PDF report generator
├── qa_audit.py                          # Full-system automated verification suite
├── index.html                           # Frontline Health Worker PWA
├── doctor.html                          # Clinician / Doctor Management Portal
├── app.js                               # Patient PWA client logic
├── doctor_app.js                        # Doctor portal client logic
├── db.js                                # Offline IndexedDB database wrapper
├── sw.js                                # Service Worker for offline PWA caching
├── styles.css                           # Glassmorphic stylesheet (Health Worker UI)
├── doctor_styles.css                    # Glassmorphic stylesheet (Doctor Portal)
├── requirements.txt                     # Python dependencies
└── README.md                            # Comprehensive system documentation
```

---

## 🛠️ Troubleshooting & FAQs (Windows)

### 1. PowerShell Script Execution Policy Error
* **Error:** `cannot be loaded because running scripts is disabled on this system.`
* **Fix:** Open PowerShell and run this command once:
  ```powershell
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  ```

### 2. Port 8000 or 8501 Already in Use
* **Fix:** Stop any existing Python processes or specify an alternative port:
  ```powershell
  # To stop all running Python servers on Windows:
  Get-Process python -ErrorAction SilentlyContinue | Stop-Process

  # Or run on alternative ports:
  uvicorn sync_server:app --port 8080 --reload
  streamlit run dashboard.py --server.port 8502
  ```

### 3. SQLite Database Locked Error (`database is locked`)
* **Cause:** Multiple write processes accessing the SQLite database simultaneously.
* **Fix:** CARE uses thread-local connections and Write-Ahead Logging (`WAL`). If a lock occurs during manual edits, simply close any external database viewers (like DB Browser for SQLite) and restart `sync_server.py`.

### 4. Missing Model Files (`.pkl` or `.keras`)
* **Fix:** In **Terminal 3**, run the one-step training scripts:
  ```powershell
  python train_advanced_model.py
  python train_cox_model.py
  python train_gap_fillers.py
  python convert_to_tflite.py
  ```

---

*CARE — Clinical AI Reasoning Engine. Built for accessible, intelligent, and explainable healthcare.*
