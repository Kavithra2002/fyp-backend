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

  const isProd = process.env.NODE_ENV === "production";

  function isLocalDevOrigin(origin: string): boolean {
    try {
      const { hostname } = new URL(origin);
      return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]"
      );
    } catch {
      return false;
    }
  }

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        if (!isProd && isLocalDevOrigin(origin)) return cb(null, true);
        if (!isProd && origin) {
          console.warn(
            `[CORS] Denied origin: ${origin}. Set CORS_ORIGINS in .env (comma-separated) or use http://localhost / 127.0.0.1. NODE_ENV=${process.env.NODE_ENV ?? "unset"}`
          );
        }
        return cb(new Error("CORS origin denied"));
      },
      credentials: true,
    })
  );
  app.use(helmet());
  app.use(express.json());

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProd ? 300 : 10000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  const uploadsDir = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use("/auth", authRoutes);
  app.use("/data", requireAuth, apiLimiter, dataRoutes);
  app.use("/models", requireAuth, apiLimiter, modelsRoutes);
  app.use("/forecast", requireAuth, apiLimiter, forecastRoutes);
  app.use("/explain", requireAuth, apiLimiter, explainRoutes);
  app.use("/scenario", requireAuth, apiLimiter, scenarioRoutes);
  app.use("/export", requireAuth, apiLimiter, exportRoutes);

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
