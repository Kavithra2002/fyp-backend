import { Router } from "express";
import type { ForecastRequest, ForecastResponse } from "../types.js";

const router = Router();

// POST /forecast
router.post("/", (req, res) => {
  const body = req.body as ForecastRequest;
  if (!body?.datasetId || !body?.modelId || body?.horizon == null) {
    return res.status(400).json({ error: "datasetId, modelId, and horizon required" });
  }

  // Mock: generate sample time series. Replace with ML service call.
  const horizon = Math.min(Math.max(1, Number(body.horizon) || 7), 90);
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

  const resp: ForecastResponse = {
    dates,
    actual,
    forecast,
    metrics: { mae: 4.2, rmse: 5.1, mape: 3.8 },
  };
  res.json(resp);
});

export default router;
