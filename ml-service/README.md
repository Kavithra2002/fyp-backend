# ML Inference Service (Option 1)

Small Python service that loads your **Colab-trained, downloaded** models and serves forecast and explain to the Node backend.

## Run locally

```bash
cd ml-service
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # Mac/Linux
pip install -r requirements.txt
python app.py
```

Runs at **http://localhost:5000** by default.

## Endpoints

| Method | Path       | Body (JSON)                    | Description        |
|--------|------------|--------------------------------|--------------------|
| GET    | /health    | -                              | Service health     |
| POST   | /forecast  | modelKey, horizon, datasetPath?| Return forecast    |
| POST   | /explain   | modelKey, runId?               | Return SHAP/attention |

## Model folder

Put downloaded Colab models under `models/<modelKey>/` (e.g. `models/lstm/`). See `models/README.md`.

## Env (optional)

- `ML_PORT` – port (default 5000)
- `ML_MODELS_DIR` – path to models folder (default: `./models`)

## Next step

In `app.py`, replace the placeholder forecast/explain logic with real loading (e.g. Keras `load_model`, XGBoost `Booster`) and `model.predict()` / SHAP.
