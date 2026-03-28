import "dotenv/config";
import { createApp } from "./app.js";
import { pool } from "./db.js";
import { ensureRuntimeSchema } from "./services/appRepo.js";

const app = createApp();
const PORT = Number(process.env.PORT) || 4000;

async function start() {
  try {
    await pool.query("SELECT 1");
    await ensureRuntimeSchema();
    console.log("Database successfully connected.");
  } catch (err) {
    console.error("Database connection failed:", (err as Error).message);
  }
  app.listen(PORT, () => {
    console.log(`FYP Forecast API running at http://localhost:${PORT}`);
  });
}

start();
