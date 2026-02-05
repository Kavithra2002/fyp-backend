import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { datasets, models, setActiveModel, activeModelId } from "../store.js";
import type { Model, TrainRequest } from "../types.js";

const router = Router();

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
router.get("/", (_req, res) => {
  res.json(
    Array.from(models.values()).map((m) => ({ ...m, isActive: m.id === activeModelId }))
  );
});

// POST /models/register – register a Colab-trained model (before /:id)
router.post("/register", (req, res) => {
  const body = req.body as RegisterModelRequest;
  if (!body?.name || !body?.type || !body?.modelKey) {
    return res.status(400).json({ error: "name, type, and modelKey required" });
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
  models.set(m.id, m);
  res.status(201).json(m);
});

// POST /models/train – before /:id
router.post("/train", (req, res) => {
  const body = req.body as TrainRequest;
  if (!body?.datasetId || !body?.type) {
    return res.status(400).json({ error: "datasetId and type required" });
  }
  if (!datasets.has(body.datasetId)) {
    return res.status(404).json({ error: "Dataset not found" });
  }
  const jobId = uuidv4();
  // For now: mock an immediate "done" model. Later: enqueue job, ML service trains.
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
  models.set(m.id, m);
  res.status(201).json({ jobId, model: m });
});

// GET /models/job/:jobId – before /:id
router.get("/job/:jobId", (req, res) => {
  const model = Array.from(models.values()).at(-1);
  res.json({ status: model ? "done" : "pending", model: model ?? undefined });
});

// GET /models/:id
router.get("/:id", (req, res) => {
  const m = models.get(req.params.id);
  if (!m) return res.status(404).json({ error: "Model not found" });
  res.json({ ...m, isActive: m.id === activeModelId });
});

// PUT /models/:id/active
router.put("/:id/active", (req, res) => {
  if (!models.has(req.params.id)) return res.status(404).json({ error: "Model not found" });
  setActiveModel(req.params.id);
  res.json({ ok: true });
});

export default router;
