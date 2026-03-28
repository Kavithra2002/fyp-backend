"""
Option 1 ML inference service.
Loads Colab-trained models from the 'models' folder and serves /forecast and /explain.
Run: python app.py  (or: flask --app app run -p 5000)
"""
import os
import json
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
import xgboost as xgb
import tensorflow as tf
from tensorflow import keras

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://localhost:4000", "http://127.0.0.1:4000"])

# Folder where you place downloaded Colab models: models/<modelKey>/
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("ML_MODELS_DIR", BASE_DIR / "models"))
ALLOWED_PREFIXES = [p.strip() for p in os.environ.get("ML_ALLOWED_DATA_PREFIXES", "").split(",") if p.strip()]

# In-memory cache: modelKey -> loaded model (or None if not yet loaded)
# When you add real Keras/XGBoost loading, replace the value with the actual model.
_loaded_models = {}

def _load_xgb_features(model_path: Path, metadata: dict) -> list[str]:
    """
    Resolve XGBoost feature list from metadata first, then fallback to features.json
    or the latest xgboost_features_*.json file.
    """
    features = metadata.get("features")
    if isinstance(features, list) and features:
        return [str(f) for f in features]

    candidates = [model_path / "features.json"]
    candidates.extend(sorted(model_path.glob("xgboost_features_*.json"), reverse=True))
    for fp in candidates:
        if not fp.exists():
            continue
        try:
            with open(fp) as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                return [str(x) for x in data]
        except Exception:
            continue
    return []


def _get_model_path(model_key: str) -> Path:
    """Resolve path to a model folder. model_key e.g. 'lstm', 'xgboost'."""
    path = MODELS_DIR / model_key.strip()
    if not path.is_dir():
        raise FileNotFoundError(f"Model folder not found: {path}")
    return path


def _load_metadata_from_model_folder(model_path: Path) -> dict:
    """
    Load model metadata from common filenames.
    - Most models: `metadata.json`
    - Ensemble training notebook: `ensemble_metadata.json`
    """
    for filename in ["metadata.json", "ensemble_metadata.json"]:
        metadata_path = model_path / filename
        if metadata_path.exists():
            with open(metadata_path) as f:
                return json.load(f)
    return {}


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
    if ALLOWED_PREFIXES:
        resolved = str(path.resolve()).lower().replace("\\", "/")
        ok = any(resolved.startswith(str(Path(p).resolve()).lower().replace("\\", "/")) for p in ALLOWED_PREFIXES)
        if not ok:
            raise ValueError("datasetPath is outside allowed prefixes")

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


def _forecast_xgboost_autoreg(
    history_daily: pd.DataFrame,
    horizon: int,
    booster: xgb.Booster,
    feature_cols: list[str],
) -> tuple[list[str], list[float]]:
    """
    Iterative autoregressive forecast for XGBoost using the same feature builder
    as the single-model endpoint.
    """
    history = history_daily.copy()
    last_date = pd.to_datetime(history["Date"].iloc[-1])

    out_dates: list[str] = []
    out_forecast: list[float] = []

    for _ in range(horizon):
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

    return out_dates, out_forecast


def _forecast_lstm_autoreg(
    daily: pd.DataFrame,
    horizon: int,
    model: keras.Model,
    lookback: int,
) -> tuple[list[str], list[float]]:
    """
    Iterative autoregressive forecast for LSTM from the daily Quantity series.
    Note: This matches the existing placeholder inference style in this service.
    """
    # LSTM was trained on MinMax-scaled target values.
    raw_series = daily["Quantity"].astype("float64").to_numpy()
    if len(raw_series) < lookback:
        raise ValueError(f"Not enough history rows for LSTM (need at least lookback={lookback} days).")

    # Simple MinMaxScaler equivalent (avoids extra sklearn dependency).
    # Fit scaler on the available history series we read from the CSV.
    data_min = float(np.min(raw_series))
    data_max = float(np.max(raw_series))
    denom = (data_max - data_min) if (data_max - data_min) != 0 else 1.0

    def scale(v: np.ndarray) -> np.ndarray:
        return (v - data_min) / denom

    def inverse_scale(v_scaled: np.ndarray) -> np.ndarray:
        return v_scaled * denom + data_min

    history_scaled = scale(raw_series).copy()
    last_date = pd.to_datetime(daily["Date"].iloc[-1])

    out_dates: list[str] = []
    out_forecast: list[float] = []

    for _ in range(horizon):
        window = history_scaled[-lookback:]
        window = window.reshape((1, lookback, 1))
        y_next = float(model.predict(window, verbose=0)[0][0])
        # Keep scaled predictions within [0,1] for stability.
        y_next_scaled = min(1.0, max(0.0, y_next))
        y_next_raw = float(inverse_scale(np.array([y_next_scaled]))[0])
        y_next_raw = max(0.0, y_next_raw)

        last_date = last_date + pd.Timedelta(days=1)
        out_dates.append(last_date.date().isoformat())
        out_forecast.append(y_next_raw)

        history_scaled = np.append(history_scaled, y_next_scaled)

    return out_dates, out_forecast


def _explain_lstm_recent_window(
    daily: pd.DataFrame,
    model: keras.Model,
    lookback: int,
) -> tuple[list[dict], list[dict]]:
    """
    Build LSTM explainability for the latest prediction window using
    gradient-based attributions over timesteps.
    Returns:
      - shap-like feature importance [{feature, importance}]
      - attention-like weights [{step, weight}]
    """
    raw_series = daily["Quantity"].astype("float64").to_numpy()
    if len(raw_series) < lookback:
        raise ValueError(f"Not enough history rows for LSTM explanation (need at least lookback={lookback} days).")

    data_min = float(np.min(raw_series))
    data_max = float(np.max(raw_series))
    denom = (data_max - data_min) if (data_max - data_min) != 0 else 1.0
    scaled = (raw_series - data_min) / denom

    window = scaled[-lookback:].astype("float32").reshape((1, lookback, 1))
    x = tf.convert_to_tensor(window)

    # Saliency-style attribution: absolute gradient * input magnitude per timestep.
    with tf.GradientTape() as tape:
        tape.watch(x)
        pred = model(x, training=False)
    grad = tape.gradient(pred, x)
    if grad is None:
        raise RuntimeError("Failed to compute gradients for LSTM explainability.")

    grad_np = grad.numpy()[0, :, 0]
    input_np = window[0, :, 0]
    contrib = np.abs(grad_np * input_np).astype("float64")

    total = float(np.sum(contrib))
    if total <= 0:
        contrib = np.abs(grad_np).astype("float64")
        total = float(np.sum(contrib))
        if total <= 0:
            contrib = np.ones_like(contrib, dtype="float64")
            total = float(np.sum(contrib))

    weights = contrib / total

    # step 0 = oldest timestep in the lookback window, step lookback-1 = most recent
    attention = [{"step": int(i), "weight": float(weights[i])} for i in range(lookback)]
    shap = [
        {"feature": f"lag_{lookback - i}", "importance": float(weights[i])}
        for i in range(lookback)
    ]
    shap = sorted(shap, key=lambda x: x["importance"], reverse=True)[:20]
    return shap, attention


def _load_model_if_needed(model_key: str):
    """Load model from models/<modelKey>/ if not already in cache."""
    if model_key in _loaded_models:
        return _loaded_models[model_key]
    path = _get_model_path(model_key)

    metadata = _load_metadata_from_model_folder(path)

    loaded = {"path": str(path), "metadata": metadata, "model": None}

    if model_key == "xgboost":
        model_file = path / "model.json"
        if not model_file.exists():
            raise FileNotFoundError(f"XGBoost model file not found: {model_file}")
        booster = xgb.Booster()
        booster.load_model(model_file)
        loaded["model"] = booster
        loaded["features"] = _load_xgb_features(path, metadata)
    elif model_key == "lstm":
        # Expect a Keras SavedModel/keras file at models/lstm/model.keras
        model_file = path / "model.keras"
        if not model_file.exists():
            raise FileNotFoundError(f"LSTM model file not found: {model_file}")
        model = keras.models.load_model(model_file)
        loaded["model"] = model

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
        meta = _load_metadata_from_model_folder(model_path)
        if not meta:
            return jsonify({"error": f"metadata not found under: {model_path}"}), 404
        # For simple metadata files (like the LSTM one) that only contain
        # flat mae/rmse/mape keys, normalise into a "metrics" block so that
        # the Node API can still read them via meta.metrics.*.
        if "performance" not in meta and "metrics" not in meta:
            flat_keys = {k: meta[k] for k in ["mae", "rmse", "mape"] if k in meta}
            if flat_keys:
                meta = {**meta, "metrics": flat_keys}
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
        meta = loaded.get("metadata") or {}

        # Helper: choose metrics regardless of exact metadata structure
        def _extract_metrics(m: dict) -> dict:
            perf_val = (m.get("performance") or {}).get("validation") or {}
            if perf_val:
                return perf_val
            metrics_block = m.get("metrics") or {}
            if metrics_block:
                return metrics_block
            flat = {k: m[k] for k in ("mae", "rmse", "mape") if k in m}
            return flat

        daily = _read_daily_series(dataset_path, target_fallback="value")

        if model_key == "ensemble":
            loaded_xgb = _load_model_if_needed("xgboost")
            loaded_lstm = _load_model_if_needed("lstm")

            xgb_meta = loaded_xgb.get("metadata") or {}
            feature_cols = xgb_meta.get("features") or []
            if not feature_cols:
                return jsonify({"error": "xgboost metadata.json must include a 'features' list"}), 500
            if len(daily) < 35:
                return jsonify(
                    {"error": "Not enough history rows in dataset after cleaning/aggregation (need at least ~35 days)."}
                ), 400

            lstm_meta = loaded_lstm.get("metadata") or {}
            lookback = int(lstm_meta.get("lookback", 30))
            if len(daily) < lookback:
                return jsonify({"error": f"Not enough history rows for LSTM (need at least lookback={lookback} days)."}), 400

            xgb_booster: xgb.Booster | None = loaded_xgb.get("model")
            lstm_model: keras.Model | None = loaded_lstm.get("model")
            if xgb_booster is None or lstm_model is None:
                return jsonify({"error": "Missing underlying XGBoost/LSTM models for ensemble"}), 500

            xgb_dates, xgb_forecast = _forecast_xgboost_autoreg(daily, horizon, xgb_booster, feature_cols)
            lstm_dates, lstm_forecast = _forecast_lstm_autoreg(daily, horizon, lstm_model, lookback)

            # Average per-step forecasts. Dates should match, but keep xgb_dates as the canonical list.
            ens_forecast = [(float(a) + float(b)) / 2.0 for a, b in zip(xgb_forecast, lstm_forecast)]

            return jsonify({
                "dates": xgb_dates,
                "forecast": ens_forecast,
                "actual": [None] * horizon,
                "metrics": _extract_metrics(meta),
            })

        if model_key == "xgboost":
            feature_cols = meta.get("features") or []
            if not feature_cols:
                return jsonify({"error": "xgboost metadata.json must include a 'features' list"}), 500

            if len(daily) < 35:
                return jsonify({"error": "Not enough history rows in dataset after cleaning/aggregation (need at least ~35 days)."}), 400

            booster: xgb.Booster = loaded["model"]

            # Iterative multi-step forecast (autoregressive)
            history = daily.copy()
            last_date = pd.to_datetime(history["Date"].iloc[-1])

            out_dates: list[str] = []
            out_forecast: list[float] = []

            for _ in range(horizon):
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
                "metrics": _extract_metrics(meta),
            })

        if model_key == "lstm":
            lookback = int(meta.get("lookback", 30))
            try:
                model = loaded["model"]
                out_dates, out_forecast = _forecast_lstm_autoreg(daily, horizon, model, lookback)
                return jsonify({
                    "dates": out_dates,
                    "forecast": out_forecast,
                "actual": [None] * horizon,
                    "metrics": _extract_metrics(meta),
                })
            except ValueError as e:
                return jsonify({"error": str(e)}), 400

        return jsonify({"error": f"Real forecasting not implemented for modelKey={model_key} yet"}), 400
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/explain", methods=["POST"])
def explain():
    """
    Request body: { "modelKey": "xgboost|lstm|ensemble", "runId": "optional", "datasetPath": "optional/path.csv" }
    Returns: { "shap": [{ "feature", "importance" }], "attention": [{ "step", "weight" }] }
    """
    try:
        body = request.get_json() or {}
        model_key = body.get("modelKey")
        dataset_path = body.get("datasetPath")

        if not model_key:
            return jsonify({"error": "modelKey required"}), 400

        loaded = _load_model_if_needed(model_key)

        if model_key == "xgboost":
            booster: xgb.Booster | None = loaded.get("model")
            feature_cols: list[str] = loaded.get("features") or []
            if booster is None:
                return jsonify({"error": "XGBoost model is not loaded"}), 500
            if not feature_cols:
                return jsonify({"error": "XGBoost feature list not found. Add features.json or metadata.features."}), 500

            # Prefer local explanation for the next prediction step when datasetPath is provided.
            if dataset_path:
                daily = _read_daily_series(dataset_path, target_fallback="value")
                if len(daily) < 35:
                    return jsonify({"error": "Not enough history rows in dataset for XGBoost explanation (need at least ~35 days)."}), 400

                next_date = pd.to_datetime(daily["Date"].iloc[-1]) + pd.Timedelta(days=1)
                X_next = _make_xgb_feature_row(daily, next_date, feature_cols)
                dnext = xgb.DMatrix(X_next)
                contrib = booster.predict(dnext, pred_contribs=True)[0]
                # pred_contribs includes one extra bias term at the end.
                shap_abs = np.abs(contrib[:-1]).astype("float64")
                total = float(np.sum(shap_abs))
                if total <= 0:
                    total = 1.0
                shap = [
                    {"feature": feature_cols[i], "importance": float(shap_abs[i] / total)}
                    for i in range(len(feature_cols))
                ]
                shap = sorted(shap, key=lambda x: x["importance"], reverse=True)[:20]
                return jsonify({"shap": shap})

            # Fallback: global feature importance from model gain, normalized for charting.
            gain_map = booster.get_score(importance_type="gain")
            values = [float(gain_map.get(f, 0.0)) for f in feature_cols]
            total = float(sum(values)) if sum(values) > 0 else 1.0
            shap = [
                {"feature": feature_cols[i], "importance": float(values[i] / total)}
                for i in range(len(feature_cols))
                if values[i] > 0
            ]
            shap = sorted(shap, key=lambda x: x["importance"], reverse=True)[:20]
            return jsonify({"shap": shap})

        if model_key == "lstm":
            model: keras.Model | None = loaded.get("model")
            meta = loaded.get("metadata") or {}
            lookback = int(meta.get("lookback", 30))
            if model is None:
                return jsonify({"error": "LSTM model is not loaded"}), 500
            if not dataset_path:
                return jsonify({
                    "error": "datasetPath is required for LSTM explanation. Select an active dataset and try again."
                }), 400

            daily = _read_daily_series(dataset_path, target_fallback="value")
            shap, attention = _explain_lstm_recent_window(daily, model, lookback)
            return jsonify({"shap": shap, "attention": attention})

        if model_key == "ensemble":
            if not dataset_path:
                return jsonify({
                    "error": "datasetPath is required for Ensemble explanation. Select an active dataset and try again."
                }), 400

            loaded_xgb = _load_model_if_needed("xgboost")
            loaded_lstm = _load_model_if_needed("lstm")

            booster: xgb.Booster | None = loaded_xgb.get("model")
            feature_cols: list[str] = loaded_xgb.get("features") or []
            lstm_model: keras.Model | None = loaded_lstm.get("model")
            lstm_meta = loaded_lstm.get("metadata") or {}
            lookback = int(lstm_meta.get("lookback", 30))
            ens_meta = loaded.get("metadata") or {}
            weights = ens_meta.get("weights") or {}
            xgb_w = float(weights.get("xgboost", 0.5))
            lstm_w = float(weights.get("lstm", 1.0 - xgb_w))
            # Normalize in case metadata is inconsistent.
            ws = xgb_w + lstm_w
            if ws <= 0:
                xgb_w, lstm_w = 0.5, 0.5
            else:
                xgb_w, lstm_w = xgb_w / ws, lstm_w / ws

            if booster is None or lstm_model is None:
                return jsonify({"error": "Missing underlying XGBoost/LSTM models for ensemble explanation"}), 500
            if not feature_cols:
                return jsonify({"error": "XGBoost feature list not found for ensemble explanation"}), 500

            daily = _read_daily_series(dataset_path, target_fallback="value")
            if len(daily) < 35:
                return jsonify({"error": "Not enough history rows in dataset for Ensemble explanation (need at least ~35 days)."}), 400
            if len(daily) < lookback:
                return jsonify({"error": f"Not enough history rows for LSTM part (need at least lookback={lookback} days)."}), 400

            # XGBoost local explain for next-step prediction.
            next_date = pd.to_datetime(daily["Date"].iloc[-1]) + pd.Timedelta(days=1)
            X_next = _make_xgb_feature_row(daily, next_date, feature_cols)
            dnext = xgb.DMatrix(X_next)
            contrib = booster.predict(dnext, pred_contribs=True)[0]
            xgb_abs = np.abs(contrib[:-1]).astype("float64")
            xgb_total = float(np.sum(xgb_abs))
            if xgb_total <= 0:
                xgb_total = 1.0
            xgb_shap = {
                feature_cols[i]: float(xgb_abs[i] / xgb_total)
                for i in range(len(feature_cols))
            }

            # LSTM explain using timestep attributions.
            lstm_shap_list, attention = _explain_lstm_recent_window(daily, lstm_model, lookback)
            lstm_shap = {item["feature"]: float(item["importance"]) for item in lstm_shap_list}

            # Weighted merge of feature importances from both models.
            merged_features = set(xgb_shap.keys()) | set(lstm_shap.keys())
            merged = []
            for feat in merged_features:
                score = xgb_w * xgb_shap.get(feat, 0.0) + lstm_w * lstm_shap.get(feat, 0.0)
                if score > 0:
                    merged.append({"feature": feat, "importance": float(score)})
            merged = sorted(merged, key=lambda x: x["importance"], reverse=True)[:20]

            # Re-normalize merged top features for cleaner chart percentages.
            msum = float(sum(x["importance"] for x in merged))
            if msum > 0:
                merged = [{"feature": x["feature"], "importance": float(x["importance"] / msum)} for x in merged]

            return jsonify({"shap": merged, "attention": attention})

        return jsonify({"error": f"Unsupported modelKey for explain: {model_key}"}), 400
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("ML_PORT", 5000))
    debug_enabled = os.environ.get("ML_DEBUG", "false").lower() == "true"
    print(f"ML inference service at http://localhost:{port}")
    print(f"Models directory: {MODELS_DIR}")
    app.run(host="0.0.0.0", port=port, debug=debug_enabled)
