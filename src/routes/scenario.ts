import { Router } from "express";
import type { ScenarioRequest, ScenarioResponse } from "../types.js";

const router = Router();

// POST /scenario
router.post("/", (req, res) => {
  const body = req.body as ScenarioRequest;
  if (!body?.baseRunId || !body?.overrides || typeof body.overrides !== "object") {
    return res.status(400).json({ error: "baseRunId and overrides required" });
  }

  // Mock: base vs scenario. Replace with ML service call.
  const n = 14;
  const baseForecast = Array.from({ length: n }, (_, i) => 100 + Math.sin(i * 0.4) * 15);
  const scale = 1 + (body.overrides["price"] ?? 0.5) * 0.1 + (body.overrides["volume"] ?? 0.5) * 0.05;
  const scenarioForecast = baseForecast.map((v) => Math.round(v * scale * 100) / 100);

  const resp: ScenarioResponse = {
    base: { name: "Base", forecast: baseForecast, summary: 102.3 },
    scenario: { name: "What-if", forecast: scenarioForecast, summary: 108.7 },
  };
  res.json(resp);
});

export default router;
