"""
Option 1 ML inference service.
Loads Colab-trained models from the 'models' folder and serves /forecast and /explain.
Run: python app.py  (or: flask --app app run -p 5000)
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
import xgboost as xgb

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://localhost:4000", "http://127.0.0.1:4000"])

# Folder where you place downloaded Colab models: models/<modelKey>/
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("ML_MODELS_DIR", BASE_DIR / "models"))

# In-memory cache: modelKey -> loaded model (or None if not yet loaded)
# When you add real Keras/XGBoost loading, replace the value with the actual model.
_loaded_models = {}


def _get_model_path(model_key: str) -> Path:
    """Resolve path to a model folder. model_key e.g. 'lstm', 'xgboost'."""
    path = MODELS_DIR / model_key.strip()
    if not path.is_dir():
        raise FileNotFoundError(f"Model folder not found: {path}")
    return path


def _read_daily_series(dataset_path: str, target_fallback: str = "value") -> pd.DataFrame:
    """
    Read a CSV and return a daily dataframe with columns:
      - Date (datetime64[ns], daily)
      - Quantity (float)

    Supported inputs:
      - Raw UCI E-Commerce format: InvoiceDate + Quantity (transaction-level)
      - Already daily: Date + Quantity
      - Generic: date + value (or date + <numeric>)
    """
    if not dataset_path:
        raise ValueError("datasetPath required for real forecasting")

    path = Path(dataset_path)
    if not path.exists():
        raise FileNotFoundError(f"datasetPath not found: {dataset_path}")

    df = pd.read_csv(path)
    cols = set(df.columns)

    # Case 1: UCI E-Commerce raw transactions
    if {"InvoiceDate", "Quantity"}.issubset(cols):
        df = df.dropna(subset=["InvoiceDate", "Quantity"]).copy()
        df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"], errors="coerce")
        df = df.dropna(subset=["InvoiceDate"]).copy()
        df = df[df["Quantity"] > 0].copy()
        df["Date"] = df["InvoiceDate"].dt.date
        daily = df.groupby("Date")["Quantity"].sum().reset_index()
        daily["Date"] = pd.to_datetime(daily["Date"])
        daily = daily.sort_values("Date").reset_index(drop=True)
        return daily[["Date", "Quantity"]].astype({"Quantity": "float64"})

    # Case 2: Already daily in our expected naming
    if {"Date", "Quantity"}.issubset(cols):
        daily = df.dropna(subset=["Date", "Quantity"]).copy()
        daily["Date"] = pd.to_datetime(daily["Date"], errors="coerce")
        daily = daily.dropna(subset=["Date"]).copy()
        daily = daily.sort_values("Date").reset_index(drop=True)
        daily["Quantity"] = pd.to_numeric(daily["Quantity"], errors="coerce")
        daily = daily.dropna(subset=["Quantity"]).copy()
        return daily[["Date", "Quantity"]].astype({"Quantity": "float64"})

    # Case 3: Generic date/value format
    date_col = None
    for c in ["date", "Date", "ds", "timestamp", "time"]:
        if c in cols:
            date_col = c
            break
    if not date_col:
        raise ValueError("CSV must contain either InvoiceDate+Quantity, Date+Quantity, or a date column like 'date' with a numeric target column.")

    # target column: prefer known fallbacks, otherwise pick first numeric column
    target_col = None
    for c in [target_fallback, "value", "y", "sales", "quantity", "Quantity"]:
        if c in cols:
            target_col = c
            break
    if not target_col:
        numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not numeric_cols:
            raise ValueError("Could not find a numeric target column in CSV.")
        target_col = numeric_cols[0]

    daily = df.dropna(subset=[date_col, target_col]).copy()
    daily[date_col] = pd.to_datetime(daily[date_col], errors="coerce")
    daily = daily.dropna(subset=[date_col]).copy()
    daily[target_col] = pd.to_numeric(daily[target_col], errors="coerce")
    daily = daily.dropna(subset=[target_col]).copy()
    daily = daily.sort_values(date_col).reset_index(drop=True)

    # If input isn't daily already, aggregate to daily sum
    daily["Date"] = daily[date_col].dt.date
    daily = daily.groupby("Date")[target_col].sum().reset_index()
    daily["Date"] = pd.to_datetime(daily["Date"])
    daily = daily.sort_values("Date").reset_index(drop=True)
    daily = daily.rename(columns={target_col: "Quantity"})
    return daily[["Date", "Quantity"]].astype({"Quantity": "float64"})


def _make_xgb_feature_row(history_daily: pd.DataFrame, next_date: pd.Timestamp, feature_cols: list[str]) -> pd.DataFrame:
    """
    Build a single-row feature frame for predicting next_date, using history_daily containing:
      - Date (datetime64[ns])
      - Quantity (float)
    """
    if history_daily.empty:
        raise ValueError("Not enough history to compute features.")

    s = history_daily["Quantity"].astype("float64").reset_index(drop=True)

    row = {
        "year": int(next_date.year),
        "month": int(next_date.month),
        "day": int(next_date.day),
        "dayofweek": int(next_date.dayofweek),
        "quarter": int(((next_date.month - 1) // 3) + 1),
        "weekend": int(next_date.dayofweek >= 5),
    }

    def lag(k: int) -> float:
        if len(s) < k:
            return float("nan")
        return float(s.iloc[-k])

    for k in [1, 2, 3, 7, 14, 21, 28]:
        row[f"lag_{k}"] = lag(k)

    # Rolling stats from known history (up to last observed day)
    # Note: training notebook may have used rolling values including the same-day target;
    # for inference we approximate using history up to current day (no leakage).
    row["rolling_mean_7"] = float(s.tail(7).mean()) if len(s) >= 1 else float("nan")
    row["rolling_std_7"] = float(s.tail(7).std(ddof=1)) if len(s) >= 2 else 0.0
    row["rolling_mean_14"] = float(s.tail(14).mean()) if len(s) >= 1 else float("nan")
    row["rolling_mean_30"] = float(s.tail(30).mean()) if len(s) >= 1 else float("nan")

    row["lag_1_x_lag_7"] = row["lag_1"] * row["lag_7"]
    row["lag_7_x_lag_14"] = row["lag_7"] * row["lag_14"]

    X = pd.DataFrame([row])
    # Ensure all expected features exist and order matches training
    for c in feature_cols:
        if c not in X.columns:
            X[c] = np.nan
    X = X[feature_cols]
    # Fill any NaNs that come from insufficient history
    X = X.fillna(0.0)
    return X


def _load_model_if_needed(model_key: str):
    """Load model from models/<modelKey>/ if not already in cache."""
    if model_key in _loaded_models:
        return _loaded_models[model_key]
    path = _get_model_path(model_key)

    metadata_path = path / "metadata.json"
    metadata = {}
    if metadata_path.exists():
        with open(metadata_path) as f:
            metadata = json.load(f)

    loaded = {"path": str(path), "metadata": metadata, "model": None}

    if model_key == "xgboost":
        model_file = path / "model.json"
        if not model_file.exists():
            raise FileNotFoundError(f"XGBoost model file not found: {model_file}")
        booster = xgb.Booster()
        booster.load_model(model_file)
        loaded["model"] = booster

    _loaded_models[model_key] = loaded
    return _loaded_models[model_key]


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ml-inference"})


@app.route("/models/<model_key>/metadata", methods=["GET"])
def model_metadata(model_key: str):
    """Return metadata.json for a modelKey under models/<modelKey>/metadata.json."""
    try:
        model_path = _get_model_path(model_key)
        metadata_path = model_path / "metadata.json"
        if not metadata_path.exists():
            return jsonify({"error": f"metadata.json not found: {metadata_path}"}), 404
        with open(metadata_path) as f:
            meta = json.load(f)
        return jsonify(meta)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/forecast", methods=["POST"])
def forecast():
    """
    Request body: { "modelKey": "lstm", "horizon": 7, "datasetPath": "optional/path/to.csv" }
    Returns: { "dates": [], "forecast": [], "actual": [], "metrics": { "mae", "rmse", "mape" } }
    """
    try:
        body = request.get_json() or {}
        model_key = body.get("modelKey")
        horizon = int(body.get("horizon", 7))
        dataset_path = body.get("datasetPath")

        if not model_key:
            return jsonify({"error": "modelKey required"}), 400
        horizon = max(1, min(90, horizon))

        loaded = _load_model_if_needed(model_key)

        if model_key != "xgboost":
            return jsonify({"error": f"Real forecasting not implemented for modelKey={model_key} yet"}), 400

        meta = loaded.get("metadata") or {}
        feature_cols = meta.get("features") or []
        if not feature_cols:
            return jsonify({"error": "xgboost metadata.json must include a 'features' list"}), 500

        daily = _read_daily_series(dataset_path, target_fallback="value")
        if len(daily) < 35:
            return jsonify({"error": "Not enough history rows in dataset after cleaning/aggregation (need at least ~35 days)."}), 400

        booster: xgb.Booster = loaded["model"]

        # Iterative multi-step forecast (autoregressive)
        history = daily.copy()
        last_date = pd.to_datetime(history["Date"].iloc[-1])

        out_dates: list[str] = []
        out_forecast: list[float] = []

        for i in range(horizon):
            next_date = last_date + pd.Timedelta(days=1)
            X_next = _make_xgb_feature_row(history, next_date, feature_cols)
            dnext = xgb.DMatrix(X_next)
            y_next = float(booster.predict(dnext)[0])
            y_next = max(0.0, y_next)

            out_dates.append(next_date.date().isoformat())
            out_forecast.append(y_next)

            history = pd.concat(
                [history, pd.DataFrame([{"Date": next_date, "Quantity": y_next}])],
                ignore_index=True,
            )
            last_date = next_date

        return jsonify({
            "dates": out_dates,
            "forecast": out_forecast,
            "actual": [None] * horizon,
            "metrics": meta.get("performance", {}).get("validation") or meta.get("metrics") or {},
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/explain", methods=["POST"])
def explain():
    """
    Request body: { "modelKey": "lstm", "runId": "optional" }
    Returns: { "shap": [{ "feature", "importance" }], "attention": [{ "step", "weight" }] }
    """
    try:
        body = request.get_json() or {}
        model_key = body.get("modelKey")

        if not model_key:
            return jsonify({"error": "modelKey required"}), 400

        _load_model_if_needed(model_key)

        # Placeholder: return dummy SHAP/attention. Replace with real SHAP/attention
        # computed from the loaded model (e.g. shap.TreeExplainer for XGBoost).
        shap = [
            {"feature": "lag_1", "importance": 0.32},
            {"feature": "lag_7", "importance": 0.28},
            {"feature": "seasonality", "importance": 0.18},
        ]
        attention = [
            {"step": i, "weight": 0.1 + (i * 0.02)} for i in range(7)
        ]
        return jsonify({"shap": shap, "attention": attention})
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("ML_PORT", 5000))
    print(f"ML inference service at http://localhost:{port}")
    print(f"Models directory: {MODELS_DIR}")
    app.run(host="0.0.0.0", port=port, debug=True)
