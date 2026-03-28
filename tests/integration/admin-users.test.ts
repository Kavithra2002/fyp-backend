import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db.js";
import { ensureTestSchema } from "../ensure-test-schema.js";

const app = createApp();

beforeAll(async () => {
  await ensureTestSchema();
});

describe("admin user management", () => {
  it("GET /auth/users returns 200 for admin", async () => {
    const email = `admin_${Date.now()}@example.com`;
    const password = "Passw0rd!";
    const hash = await bcrypt.hash(password, 10);
    const id = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash, password_plain, name, user_role, user_status)
       VALUES (?, ?, ?, ?, ?, 'admin', 1)`,
      [id, email, hash, password, "Admin IT"]
    );

    const login = await request(app).post("/auth/login").send({ email, password }).expect(200);
    const cookie = (login.headers["set-cookie"] as string[]).join("; ");

    const list = await request(app).get("/auth/users").set("Cookie", cookie).expect(200);
    expect(Array.isArray(list.body.users)).toBe(true);
    expect(list.body.users.some((u: { email: string }) => u.email === email)).toBe(true);
  });
});
