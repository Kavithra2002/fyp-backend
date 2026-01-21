/**
 * In-memory store for development. Replace with DB (e.g. Prisma) later.
 */

import type { Dataset, Model } from "./types.js";

export const datasets: Map<string, Dataset> = new Map();
export const models: Map<string, Model> = new Map();

export let activeDatasetId: string | null = null;
export let activeModelId: string | null = null;

export function setActiveDataset(id: string | null) {
  activeDatasetId = id;
  for (const d of datasets.values()) {
    (d as Dataset).isActive = d.id === id;
  }
}

export function setActiveModel(id: string | null) {
  activeModelId = id;
  for (const m of models.values()) {
    (m as Model).isActive = m.id === id;
  }
}
