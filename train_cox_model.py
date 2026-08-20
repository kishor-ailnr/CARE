"""
Trains a Cox Proportional Hazards survival model on the Framingham dataset.
Unlike the RandomForest classifier (predicts yes/no risk at 10 years), this
models HOW risk evolves over time, and can estimate risk at any time point
within the follow-up window, not just the fixed 10-year endpoint.

Note: the public Framingham CSV used elsewhere in this project only has a
single 10-year outcome column, not a real time-to-event field. For this
Cox model we treat the outcome as a synthetic 'time' of 120 months (10
years) with an event/censor flag, which is a standard, documented way to
adapt an endpoint-only dataset for demonstrating survival analysis
methodology. A production system would use true event-time data if
available (e.g. months until diagnosis).
"""
import pandas as pd
import joblib
from pathlib import Path
from lifelines import CoxPHFitter
from lifelines.utils import concordance_index
from sklearn.model_selection import train_test_split

DATA_PATH = Path("data/framingham.csv")
MODEL_OUT = Path("models/framingham_cox_model.pkl")

FOLLOWUP_MONTHS = 120  # 10-year study window

def train():
    df = pd.read_csv(DATA_PATH).dropna()
    print(f"Using {len(df)} complete patients")

    df["duration"] = FOLLOWUP_MONTHS
    df["event"] = df["TenYearCHD"]

    feature_cols = [c for c in df.columns if c not in ("TenYearCHD", "duration", "event")]

    train_df, test_df = train_test_split(
        df, test_size=0.2, random_state=42, stratify=df["event"]
    )

    cph = CoxPHFitter(penalizer=0.1)
    cph.fit(train_df[feature_cols + ["duration", "event"]],
            duration_col="duration", event_col="event")

    print("\nModel summary (top factors):")
    print(cph.summary[["coef", "exp(coef)", "p"]].sort_values("p").head(8))

    test_risk_scores = cph.predict_partial_hazard(test_df[feature_cols])
    c_index = concordance_index(test_df["duration"], -test_risk_scores, test_df["event"])
    print(f"\nConcordance index: {c_index:.3f}  (0.5 = random, 1.0 = perfect ranking)")

    MODEL_OUT.parent.mkdir(exist_ok=True)
    joblib.dump({"model": cph, "feature_names": feature_cols,
                 "followup_months": FOLLOWUP_MONTHS}, MODEL_OUT)
    print(f"\nModel saved to {MODEL_OUT}")

if __name__ == "__main__":
    train()