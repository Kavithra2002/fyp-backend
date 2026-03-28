import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import modelsRoutes from "./routes/models.js";
import forecastRoutes from "./routes/forecast.js";
import explainRoutes from "./routes/explain.js";
import scenarioRoutes from "./routes/scenario.js";
import exportRoutes from "./routes/export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Application {
  const app = express();

  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error("CORS origin denied"));
      },
      credentials: true,
    })
  );
  app.use(helmet());
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  const uploadsDir = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use("/auth", authRoutes);
  app.use("/data", requireAuth, dataRoutes);
  app.use("/models", requireAuth, modelsRoutes);
  app.use("/forecast", requireAuth, forecastRoutes);
  app.use("/explain", requireAuth, explainRoutes);
  app.use("/scenario", requireAuth, scenarioRoutes);
  app.use("/export", requireAuth, exportRoutes);

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

  return app;
}
