import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { ensureTestSchema } from "../ensure-test-schema.js";

const app = createApp();

beforeAll(async () => {
  await ensureTestSchema();
});

describe("auth", () => {
  it("GET /auth/me returns 401 without cookie", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("POST /auth/register returns 201 and sets fyp_auth cookie", async () => {
    const email = `it_${Date.now()}@example.com`;
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password: "Passw0rd!", name: "IT User" })
      .expect(201);

    expect(res.body.user?.email).toBe(email);
    expect(res.headers["set-cookie"]).toBeDefined();
    const cookie = (res.headers["set-cookie"] as string[]).find((c) => c.startsWith("fyp_auth="));
    expect(cookie).toBeDefined();
  });

  it("GET /auth/me returns 200 with cookie after register", async () => {
    const email = `it_me_${Date.now()}@example.com`;
    const reg = await request(app)
      .post("/auth/register")
      .send({ email, password: "Passw0rd!", name: "Me User" });

    expect(reg.status).toBe(201);
    const cookieHeader = (reg.headers["set-cookie"] as string[]).join("; ");

    const me = await request(app).get("/auth/me").set("Cookie", cookieHeader);
    expect(me.status).toBe(200);
    expect(me.body.user?.email).toBe(email);
  });

  it("POST /auth/login works with valid credentials", async () => {
    const email = `it_login_${Date.now()}@example.com`;
    const password = "Passw0rd!";
    await request(app).post("/auth/register").send({ email, password }).expect(201);

    const login = await request(app).post("/auth/login").send({ email, password }).expect(200);
    expect(login.body.user?.email).toBe(email);
    expect(login.headers["set-cookie"]).toBeDefined();
  });
});
