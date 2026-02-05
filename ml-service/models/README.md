# Where to put your Colab-trained models

After training in Google Colab and downloading the model files:

1. Create a subfolder per model key, for example:
   - `lstm/`   → use modelKey `lstm` when registering in the app
   - `xgboost/` → use modelKey `xgboost`
   - `ensemble/` → use modelKey `ensemble`

2. Put inside that folder:
   - The model file(s) (e.g. `model.h5`, `model.json`, or SavedModel files)
   - Optional: `metadata.json` with `{ "mae", "rmse", "mape" }` for display

3. When you add real loading in `app.py`, load from this path (e.g. `models/lstm/model.h5`).

Example layout:

```
models/
  lstm/
    model.h5
    metadata.json
  xgboost/
    model.json
    metadata.json
```

Then register the model in the Node API via `POST /models/register` with `{ "modelKey": "lstm", ... }`.
