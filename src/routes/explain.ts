import { Router } from "express";
import { activeDatasetId, datasets, models } from "../store.js";
import { isMlServiceConfigured, mlExplain } from "../services/mlService.js";
import type { ExplainRequest, ExplainResponse } from "../types.js";

const router = Router();

// POST /explain
router.post("/", async (req, res) => {
  const body = req.body as ExplainRequest;
  if (!body?.modelId) return res.status(400).json({ error: "modelId required" });

  const model = models.get(body.modelId);
  if (!model) return res.status(404).json({ error: "Model not found" });

  if (!isMlServiceConfigured()) {
    return res.status(503).json({
      error: "Explainability service is not connected yet. Please start the ML service and try again.",
    });
  }

  if (!model.modelKey) {
    return res.status(400).json({
      error: "Selected model is not connected yet. Please train/register a model and try again.",
    });
  }

  try {
    const dataset = (model.datasetId && datasets.get(model.datasetId)) || (activeDatasetId && datasets.get(activeDatasetId)) || null;
    const ml = await mlExplain(model.modelKey, body.runId, dataset?.filePath ?? undefined);
    return res.json({
      shap: ml.shap,
      attention: ml.attention,
    } satisfies ExplainResponse);
  } catch (err) {
    console.error("ML explain error:", (err as Error).message);
    return res.status(502).json({
      error: "Failed to generate explanation from ML service",
      detail: (err as Error).message,
    });
  }
});

export default router;
