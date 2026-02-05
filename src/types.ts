/**
 * Types aligned with frontend lib/types.ts
 */

export interface Dataset {
  id: string;
  name: string;
  rows: number;
  columns: string[];
  uploadedAt: string;
  /** Absolute or relative path to the CSV file (for ML service to read). */
  filePath?: string;
  isActive?: boolean;
}

export type ModelType = "lstm" | "xgboost" | "ensemble";

export interface Model {
  id: string;
  name: string;
  type: ModelType;
  datasetId: string;
  /** Key used by the ML service to load from models/<modelKey>/ (e.g. "lstm", "xgboost"). */
  modelKey?: string;
  mae?: number;
  rmse?: number;
  mape?: number;
  trainedAt: string;
  isActive?: boolean;
}

export interface TrainRequest {
  datasetId: string;
  type: ModelType;
  params?: Record<string, unknown>;
}

export interface ForecastRequest {
  datasetId: string;
  modelId: string;
  horizon: number;
}

export interface ForecastResponse {
  dates: string[];
  actual: (number | null)[];
  forecast: number[];
  metrics: { mae: number; rmse: number; mape: number };
}

export interface ExplainRequest {
  modelId: string;
  runId?: string;
}

export interface ExplainResponse {
  shap: { feature: string; importance: number }[];
  attention?: { step: number; weight: number }[];
}

export interface ScenarioRequest {
  baseRunId: string;
  overrides: Record<string, number>;
}

export interface ScenarioResult {
  name: string;
  forecast: number[];
  summary?: number;
}

export interface ScenarioResponse {
  base: ScenarioResult;
  scenario: ScenarioResult;
}

export interface ExportRequest {
  type: "pdf" | "xlsx";
  runId?: string;
  scenarioRunId?: string;
}
