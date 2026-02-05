import { Router } from "express";
import { models } from "../store.js";
import { isMlServiceConfigured, mlForecast } from "../services/mlService.js";
import type { ForecastRequest, ForecastResponse } from "../types.js";
import { datasets } from "../store.js";

const router = Router();

// POST /forecast
router.post("/", async (req, res) => {
  const body = req.body as ForecastRequest;
  if (!body?.datasetId || !body?.modelId || body?.horizon == null) {
    return res.status(400).json({ error: "datasetId, modelId, and horizon required" });
  }

  const horizon = Math.min(Math.max(1, Number(body.horizon) || 7), 90);
  const model = models.get(body.modelId);
  const dataset = datasets.get(body.datasetId);

  // Option 1: call ML service when configured and model has modelKey
  if (isMlServiceConfigured() && model?.modelKey) {
    try {
      const ml = await mlForecast(model.modelKey, horizon, dataset?.filePath ?? undefined);
      const resp: ForecastResponse = {
        dates: ml.dates,
        actual: ml.actual ?? ml.dates.map(() => null),
        forecast: ml.forecast,
        metrics: ml.metrics ?? { mae: 0, rmse: 0, mape: 0 },
      };
      return res.json(resp);
    } catch (err) {
      console.error("ML forecast error:", (err as Error).message);
      // Fall through to mock
    }
  }

  // Mock when ML not configured or model has no modelKey or ML call failed
  const dates: string[] = [];
  const actual: (number | null)[] = [];
  const forecast: number[] = [];
  const now = new Date();
  for (let i = 0; i < horizon; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
    actual.push(i < 3 ? 100 + Math.random() * 20 : null);
    forecast.push(105 + Math.sin(i * 0.3) * 10 + Math.random() * 5);
  }
  res.json({
    dates,
    actual,
    forecast,
    metrics: { mae: 4.2, rmse: 5.1, mape: 3.8 },
  } satisfies ForecastResponse);
});

export default router;
