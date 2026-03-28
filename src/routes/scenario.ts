import { Router } from "express";
import type { ScenarioRequest, ScenarioResponse } from "../types.js";
import {
  getForecastRunForUser,
  getLatestForecastRunForUser,
  getUserState,
  saveScenarioRun,
  setUserState,
} from "../services/appRepo.js";
import { z } from "zod";

const router = Router();
const scenarioSchema = z.object({
  // Accept missing/placeholder baseRunId and resolve to latest run.
  baseRunId: z.string().trim().optional().default("latest"),
  overrides: z.record(z.string(), z.number()),
});

// POST /scenario
router.post("/", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = scenarioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "baseRunId and overrides required" });
  const body = parsed.data as ScenarioRequest;

  const state = await getUserState(userId);
  const latest = await getLatestForecastRunForUser(userId);
  const normalizedBaseRunId =
    !body.baseRunId || body.baseRunId === "demo"
      ? state.latestForecastRunId || "latest"
      : body.baseRunId;
  const base =
    normalizedBaseRunId === "latest" || normalizedBaseRunId === state.latestForecastRunId
      ? latest?.payload || null
      : await getForecastRunForUser(userId, normalizedBaseRunId);
  if (!base) {
    return res.status(404).json({ error: "Base forecast run not found. Run forecast first." });
  }
  const baseForecast = base.forecast;
  const scale = 1 + (body.overrides["price"] ?? 0) * 0.1 + (body.overrides["volume"] ?? 0) * 0.05;
  const scenarioForecast = baseForecast.map((v) => Math.round(v * scale * 100) / 100);
  const baseSummary =
    baseForecast.length > 0 ? baseForecast.reduce((a, b) => a + b, 0) / baseForecast.length : 0;
  const scenarioSummary =
    scenarioForecast.length > 0
      ? scenarioForecast.reduce((a, b) => a + b, 0) / scenarioForecast.length
      : 0;

  const resp: ScenarioResponse = {
    base: { name: "Base", forecast: baseForecast, summary: Number(baseSummary.toFixed(2)) },
    scenario: { name: "What-if", forecast: scenarioForecast, summary: Number(scenarioSummary.toFixed(2)) },
    baseRunId: normalizedBaseRunId === "latest" ? (latest?.id ?? "latest") : normalizedBaseRunId,
  };
  const scenarioRunId = await saveScenarioRun(
    userId,
    normalizedBaseRunId === "latest" ? (latest?.id ?? "latest") : normalizedBaseRunId,
    resp
  );
  await setUserState(userId, { latestScenarioRunId: scenarioRunId });
  res.json({ ...resp, scenarioRunId });
});

export default router;
