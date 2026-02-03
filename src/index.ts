import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import modelsRoutes from "./routes/models.js";
import forecastRoutes from "./routes/forecast.js";
import explainRoutes from "./routes/explain.js";
import scenarioRoutes from "./routes/scenario.js";
import exportRoutes from "./routes/export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors({ origin: true }));
app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Ensure uploads dir exists (multer needs it)
const uploadsDir = path.join(__dirname, "..", "uploads");
import fs from "node:fs";
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Public routes
app.use("/auth", authRoutes);

// Protected routes (require valid JWT)
app.use("/data", requireAuth, dataRoutes);
app.use("/models", requireAuth, modelsRoutes);
app.use("/forecast", requireAuth, forecastRoutes);
app.use("/explain", requireAuth, explainRoutes);
app.use("/scenario", requireAuth, scenarioRoutes);
app.use("/export", requireAuth, exportRoutes);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.json({
    name: "FYP Forecast & XAI API",
    version: "0.1.0",
    auth: ["/auth/register", "/auth/login", "/auth/me"],
    routes: ["/data", "/models", "/forecast", "/explain", "/scenario", "/export"],
    health: "/health",
  });
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("Database successfully connected.");
  } catch (err) {
    console.error("Database connection failed:", (err as Error).message);
  }
  app.listen(PORT, () => {
    console.log(`FYP Forecast API running at http://localhost:${PORT}`);
  });
}

start();
