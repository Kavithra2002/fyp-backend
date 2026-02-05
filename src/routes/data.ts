import fs from "node:fs";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { datasets, setActiveDataset, activeDatasetId } from "../store.js";
import type { Dataset } from "../types.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads"),
  filename: (_req, file, cb) =>
    cb(null, `${uuidv4()}${path.extname(file.originalname) || ".csv"}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

// GET /data – list datasets
router.get("/", (_req, res) => {
  res.json(
    Array.from(datasets.values()).map((d) => ({ ...d, isActive: d.id === activeDatasetId }))
  );
});

// POST /data/upload – must be before /:id
router.post("/upload", (req: Request, res, next) => {
  upload.single("file")(req, res, (err) => {
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
    datasets.set(id, d);
    res.status(201).json(d);
  });
});

// GET /data/:id
router.get("/:id", (req, res) => {
  const d = datasets.get(req.params.id);
  if (!d) return res.status(404).json({ error: "Dataset not found" });
  res.json({ ...d, isActive: d.id === activeDatasetId });
});

// PUT /data/:id/active
router.put("/:id/active", (req, res) => {
  if (!datasets.has(req.params.id)) return res.status(404).json({ error: "Dataset not found" });
  setActiveDataset(req.params.id);
  res.json({ ok: true });
});

export default router;
