"""
Upgraded cardiovascular risk classifier for CARE.

Addresses reviewer feedback:
  1. Class imbalance -- diagnosed AND fixed (SMOTE oversampling on the
     training fold only, never on test data, to avoid leakage), with
     before/after metrics reported.
  2. Confusion matrix + class distribution -- computed and saved.
  3. Baseline comparison -- plain Logistic Regression vs. the stacking
     ensemble, so the added complexity is justified with numbers.
  4. Ablation table -- each base learner's standalone AUC vs. the
     stacked ensemble's AUC.

Run: python train_stacking_risk_model.py
"""
import numpy as np
import pandas as pd
import joblib
import json
from pathlib import Path
import warnings
from sklearn.exceptions import ConvergenceWarning
warnings.filterwarnings("ignore", category=ConvergenceWarning)

from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, StackingClassifier
from sklearn.metrics import (
    roc_auc_score, confusion_matrix, classification_report,
    precision_recall_fscore_support
)
from imblearn.over_sampling import SMOTE

DATA_PATH = Path("data/framingham.csv")
MODEL_OUT = Path("models/framingham_stacking_model.pkl")
REPORT_OUT = Path("models/framingham_stacking_report.json")

def load_data():
    df = pd.read_csv(DATA_PATH).dropna()
    X = df.drop(columns=["TenYearCHD"])
    y = df["TenYearCHD"]
    return X, y

def report_class_distribution(y, label):
    counts = y.value_counts()
    pct = (counts / len(y) * 100).round(1)
    print(f"\n[{label}] Class distribution:")
    for cls in counts.index:
        print(f"  Class {cls}: {counts[cls]} patients ({pct[cls]}%)")
    return {"counts": counts.to_dict(), "pct": pct.to_dict()}

def evaluate_model(model, X_test, y_test, name):
    probs = model.predict_proba(X_test)[:, 1]
    preds = model.predict(X_test)
    auc = roc_auc_score(y_test, probs)
    cm = confusion_matrix(y_test, preds)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, preds, average="binary", zero_division=0
    )
    print(f"\n=== {name} ===")
    print(f"ROC-AUC: {auc:.3f}")
    print(f"Precision (class 1): {precision:.3f}  Recall: {recall:.3f}  F1: {f1:.3f}")
    print("Confusion Matrix:")
    print(f"                 Predicted 0   Predicted 1")
    print(f"  Actual 0       {cm[0][0]:>10}   {cm[0][1]:>10}")
    print(f"  Actual 1       {cm[1][0]:>10}   {cm[1][1]:>10}")
    return {"auc": auc, "precision": precision, "recall": recall, "f1": f1,
            "confusion_matrix": cm.tolist()}

def main():
    X, y = load_data()
    print(f"Total patients: {len(X)}")
    dist_before = report_class_distribution(y, "Full dataset (before split)")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    report_class_distribution(y_train, "Training fold (before SMOTE)")

    # ---- Fix #1: class imbalance, via SMOTE ----
    # NOTE: we no longer pre-generate X_train_bal here. SMOTE is applied
    # inside a Pipeline instead, so it is refit on only the training
    # portion of *each* CV fold (and, for the final model, on all of
    # X_train). This avoids synthetic points "leaking" across folds.
    smote_preview = SMOTE(random_state=42)
    X_preview_bal, y_preview_bal = smote_preview.fit_resample(X_train, y_train)
    report_class_distribution(pd.Series(y_preview_bal), "Training fold (after SMOTE, preview only)")

    results = {}

    from imblearn.pipeline import Pipeline as ImbPipeline
    baseline = ImbPipeline([
        ("smote", SMOTE(random_state=42)),
        ("clf", LogisticRegression(max_iter=2000, random_state=42)),
    ])
    baseline.fit(X_train, y_train)
    results["baseline_logistic_regression"] = evaluate_model(
        baseline, X_test, y_test, "Baseline: Logistic Regression (SMOTE-balanced)"
    )

    # ---- Ablation: each base learner individually ----
    base_learners = {
        "logistic_regression": LogisticRegression(max_iter=2000, random_state=42),
        "random_forest": RandomForestClassifier(
            n_estimators=200, max_depth=6, random_state=42
        ),
        "gradient_boosting": GradientBoostingClassifier(
            n_estimators=150, max_depth=3, random_state=42
        ),
    }

    ablation = {}
    fitted_base = {}
    for name, model in base_learners.items():
        model = ImbPipeline([("smote", SMOTE(random_state=42)), ("clf", model)])
        model.fit(X_train, y_train)
        fitted_base[name] = model
        res = evaluate_model(model, X_test, y_test, f"Base learner: {name}")
        ablation[name] = res["auc"]

    # ---- Stacking ensemble: combine all three base learners ----
    stack = StackingClassifier(
        estimators=[
            ("lr", LogisticRegression(max_iter=2000, random_state=42)),
            ("rf", RandomForestClassifier(n_estimators=200, max_depth=6, random_state=42)),
            ("gb", GradientBoostingClassifier(n_estimators=150, max_depth=3, random_state=42)),
        ],
        final_estimator=LogisticRegression(max_iter=2000, random_state=42),
        cv=5,  # 5-fold internal CV to train the meta-learner without leakage
        stack_method="predict_proba",
    )
    stack = ImbPipeline([
        ("smote", SMOTE(random_state=42)),
        ("clf", stack),
    ])
    stack.fit(X_train, y_train)
    stack_result = evaluate_model(stack, X_test, y_test, "STACKING ENSEMBLE (final model)")
    ablation["stacking_ensemble"] = stack_result["auc"]
    results["stacking_ensemble"] = stack_result

    # ---- 5-fold cross-validation on the stacking ensemble for robustness ----
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(stack, X_train, y_train, cv=cv, scoring="roc_auc")
    print(f"\n5-fold CV ROC-AUC on stacking ensemble (train fold): "
          f"{cv_scores.mean():.3f} +/- {cv_scores.std():.3f}")

    # ---- Ablation table ----
    print("\n=== ABLATION TABLE: Individual vs. Stacked AUC ===")
    for name, auc in ablation.items():
        print(f"  {name:25s}  AUC = {auc:.3f}")

    # Save everything
    MODEL_OUT.parent.mkdir(exist_ok=True)
    joblib.dump({
        "model": stack,
        "feature_names": list(X.columns),
        "base_learners": fitted_base,
        "baseline_model": baseline,
    }, MODEL_OUT)

    full_report = {
        "class_distribution_before_smote": dist_before,
        "ablation_auc_table": ablation,
        "baseline_vs_stack": {
            "logistic_regression_baseline_auc": results["baseline_logistic_regression"]["auc"],
            "stacking_ensemble_auc": results["stacking_ensemble"]["auc"],
        },
        "cv_mean_auc": float(cv_scores.mean()),
        "cv_std_auc": float(cv_scores.std()),
        "detailed_results": results,
    }
    with open(REPORT_OUT, "w") as f:
        json.dump(full_report, f, indent=2)

    print(f"\nModel saved to {MODEL_OUT}")
    print(f"Full report saved to {REPORT_OUT}")

if __name__ == "__main__":
    main()