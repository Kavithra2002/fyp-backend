import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import {
  clearAuthCookie,
  getJwtSecret,
  setAuthCookie,
} from "../utils/security.js";
import {
  createUserSchema,
  loginSchema,
  registerSchema,
  updateUserSchema,
} from "../utils/validation.js";

const router = Router();
const SECRET = getJwtSecret();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function signToken(userId: string) {
  return jwt.sign({ userId }, SECRET, { expiresIn: "7d" });
}

function dbStatusFromFlag(flag: number | null): "active" | "inactive" {
  return flag === 0 ? "inactive" : "active";
}

function dbStatusToFlag(status?: string | null): number {
  return (status || "").toLowerCase() === "inactive" ? 0 : 1;
}

/** Next id = max(existing numeric ids) + 1. Non-numeric ids (e.g. old UUIDs) are ignored. */
async function getNextUserId(): Promise<string> {
  const [rows] = await pool.query("SELECT id FROM users");
  const list = (rows as { id: string }[]) || [];
  const numericIds = list
    .filter((r) => /^\d+$/.test(String(r.id)))
    .map((r) => parseInt(String(r.id), 10));
  const next = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
  return String(next);
}

// POST /auth/register — in production, disabled unless ALLOW_PUBLIC_REGISTRATION=true.
router.post("/register", authLimiter, async (req, res) => {
  const allowPublicRegistration =
    process.env.ALLOW_PUBLIC_REGISTRATION === "true" || process.env.NODE_ENV === "test";
  if (!allowPublicRegistration) {
    res.status(403).json({
      error: "Public registration is disabled. An administrator must create your account from the Users page.",
    });
    return;
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    return;
  }
  const em = parsed.data.email;
  const pw = parsed.data.password;
  const trimmedName = parsed.data.name ? String(parsed.data.name).trim() || null : null;

  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = ?", [em]);
    const existing = rows as { id: string }[];
    if (existing?.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }

    const id = await getNextUserId();
    const passwordHash = await bcrypt.hash(pw, 10);
    await pool.query(
      "INSERT INTO users (id, email, password_hash, password_plain, name, user_role, user_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, em, passwordHash, pw, trimmedName, "user", dbStatusToFlag("active")]
    );

    const token = signToken(id);
    setAuthCookie(res, token);
    res.status(201).json({
      user: { id, email: em, name: trimmedName, role: "user", status: "active" },
      token,
    });
  } catch (e) {
    console.error("Register error:", e);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /auth/login
router.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    return;
  }
  const em = parsed.data.email;
  const pw = parsed.data.password;

  try {
    const [rows] = await pool.query(
      "SELECT id, email, name, password_hash, user_role, user_status FROM users WHERE email = ?",
      [em]
    );
    const list = rows as {
      id: string;
      email: string;
      name: string | null;
      password_hash: string;
      user_role?: string | null;
      user_status?: number | null;
    }[];
    const user = list?.[0];
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const ok = await bcrypt.compare(pw, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signToken(user.id);
    setAuthCookie(res, token);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.user_role || "user",
        status: dbStatusFromFlag(user.user_status ?? 1),
      },
      token,
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/logout", requireAuth, async (_req, res) => {
  // Do not clear user_state: datasets/models/selections stay tied to the account in the DB
  // so the same user sees their workspace again after the next login.
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /auth/me – requires valid JWT
router.get("/me", requireAuth, async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const [rows] = await pool.query(
      "SELECT id, email, name, user_role, user_status FROM users WHERE id = ?",
      [userId]
    );
    const list = rows as {
      id: string;
      email: string;
      name: string | null;
      user_role?: string | null;
      user_status?: number | null;
    }[];
    const user = list?.[0];
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.user_role || "user",
        status: dbStatusFromFlag(user.user_status ?? 1),
      },
    });
  } catch (e) {
    console.error("Auth me error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin-only user management APIs

// GET /auth/users – list all users (admin only)
router.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, email, name, user_role, user_status, created_at, updated_at FROM users ORDER BY created_at DESC"
    );
    const list = rows as {
      id: string;
      email: string;
      name: string | null;
      user_role?: string | null;
      user_status?: number | null;
      created_at: Date;
      updated_at: Date;
    }[];
    res.json({
      users: list.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.user_role || "user",
        status: dbStatusFromFlag(u.user_status ?? 1),
        createdAt: u.created_at,
        updatedAt: u.updated_at,
      })),
    });
  } catch (e) {
    console.error("List users error:", e);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// POST /auth/users – create user (admin only)
router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    return;
  }
  const em = parsed.data.email;
  const pw = parsed.data.password;
  const trimmedName = parsed.data.name ? String(parsed.data.name).trim() || null : null;
  const normalizedRole = parsed.data.role === "admin" ? "admin" : "user";
  const normalizedStatusFlag = dbStatusToFlag(parsed.data.status || "active");

  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = ?", [em]);
    const existing = rows as { id: string }[];
    if (existing?.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }

    const id = await getNextUserId();
    const passwordHash = await bcrypt.hash(pw, 10);
    await pool.query(
      "INSERT INTO users (id, email, password_hash, password_plain, name, user_role, user_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, em, passwordHash, pw, trimmedName, normalizedRole, normalizedStatusFlag]
    );

    res.status(201).json({
      user: {
        id,
        email: em,
        name: trimmedName,
        role: normalizedRole,
        status: dbStatusFromFlag(normalizedStatusFlag),
      },
    });
  } catch (e) {
    console.error("Admin create user error:", e);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// PATCH /auth/users/:id – update user (admin only)
router.patch("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "User id required" });
    return;
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    return;
  }
  const { email, password, name, role, status } = parsed.data;

  const fields: string[] = [];
  const params: any[] = [];

  if (email) {
    fields.push("email = ?");
    params.push(email.trim().toLowerCase());
  }

  if (typeof name === "string") {
    const trimmedName = name.trim() || null;
    fields.push("name = ?");
    params.push(trimmedName);
  }

  if (role) {
    const normalizedRole = role.toLowerCase() === "admin" ? "admin" : "user";
    fields.push("user_role = ?");
    params.push(normalizedRole);
  }

  if (status) {
    const flag = dbStatusToFlag(status);
    fields.push("user_status = ?");
    params.push(flag);
  }

  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    fields.push("password_hash = ?", "password_plain = ?");
    params.push(passwordHash, password);
  }

  if (fields.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  params.push(id);

  try {
    await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (e) {
    console.error("Admin update user error:", e);
    res.status(500).json({ error: "Failed to update user" });
  }
});

export default router;
