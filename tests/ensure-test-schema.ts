import { pool } from "../src/db.js";
import { ensureRuntimeSchema } from "../src/services/appRepo.js";

/**
 * Minimal schema for integration tests (matches runtime app expectations).
 */
export async function ensureTestSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      password_plain VARCHAR(255) NULL,
      name VARCHAR(255) NULL,
      user_role VARCHAR(32) NOT NULL DEFAULT 'user',
      user_status TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS datasets (
      id CHAR(36) NOT NULL,
      user_id VARCHAR(36) NULL,
      name VARCHAR(255) NOT NULL,
      rows_count INT NOT NULL,
      columns_json LONGTEXT NOT NULL,
      uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      file_path TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS models (
      id CHAR(36) NOT NULL,
      user_id VARCHAR(36) NULL,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(32) NOT NULL,
      dataset_id CHAR(36) NOT NULL,
      model_key VARCHAR(120) NULL,
      mae DOUBLE NULL,
      rmse DOUBLE NULL,
      mape DOUBLE NULL,
      trained_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forecast_runs (
      id VARCHAR(64) NOT NULL,
      user_id VARCHAR(36) NULL,
      dataset_id CHAR(36) NOT NULL,
      model_id CHAR(36) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scenario_runs (
      id VARCHAR(64) NOT NULL,
      user_id VARCHAR(36) NULL,
      base_run_id VARCHAR(64) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_id VARCHAR(36) PRIMARY KEY,
      state_json JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await ensureRuntimeSchema();
}
