/**
 * Client for the Option 1 Python ML inference service.
 * Set ML_SERVICE_URL (e.g. http://localhost:5000) to enable; otherwise forecast/explain use mocks.
 */

const ML_BASE = process.env.ML_SERVICE_URL?.trim() || "";
const ALLOWED_DATA_PREFIXES = (process.env.ML_ALLOWED_DATA_PREFIXES || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function validateDatasetPath(datasetPath?: string | null): string | undefined {
  if (!datasetPath) return undefined;
  if (ALLOWED_DATA_PREFIXES.length === 0) return datasetPath;
  const normalized = datasetPath.replace(/\\/g, "/").toLowerCase();
  const allowed = ALLOWED_DATA_PREFIXES.some((p) =>
    normalized.startsWith(p.replace(/\\/g, "/").toLowerCase())
  );
  if (!allowed) {
    throw new Error("datasetPath is outside allowed ML data prefixes");
  }
  return datasetPath;
}

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
  const safePath = validateDatasetPath(datasetPath);
  const res = await fetch(`${ML_BASE}/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelKey,
      horizon,
      ...(safePath && { datasetPath: safePath }),
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

export async function mlExplain(
  modelKey: string,
  runId?: string,
  datasetPath?: string | null
): Promise<MlExplainResponse> {
  const safePath = validateDatasetPath(datasetPath);
  const res = await fetch(`${ML_BASE}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelKey, ...(runId && { runId }), ...(safePath && { datasetPath: safePath }) }),
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
