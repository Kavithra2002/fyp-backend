import { pool } from "../db.js";
import type { Dataset, ForecastResponse, Model, ScenarioResponse } from "../types.js";

type DatasetRow = {
  id: string;
  name: string;
  rows_count: number;
  columns_json: string;
  uploaded_at: Date;
  file_path: string | null;
  is_active: number;
};

type ModelRow = {
  id: string;
  name: string;
  type: Model["type"];
  dataset_id: string;
  model_key: string | null;
  mae: number | null;
  rmse: number | null;
  mape: number | null;
  trained_at: Date;
  is_active: number;
};

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureRuntimeSchema(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS user_state (
      user_id    VARCHAR(36) PRIMARY KEY,
      state_json JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  if (!(await hasColumn("forecast_runs", "user_id"))) {
    await pool.query("ALTER TABLE forecast_runs ADD COLUMN user_id VARCHAR(36) NULL AFTER id");
  }
  if (!(await hasColumn("scenario_runs", "user_id"))) {
    await pool.query("ALTER TABLE scenario_runs ADD COLUMN user_id VARCHAR(36) NULL AFTER id");
  }
  if (!(await hasColumn("datasets", "user_id"))) {
    await pool.query("ALTER TABLE datasets ADD COLUMN user_id VARCHAR(36) NULL");
  }
  if (!(await hasColumn("models", "user_id"))) {
    await pool.query("ALTER TABLE models ADD COLUMN user_id VARCHAR(36) NULL");
  }
}

function mapDataset(r: DatasetRow): Dataset {
  return {
    id: r.id,
    name: r.name,
    rows: r.rows_count,
    columns: JSON.parse(r.columns_json || "[]"),
    uploadedAt: new Date(r.uploaded_at).toISOString(),
    filePath: r.file_path || undefined,
    isActive: r.is_active === 1,
  };
}

function mapModel(r: ModelRow): Model {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    datasetId: r.dataset_id,
    modelKey: r.model_key || undefined,
    mae: r.mae ?? undefined,
    rmse: r.rmse ?? undefined,
    mape: r.mape ?? undefined,
    trainedAt: new Date(r.trained_at).toISOString(),
    isActive: r.is_active === 1,
  };
}

export async function listDatasets(userId: string): Promise<Dataset[]> {
  const [rows] = await pool.query(
    "SELECT * FROM datasets WHERE user_id = ? ORDER BY uploaded_at DESC",
    [userId]
  );
  return (rows as DatasetRow[]).map(mapDataset);
}

export async function getDatasetById(id: string, userId: string): Promise<Dataset | null> {
  const [rows] = await pool.query(
    "SELECT * FROM datasets WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  const row = (rows as DatasetRow[])[0];
  return row ? mapDataset(row) : null;
}

export async function createDataset(dataset: Dataset, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO datasets (id, name, rows_count, columns_json, uploaded_at, file_path, is_active, user_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      dataset.id,
      dataset.name,
      dataset.rows,
      JSON.stringify(dataset.columns || []),
      new Date(dataset.uploadedAt),
      dataset.filePath || null,
      userId,
    ]
  );
}

export async function setActiveDataset(datasetId: string, userId: string): Promise<void> {
  await pool.query("UPDATE datasets SET is_active = 0 WHERE user_id = ?", [userId]);
  await pool.query("UPDATE datasets SET is_active = 1 WHERE id = ? AND user_id = ?", [datasetId, userId]);
}

export async function deleteDataset(datasetId: string, userId: string): Promise<void> {
  await pool.query("DELETE FROM datasets WHERE id = ? AND user_id = ?", [datasetId, userId]);
}

export async function listModels(userId: string): Promise<Model[]> {
  const [rows] = await pool.query(
    "SELECT * FROM models WHERE user_id = ? ORDER BY trained_at DESC",
    [userId]
  );
  return (rows as ModelRow[]).map(mapModel);
}

export async function getModelById(id: string, userId: string): Promise<Model | null> {
  const [rows] = await pool.query(
    "SELECT * FROM models WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  const row = (rows as ModelRow[])[0];
  return row ? mapModel(row) : null;
}

export async function createModel(model: Model, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO models (id, name, type, dataset_id, model_key, mae, rmse, mape, trained_at, is_active, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      model.id,
      model.name,
      model.type,
      model.datasetId,
      model.modelKey || null,
      model.mae ?? null,
      model.rmse ?? null,
      model.mape ?? null,
      new Date(model.trainedAt),
      userId,
    ]
  );
}

export async function setActiveModel(modelId: string, userId: string): Promise<void> {
  await pool.query("UPDATE models SET is_active = 0 WHERE user_id = ?", [userId]);
  await pool.query("UPDATE models SET is_active = 1 WHERE id = ? AND user_id = ?", [modelId, userId]);
}

export async function deleteModel(modelId: string, userId: string): Promise<void> {
  await pool.query("DELETE FROM models WHERE id = ? AND user_id = ?", [modelId, userId]);
}

export async function saveForecastRun(
  userId: string,
  datasetId: string,
  modelId: string,
  payload: ForecastResponse
): Promise<string> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    "INSERT INTO forecast_runs (id, user_id, dataset_id, model_id, payload_json) VALUES (?, ?, ?, ?, ?)",
    [runId, userId, datasetId, modelId, JSON.stringify(payload)]
  );
  return runId;
}

export async function getForecastRun(runId: string): Promise<ForecastResponse | null> {
  const [rows] = await pool.query("SELECT payload_json FROM forecast_runs WHERE id = ? LIMIT 1", [runId]);
  const row = (rows as { payload_json: string }[])[0];
  return row ? (JSON.parse(row.payload_json) as ForecastResponse) : null;
}

export async function getForecastRunForUser(
  userId: string,
  runId: string
): Promise<ForecastResponse | null> {
  const [rows] = await pool.query(
    "SELECT payload_json FROM forecast_runs WHERE id = ? AND user_id = ? LIMIT 1",
    [runId, userId]
  );
  const row = (rows as { payload_json: string }[])[0];
  return row ? (JSON.parse(row.payload_json) as ForecastResponse) : null;
}

export async function getLatestForecastRun(): Promise<{ id: string; payload: ForecastResponse } | null> {
  const [rows] = await pool.query(
    "SELECT id, payload_json FROM forecast_runs ORDER BY created_at DESC LIMIT 1"
  );
  const row = (rows as { id: string; payload_json: string }[])[0];
  return row ? { id: row.id, payload: JSON.parse(row.payload_json) as ForecastResponse } : null;
}

export async function saveScenarioRun(
  userId: string,
  baseRunId: string,
  payload: ScenarioResponse
): Promise<string> {
  const runId = `scn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    "INSERT INTO scenario_runs (id, user_id, base_run_id, payload_json) VALUES (?, ?, ?, ?)",
    [runId, userId, baseRunId, JSON.stringify(payload)]
  );
  return runId;
}

export async function getScenarioRun(runId: string): Promise<ScenarioResponse | null> {
  const [rows] = await pool.query("SELECT payload_json FROM scenario_runs WHERE id = ? LIMIT 1", [runId]);
  const row = (rows as { payload_json: string }[])[0];
  return row ? (JSON.parse(row.payload_json) as ScenarioResponse) : null;
}

export async function getScenarioRunForUser(
  userId: string,
  runId: string
): Promise<ScenarioResponse | null> {
  const [rows] = await pool.query(
    "SELECT payload_json FROM scenario_runs WHERE id = ? AND user_id = ? LIMIT 1",
    [runId, userId]
  );
  const row = (rows as { payload_json: string }[])[0];
  return row ? (JSON.parse(row.payload_json) as ScenarioResponse) : null;
}

export async function getLatestForecastRunForUser(
  userId: string
): Promise<{ id: string; payload: ForecastResponse } | null> {
  const [rows] = await pool.query(
    "SELECT id, payload_json FROM forecast_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const row = (rows as { id: string; payload_json: string }[])[0];
  return row ? { id: row.id, payload: JSON.parse(row.payload_json) as ForecastResponse } : null;
}

export async function getLatestScenarioRunForUser(
  userId: string
): Promise<{ id: string; payload: ScenarioResponse } | null> {
  const [rows] = await pool.query(
    "SELECT id, payload_json FROM scenario_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const row = (rows as { id: string; payload_json: string }[])[0];
  return row ? { id: row.id, payload: JSON.parse(row.payload_json) as ScenarioResponse } : null;
}

export type UserState = {
  activeDatasetId?: string | null;
  activeModelId?: string | null;
  latestForecastRunId?: string | null;
  latestScenarioRunId?: string | null;
};

export async function getUserState(userId: string): Promise<UserState> {
  const [rows] = await pool.query("SELECT state_json FROM user_state WHERE user_id = ? LIMIT 1", [userId]);
  const row = (rows as { state_json: string }[])[0];
  if (!row) return {};
  try {
    return (typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json) as UserState;
  } catch {
    return {};
  }
}

export async function setUserState(userId: string, patch: UserState): Promise<UserState> {
  const existing = await getUserState(userId);
  const next: UserState = { ...existing, ...patch };
  await pool.query(
    "INSERT INTO user_state (user_id, state_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)",
    [userId, JSON.stringify(next)]
  );
  return next;
}

export async function clearUserState(userId: string): Promise<void> {
  await pool.query("DELETE FROM user_state WHERE user_id = ?", [userId]);
}
