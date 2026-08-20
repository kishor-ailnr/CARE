"""
Trains auxiliary 'gap-filling' models that estimate risk factors CARE
doesn't reliably have from Synthea (cholesterol, glucose, smoking) using
the vitals we DO reliably have (age, sex, BP, BMI, heart rate).

Trained on Framingham, since it has all these fields together for the
same patients. These become the third tier of the fallback system:
real data > clinician-entered data > model-estimated data.

Usage: python train_gap_fillers.py
"""
import pandas as pd
import joblib
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.metrics import mean_absolute_error, roc_auc_score

DATA_PATH = Path("data/framingham.csv")
MODEL_OUT = Path("models/gap_fillers.pkl")

INPUT_FEATURES = ["age", "male", "sysBP", "diaBP", "BMI", "heartRate"]
REGRESSION_TARGETS = ["totChol", "glucose"]
CLASSIFICATION_TARGETS = ["currentSmoker", "prevalentHyp", "BPMeds"]

def train():
    df = pd.read_csv(DATA_PATH).dropna()
    print(f"Using {len(df)} complete patients\n")

    models = {}

    for target in REGRESSION_TARGETS:
        X = df[INPUT_FEATURES]
        y = df[target]
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        model = RandomForestRegressor(n_estimators=150, max_depth=6, random_state=42)
        model.fit(X_train, y_train)
        mae = mean_absolute_error(y_test, model.predict(X_test))
        print(f"[{target}] estimator — Mean Absolute Error: {mae:.2f}")
        models[target] = {"model": model, "type": "regression"}

    for target in CLASSIFICATION_TARGETS:
        X = df[INPUT_FEATURES]
        y = df[target]
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        model = RandomForestClassifier(
            n_estimators=150, max_depth=6, random_state=42, class_weight="balanced"
        )
        model.fit(X_train, y_train)
        probs = model.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, probs)
        print(f"[{target}] estimator — ROC-AUC: {auc:.3f}")
        models[target] = {"model": model, "type": "classification"}

    MODEL_OUT.parent.mkdir(exist_ok=True)
    joblib.dump({"models": models, "input_features": INPUT_FEATURES}, MODEL_OUT)
    print(f"\nGap-filler models saved to {MODEL_OUT}")

if __name__ == "__main__":
    train()