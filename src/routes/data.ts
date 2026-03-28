import fs from "node:fs";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { Dataset } from "../types.js";
import {
  createDataset,
  deleteDataset,
  getDatasetById,
  getUserState,
  listDatasets,
  setActiveDataset,
  setUserState,
} from "../services/appRepo.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads"),
  filename: (_req, file, cb) =>
    cb(null, `${uuidv4()}${path.extname(file.originalname) || ".csv"}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv") return cb(new Error("Only CSV files are allowed"));
    cb(null, true);
  },
}); // 50 MB
const idParamSchema = z.object({ id: z.string().uuid() });

// GET /data – list datasets
router.get("/", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const items = await listDatasets(userId);
  const state = await getUserState(userId);
  const mapped = items.map((d) => ({ ...d, isActive: d.id === state.activeDatasetId }));
  res.json(mapped);
});

// POST /data/upload – must be before /:id
router.post("/upload", (req: Request, res, next) => {
  const userId = (req as Request & { user?: { id: string } }).user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: String(err.message) });
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    let text: string;
    try {
      text = fs.readFileSync(file.path, "utf-8");
    } catch {
      return res.status(500).json({ error: "Failed to read uploaded file" });
    }
    const lines = text.split(/\r?\n/).filter((s: string) => s.trim());
    const columns = lines[0] ? lines[0].split(/[,;\t]/).map((s: string) => s.trim()) : [];
    const rows = Math.max(0, lines.length - 1);

    const id = uuidv4();
    const name = file.originalname || path.basename(file.filename) || "dataset.csv";
    const filePath = path.resolve(file.path);
    const d: Dataset = {
      id,
      name,
      rows,
      columns,
      uploadedAt: new Date().toISOString(),
      filePath,
    };
    try {
      await createDataset(d, userId);
      res.status(201).json(d);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
});

// GET /data/:id
router.get("/:id", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Invalid dataset id" });
  const d = await getDatasetById(parsed.data.id, userId);
  if (!d) return res.status(404).json({ error: "Dataset not found" });
  res.json(d);
});

// PUT /data/:id/active
router.put("/:id/active", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Invalid dataset id" });
  const d = await getDatasetById(parsed.data.id, userId);
  if (!d) return res.status(404).json({ error: "Dataset not found" });
  await setActiveDataset(parsed.data.id, userId);
  await setUserState(userId, { activeDatasetId: parsed.data.id });
  res.json({ ok: true });
});

// DELETE /data/:id – remove dataset row (and uploaded file if present)
router.delete("/:id", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Invalid dataset id" });

  const d = await getDatasetById(parsed.data.id, userId);
  if (!d) return res.status(404).json({ error: "Dataset not found" });

  try {
    await deleteDataset(parsed.data.id, userId);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  // Clear user-state if it pointed to deleted dataset
  const state = await getUserState(userId);
  if (state.activeDatasetId === parsed.data.id) {
    await setUserState(userId, { activeDatasetId: null });
  }

  // Best-effort delete uploaded file
  const fp = d.filePath;
  if (fp) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }

  res.json({ ok: true });
});

export default router;
