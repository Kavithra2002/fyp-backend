/**
 * File-backed runtime store.
 * Keeps existing in-memory access pattern but persists every mutation.
 */

import type { Dataset, Model } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.resolve(__dirname, "..", "data");
const statePath = path.join(stateDir, "app-state.json");

export const datasets: Map<string, Dataset> = new Map();
export const models: Map<string, Model> = new Map();
export const jobStore: Map<string, { status: "pending" | "done"; modelId?: string }> = new Map();

export let activeDatasetId: string | null = null;
export let activeModelId: string | null = null;

function persistState() {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        datasets: Array.from(datasets.values()),
        models: Array.from(models.values()),
        jobs: Array.from(jobStore.entries()),
        activeDatasetId,
        activeModelId,
      },
      null,
      2
    ),
    "utf-8"
  );
}

function loadState() {
  if (!fs.existsSync(statePath)) return;
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      datasets?: Dataset[];
      models?: Model[];
      jobs?: [string, { status: "pending" | "done"; modelId?: string }][];
      activeDatasetId?: string | null;
      activeModelId?: string | null;
    };
    for (const d of parsed.datasets || []) datasets.set(d.id, d);
    for (const m of parsed.models || []) models.set(m.id, m);
    for (const [jobId, job] of parsed.jobs || []) jobStore.set(jobId, job);
    activeDatasetId = parsed.activeDatasetId ?? null;
    activeModelId = parsed.activeModelId ?? null;
  } catch (err) {
    console.warn("Failed to load persisted store state:", (err as Error).message);
  }
}

loadState();

export function setActiveDataset(id: string | null) {
  activeDatasetId = id;
  for (const d of datasets.values()) {
    (d as Dataset).isActive = d.id === id;
  }
  persistState();
}

export function setActiveModel(id: string | null) {
  activeModelId = id;
  for (const m of models.values()) {
    (m as Model).isActive = m.id === id;
  }
  persistState();
}

export function upsertDataset(dataset: Dataset) {
  datasets.set(dataset.id, dataset);
  persistState();
}

export function upsertModel(model: Model) {
  models.set(model.id, model);
  persistState();
}
