import { Router } from "express";
import type { ExplainRequest, ExplainResponse } from "../types.js";

const router = Router();

// POST /explain
router.post("/", (req, res) => {
  const body = req.body as ExplainRequest;
  if (!body?.modelId) return res.status(400).json({ error: "modelId required" });

  // Mock: SHAP and attention. Replace with ML service call.
  const resp: ExplainResponse = {
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
  res.json(resp);
});

export default router;
