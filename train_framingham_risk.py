"""
Trains a cardiovascular risk classifier on the Framingham dataset.
Predicts TenYearCHD (will this patient develop coronary heart disease
within 10 years) from a single snapshot of risk factors.
This is the static "risk scoring" half of CARE, complementing the LSTM's
temporal forecasting from Synthea.
"""
import pandas as pd
import joblib
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score, classification_report

DATA_PATH = Path("data/framingham.csv")
MODEL_OUT = Path("models/framingham_risk_model.pkl")

def train():
    df = pd.read_csv(DATA_PATH)
    print(f"Total patients before handling missing values: {len(df)}")
    df = df.dropna()
    print(f"Using {len(df)} complete patients after dropping missing values")
    
    X = df.drop(columns=["TenYearCHD"])
    y = df["TenYearCHD"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = RandomForestClassifier(
        n_estimators=200, max_depth=6, random_state=42, class_weight="balanced"
    )
    model.fit(X_train, y_train)

    # Evaluate
    probs = model.predict_proba(X_test)[:, 1]
    preds = model.predict(X_test)

    auc = roc_auc_score(y_test, probs)
    print(f"\nROC-AUC: {auc:.3f}  (0.5 = random guessing, 1.0 = perfect)")
    print("\nClassification report:")
    print(classification_report(y_test, preds))

    # Save model + the exact feature column order (needed later for prediction)
    MODEL_OUT.parent.mkdir(exist_ok=True)
    joblib.dump({"model": model, "feature_names": list(X.columns)}, MODEL_OUT)
    print(f"\nModel saved to {MODEL_OUT}")

if __name__ == "__main__":
    train()