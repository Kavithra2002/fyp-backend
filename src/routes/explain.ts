import { Router } from "express";
import { isMlServiceConfigured, mlExplain } from "../services/mlService.js";
import type { ExplainRequest, ExplainResponse } from "../types.js";
import { z } from "zod";
import { getDatasetById, getModelById } from "../services/appRepo.js";

const router = Router();
const explainSchema = z.object({
  modelId: z.string().uuid(),
  runId: z.string().trim().min(1).max(120).optional(),
});

// POST /explain
router.post("/", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = explainSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid explain payload" });
  const body = parsed.data as ExplainRequest;

  const model = await getModelById(body.modelId, userId);
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
    const dataset = model.datasetId ? await getDatasetById(model.datasetId, userId) : null;
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
