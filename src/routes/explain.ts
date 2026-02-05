import { Router } from "express";
import { models } from "../store.js";
import { isMlServiceConfigured, mlExplain } from "../services/mlService.js";
import type { ExplainRequest, ExplainResponse } from "../types.js";

const router = Router();

const MOCK_EXPLAIN: ExplainResponse = {
  shap: [
    { feature: "price", importance: 0.32 },
    { feature: "promotion", importance: 0.28 },
    { feature: "seasonality", importance: 0.18 },
    { feature: "lag_7", importance: 0.12 },
    { feature: "lag_14", importance: 0.06 },
  ],
  attention: [
    { step: 0, weight: 0.05 },
    { step: 1, weight: 0.08 },
    { step: 2, weight: 0.12 },
    { step: 3, weight: 0.15 },
    { step: 4, weight: 0.2 },
    { step: 5, weight: 0.22 },
    { step: 6, weight: 0.18 },
  ],
};

// POST /explain
router.post("/", async (req, res) => {
  const body = req.body as ExplainRequest;
  if (!body?.modelId) return res.status(400).json({ error: "modelId required" });

  const model = models.get(body.modelId);

  if (isMlServiceConfigured() && model?.modelKey) {
    try {
      const ml = await mlExplain(model.modelKey, body.runId);
      return res.json({
        shap: ml.shap,
        attention: ml.attention,
      } satisfies ExplainResponse);
    } catch (err) {
      console.error("ML explain error:", (err as Error).message);
    }
  }

  res.json(MOCK_EXPLAIN);
});

export default router;
