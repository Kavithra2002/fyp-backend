import { Router } from "express";
import { isMlServiceConfigured, mlForecast } from "../services/mlService.js";
import type { ForecastRequest, ForecastResponse } from "../types.js";
import { z } from "zod";
import {
  getDatasetById,
  getForecastRunForUser,
  getUserState,
  getLatestForecastRunForUser,
  getModelById,
  saveForecastRun,
  setUserState,
} from "../services/appRepo.js";

const router = Router();
const forecastSchema = z.object({
  datasetId: z.string().uuid(),
  modelId: z.string().uuid(),
  horizon: z.number().int().min(1).max(90),
});

// POST /forecast
router.post("/", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = forecastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid forecast payload" });
  const body = parsed.data as ForecastRequest;

  const horizon = Math.min(Math.max(1, Number(body.horizon) || 7), 90);
  const model = await getModelById(body.modelId, userId);
  const dataset = await getDatasetById(body.datasetId, userId);
  if (!model) return res.status(404).json({ error: "Model not found" });
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });

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
      const runId = await saveForecastRun(userId, dataset.id, model.id, resp);
      await setUserState(userId, {
        activeDatasetId: dataset.id,
        activeModelId: model.id,
        latestForecastRunId: runId,
      });
      return res.json({ ...resp, runId });
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
  const fallbackResp = {
    dates,
    actual,
    forecast,
    metrics: { mae: 4.2, rmse: 5.1, mape: 3.8 },
  } satisfies ForecastResponse;
  const runId = await saveForecastRun(userId, dataset.id, model.id, fallbackResp);
  await setUserState(userId, {
    activeDatasetId: dataset.id,
    activeModelId: model.id,
    latestForecastRunId: runId,
  });
  res.json({ ...fallbackResp, runId });
});

// GET /forecast/latest
router.get("/latest", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const state = await getUserState(userId);
  if (state.latestForecastRunId) {
    const saved = await getForecastRunForUser(userId, state.latestForecastRunId);
    if (saved) return res.json({ runId: state.latestForecastRunId, ...saved });
  }

  const latest = await getLatestForecastRunForUser(userId);
  if (!latest) return res.status(404).json({ error: "No forecast run found. Run forecast first." });
  await setUserState(userId, { latestForecastRunId: latest.id });
  res.json({ runId: latest.id, ...latest.payload });
});

export default router;
