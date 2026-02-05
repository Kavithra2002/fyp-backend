"""
Option 1 ML inference service.
Loads Colab-trained models from the 'models' folder and serves /forecast and /explain.
Run: python app.py  (or: flask --app app run -p 5000)
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS

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


def _load_model_if_needed(model_key: str):
    """Load model from models/<modelKey>/ if not already in cache."""
    if model_key in _loaded_models:
        return _loaded_models[model_key]
    path = _get_model_path(model_key)
    # Placeholder: real implementation will load Keras/XGBoost from path
    # e.g. keras.models.load_model(path / "model.h5") or xgboost.Booster()
    metadata_path = path / "metadata.json"
    metadata = {}
    if metadata_path.exists():
        with open(metadata_path) as f:
            metadata = json.load(f)
    _loaded_models[model_key] = {"path": str(path), "metadata": metadata}
    return _loaded_models[model_key]


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ml-inference"})


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

        _load_model_if_needed(model_key)

        # Placeholder: generate dummy forecast. Replace with real model.predict() using
        # dataset_path to read last N rows and run inference.
        today = datetime.now().date()
        dates = [(today + timedelta(days=i)).isoformat() for i in range(horizon)]
        # When you wire real model: run inference and fill forecast list
        forecast_values = [100.0 + (i * 0.5) for i in range(horizon)]
        actual = [None] * horizon

        return jsonify({
            "dates": dates,
            "forecast": forecast_values,
            "actual": actual,
            "metrics": {"mae": 4.2, "rmse": 5.1, "mape": 3.8},
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
