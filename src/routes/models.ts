import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { Model, TrainRequest } from "../types.js";
import { isMlServiceConfigured } from "../services/mlService.js";
import {
  createModel,
  deleteModel,
  getDatasetById,
  getModelById,
  getUserState,
  listModels,
  setActiveModel,
  setUserState,
} from "../services/appRepo.js";

const router = Router();
const registerModelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["xgboost", "lstm", "ensemble"]),
  modelKey: z.string().trim().min(1).max(120),
  datasetId: z.string().uuid().optional(),
  mae: z.number().optional(),
  rmse: z.number().optional(),
  mape: z.number().optional(),
});
const trainSchema = z.object({
  datasetId: z.string().uuid(),
  type: z.enum(["xgboost", "lstm", "ensemble"]),
});

/** Request body for registering a Colab-trained model (downloaded into ml-service/models/<modelKey>/). */
export interface RegisterModelRequest {
  name: string;
  type: Model["type"];
  modelKey: string;
  datasetId?: string;
  mae?: number;
  rmse?: number;
  mape?: number;
}

// GET /models
router.get("/", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const items = await listModels(userId);
  const state = await getUserState(userId);
  const mapped = items.map((m) => ({ ...m, isActive: m.id === state.activeModelId }));
  res.json(mapped);
});

// POST /models/register – register a Colab-trained model (before /:id)
router.post("/register", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = registerModelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid register payload" });
  const body = parsed.data as RegisterModelRequest;
  if (body.datasetId) {
    const ds = await getDatasetById(body.datasetId, userId);
    if (!ds) return res.status(404).json({ error: "Dataset not found" });
  }
  const m: Model = {
    id: uuidv4(),
    name: body.name,
    type: body.type,
    datasetId: body.datasetId ?? "",
    modelKey: body.modelKey,
    mae: body.mae,
    rmse: body.rmse,
    mape: body.mape,
    trainedAt: new Date().toISOString(),
  };
  await createModel(m, userId);
  res.status(201).json(m);
});

// POST /models/train – before /:id
router.post("/train", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = trainSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid train payload" });
  const body = parsed.data as TrainRequest;
  const dataset = await getDatasetById(body.datasetId, userId);
  if (!dataset) {
    return res.status(404).json({ error: "Dataset not found" });
  }
  const jobId = uuidv4();

  // If ML service is configured, treat this as "attach existing trained model"
  // by setting modelKey = type (xgboost/lstm/ensemble) and pulling metrics from ML metadata.
  if (isMlServiceConfigured()) {
    try {
      const mlBase = process.env.ML_SERVICE_URL?.trim() || "";
      const metaRes = await fetch(`${mlBase}/models/${body.type}/metadata`, { method: "GET" });
      if (!metaRes.ok) {
        const err = await metaRes.json().catch(() => ({}));
        return res.status(400).json({
          error:
            (err as { error?: string }).error ||
            `ML metadata not available for modelKey=${body.type}. Ensure ml-service/models/${body.type}/metadata.json exists.`,
        });
      }
      const meta = (await metaRes.json()) as any;
      const perf = meta?.performance?.validation || meta?.metrics || {};

      const m: Model = {
        id: uuidv4(),
        name: `${body.type}-${Date.now()}`,
        type: body.type,
        datasetId: body.datasetId,
        modelKey: body.type,
        mae: typeof perf.mae === "number" ? perf.mae : undefined,
        rmse: typeof perf.rmse === "number" ? perf.rmse : undefined,
        mape: typeof perf.mape === "number" ? perf.mape : undefined,
        trainedAt: new Date().toISOString(),
      };
      await createModel(m, userId);
      // Make newly attached model active by default (matches user expectation)
      await setActiveModel(m.id, userId);
      await setUserState(userId, { activeModelId: m.id, activeDatasetId: body.datasetId });
      return res.status(201).json({ jobId, model: m });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  }

  // Otherwise: mock an immediate "done" model (legacy behavior)
  const m: Model = {
    id: uuidv4(),
    name: `${body.type}-${Date.now()}`,
    type: body.type,
    datasetId: body.datasetId,
    mae: 0.15,
    rmse: 0.22,
    mape: 12.5,
    trainedAt: new Date().toISOString(),
  };
  await createModel(m, userId);
  await setUserState(userId, { activeModelId: m.id, activeDatasetId: body.datasetId });
  await setActiveModel(m.id, userId);
  return res.status(201).json({ jobId, model: m });
});

// GET /models/job/:jobId – before /:id
router.get("/job/:jobId", (req, res) => {
  res.json({ status: "done", model: undefined });
});

// GET /models/:id
router.get("/:id", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const m = await getModelById(req.params.id, userId);
  if (!m) return res.status(404).json({ error: "Model not found" });
  res.json(m);
});

// PUT /models/:id/active
router.put("/:id/active", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const m = await getModelById(req.params.id, userId);
  if (!m) return res.status(404).json({ error: "Model not found" });
  await setActiveModel(req.params.id, userId);
  await setUserState(userId, { activeModelId: req.params.id, activeDatasetId: m.datasetId });
  res.json({ ok: true });
});

// DELETE /models/:id – remove model row
router.delete("/:id", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const m = await getModelById(req.params.id, userId);
  if (!m) return res.status(404).json({ error: "Model not found" });

  try {
    await deleteModel(req.params.id, userId);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  const state = await getUserState(userId);
  if (state.activeModelId === req.params.id) {
    await setUserState(userId, { activeModelId: null });
  }

  res.json({ ok: true });
});

export default router;
