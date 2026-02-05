/**
 * Client for the Option 1 Python ML inference service.
 * Set ML_SERVICE_URL (e.g. http://localhost:5000) to enable; otherwise forecast/explain use mocks.
 */

const ML_BASE = process.env.ML_SERVICE_URL?.trim() || "";

export function isMlServiceConfigured(): boolean {
  return ML_BASE.length > 0;
}

export interface MlForecastResponse {
  dates: string[];
  forecast: number[];
  actual?: (number | null)[];
  metrics?: { mae: number; rmse: number; mape: number };
}

export async function mlForecast(
  modelKey: string,
  horizon: number,
  datasetPath?: string | null
): Promise<MlForecastResponse> {
  const res = await fetch(`${ML_BASE}/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelKey,
      horizon,
      ...(datasetPath && { datasetPath }),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `ML service error: ${res.status}`);
  }
  return res.json() as Promise<MlForecastResponse>;
}

export interface MlExplainResponse {
  shap: { feature: string; importance: number }[];
  attention?: { step: number; weight: number }[];
}

export async function mlExplain(modelKey: string, runId?: string): Promise<MlExplainResponse> {
  const res = await fetch(`${ML_BASE}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelKey, ...(runId && { runId }) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `ML service error: ${res.status}`);
  }
  return res.json() as Promise<MlExplainResponse>;
}

export async function mlHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${ML_BASE}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
