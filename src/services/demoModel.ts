/**
 * DEMO MODEL – for submission / presentation.
 *
 * Returns realistic but deterministic results so the full flow works:
 * Train → Job status → Forecast → Explain.
 *
 * When the real ML service (Python LSTM/XGBoost/Ensemble) is ready,
 * replace usage with the real model runner; see modelRunner.ts and DEMO_MODEL_README.md.
 */

import { v4 as uuidv4 } from "uuid";
import { datasets, models, jobStore } from "../store.js";
import type {
  Model,
  ModelType,
  ForecastResponse,
  ExplainResponse,
} from "../types.js";

/** Demo metrics per model type (deterministic for presentation) */
const DEMO_METRICS: Record<ModelType, { mae: number; rmse: number; mape: number }> = {
  lstm: { mae: 0.18, rmse: 0.24, mape: 11.2 },
  xgboost: { mae: 0.15, rmse: 0.21, mape: 9.8 },
  ensemble: { mae: 0.12, rmse: 0.18, mape: 8.5 },
};

/**
 * Start "training" – creates a demo model and registers the job.
 * Real implementation would call Python ML service and poll for completion.
 */
export function startTraining(datasetId: string, type: ModelType): { jobId: string; model: Model } {
  const jobId = uuidv4();
  const metrics = DEMO_METRICS[type];
  const model: Model = {
    id: uuidv4(),
    name: `demo-${type}-${Date.now()}`,
    type,
    datasetId,
    mae: metrics.mae,
    rmse: metrics.rmse,
    mape: metrics.mape,
    trainedAt: new Date().toISOString(),
  };
  models.set(model.id, model);
  jobStore.set(jobId, { status: "done", modelId: model.id });
  return { jobId, model };
}

/**
 * Get job status. Demo: always "done" with the model.
 * Real implementation would call Python GET /train/:jobId.
 */
export function getJobStatus(
  jobId: string
): { status: "pending" | "done"; model?: Model } {
  const job = jobStore.get(jobId);
  if (!job) return { status: "pending" };
  const model = job.modelId ? models.get(job.modelId) : undefined;
  return { status: job.status, model: model ?? undefined };
}

/**
 * Run "forecast" – deterministic demo time series.
 * Real implementation would call Python POST /forecast with modelPath and horizon.
 */
export function runForecast(
  _datasetId: string,
  modelId: string,
  horizon: number
): ForecastResponse | null {
  const model = models.get(modelId);
  if (!model) return null;
  const h = Math.min(Math.max(1, horizon), 90);
  const dates: string[] = [];
  const actual: (number | null)[] = [];
  const forecast: number[] = [];
  const base = 100;
  const now = new Date();
  for (let i = 0; i < h; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
    actual.push(i < 3 ? base + 5 * Math.sin(i * 0.5) : null);
    forecast.push(base + 4 * Math.sin(i * 0.5) + (i * 0.1));
  }
  const metrics = DEMO_METRICS[model.type] ?? DEMO_METRICS.ensemble;
  return {
    dates,
    actual,
    forecast,
    metrics: { mae: metrics.mae, rmse: metrics.rmse, mape: metrics.mape },
  };
}

/**
 * Get "explain" – SHAP and optional attention by model type.
 * Real implementation would call Python POST /explain.
 */
export function runExplain(modelId: string, _runId?: string): ExplainResponse | null {
  const model = models.get(modelId);
  if (!model) return null;
  const shap = getDemoShap(model.type);
  const attention = model.type === "lstm" || model.type === "ensemble" ? getDemoAttention() : undefined;
  return { shap, attention };
}

function getDemoShap(type: ModelType): { feature: string; importance: number }[] {
  const base = [
    { feature: "lag_7", importance: 0.28 },
    { feature: "lag_14", importance: 0.22 },
    { feature: "rolling_mean_7", importance: 0.18 },
    { feature: "seasonality", importance: 0.14 },
    { feature: "trend", importance: 0.1 },
  ];
  if (type === "xgboost") return base;
  if (type === "ensemble") return base.map((b) => ({ ...b, importance: b.importance * 0.95 }));
  return base.map((b) => ({ ...b, importance: b.importance * 1.05 }));
}

function getDemoAttention(): { step: number; weight: number }[] {
  const weights = [0.05, 0.08, 0.12, 0.15, 0.2, 0.22, 0.18];
  return weights.map((weight, step) => ({ step, weight }));
}
