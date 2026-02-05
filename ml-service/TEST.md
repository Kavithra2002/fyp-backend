# How to test the ML service (app.py)

## 1. Start the service

```bash
cd ml-service
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
python app.py
```

You should see:
- `ML inference service at http://localhost:5000`
- `Models directory: ...`

Keep this terminal open.

---

## 2. Test the endpoints

Use a **new** terminal (or Postman / browser where noted).

### Health (browser or curl)

- **Browser:** open http://localhost:5000/health  
- **PowerShell:** `Invoke-RestMethod -Uri http://localhost:5000/health`

Expected: `{"status":"ok","service":"ml-inference"}`

---

### Forecast (POST)

**PowerShell:**

```powershell
Invoke-RestMethod -Uri http://localhost:5000/forecast -Method POST -ContentType "application/json" -Body '{"modelKey":"lstm","horizon":7}'
```

**curl (if installed):**

```bash
curl -X POST http://localhost:5000/forecast -H "Content-Type: application/json" -d "{\"modelKey\":\"lstm\",\"horizon\":7}"
```

Expected: JSON with `dates`, `forecast`, `actual`, `metrics`.

---

### Explain (POST)

**PowerShell:**

```powershell
Invoke-RestMethod -Uri http://localhost:5000/explain -Method POST -ContentType "application/json" -Body '{"modelKey":"lstm"}'
```

**curl:**

```bash
curl -X POST http://localhost:5000/explain -H "Content-Type: application/json" -d "{\"modelKey\":\"lstm\"}"
```

Expected: JSON with `shap` and `attention` arrays.

---

## 3. Test from the Node backend

1. In `.env` add: `ML_SERVICE_URL=http://localhost:5000`
2. Start the backend: `npm run dev` (from the `backend` folder)
3. Register the demo model:  
   `POST http://localhost:4000/models/register`  
   Body: `{"name":"Demo LSTM","type":"lstm","modelKey":"lstm"}`
4. In your app, select that model and run Forecast or Explain; the backend will call the Python service.

---

The `models/lstm/` folder exists so these requests work without a real trained model. When you add a real Colab model, put its files in `models/lstm/` (or create e.g. `models/xgboost/` and use `modelKey`: `xgboost`).
