import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.js";
import { ensureTestSchema } from "../ensure-test-schema.js";

const app = createApp();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeAll(async () => {
  await ensureTestSchema();
});

async function registerAndCookie(): Promise<string> {
  const email = `flow_${Date.now()}@example.com`;
  const reg = await request(app)
    .post("/auth/register")
    .send({ email, password: "Passw0rd!", name: "Flow" })
    .expect(201);
  return (reg.headers["set-cookie"] as string[]).join("; ");
}

describe("data + models + forecast + explain", () => {
  it("uploads CSV, trains mock model, runs forecast, returns runId", async () => {
    const cookie = await registerAndCookie();

    const csvPath = path.join(__dirname, "fixtures", "sample.csv");
    const upload = await request(app)
      .post("/data/upload")
      .set("Cookie", cookie)
      .attach("file", csvPath, "sample.csv");

    expect(upload.status).toBe(201);
    const datasetId = upload.body.id as string;
    expect(datasetId).toBeTruthy();

    await request(app).put(`/data/${datasetId}/active`).set("Cookie", cookie).expect(200);

    const train = await request(app)
      .post("/models/train")
      .set("Cookie", cookie)
      .send({ datasetId, type: "xgboost" })
      .expect(201);

    const modelId = train.body.model?.id as string;
    expect(modelId).toBeTruthy();

    const fc = await request(app)
      .post("/forecast")
      .set("Cookie", cookie)
      .send({ datasetId, modelId, horizon: 7 })
      .expect(200);

    expect(fc.body.forecast?.length).toBe(7);
    expect(fc.body.runId).toBeTruthy();
  });

  it("POST /explain returns 503 when ML service not configured", async () => {
    const cookie = await registerAndCookie();

    const csvPath = path.join(__dirname, "fixtures", "sample.csv");
    const upload = await request(app).post("/data/upload").set("Cookie", cookie).attach("file", csvPath, "sample.csv");
    expect(upload.status).toBe(201);
    const datasetId = upload.body.id;

    const train = await request(app)
      .post("/models/train")
      .set("Cookie", cookie)
      .send({ datasetId, type: "xgboost" })
      .expect(201);
    const modelId = train.body.model.id;

    const ex = await request(app).post("/explain").set("Cookie", cookie).send({ modelId });
    expect(ex.status).toBe(503);
    expect(ex.body.error).toMatch(/Explainability|ML/i);
  });
});
