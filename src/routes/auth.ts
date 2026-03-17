import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
const SECRET = process.env.JWT_SECRET || "fyp-dev-secret-change-in-production";

function signToken(userId: string) {
  return jwt.sign({ userId }, SECRET, { expiresIn: "7d" });
}

function dbStatusFromFlag(flag: number | null): "active" | "inactive" {
  return flag === 0 ? "inactive" : "active";
}

function dbStatusToFlag(status?: string | null): number {
  return (status || "").toLowerCase() === "inactive" ? 0 : 1;
}

/** Returns next user id as last numeric id + 1 (e.g. 21 if last is 20). Stored as string for VARCHAR id column. */
async function getNextUserId(): Promise<string> {
  const [rows] = await pool.query("SELECT id FROM users");
  const list = (rows as { id: string }[]) || [];
  const numericIds = list
    .filter((r) => /^\d+$/.test(String(r.id)))
    .map((r) => parseInt(String(r.id), 10));
  const next = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
  return String(next);
}

// POST /auth/register
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  const em = (email || "").trim().toLowerCase();
  const pw = typeof password === "string" ? password : "";

  if (!em || !pw) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (pw.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = ?", [em]);
    const existing = rows as { id: string }[];
    if (existing?.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }

    const id = await getNextUserId();
    const passwordHash = await bcrypt.hash(pw, 10);
    const trimmedName = name ? String(name).trim() || null : null;
    await pool.query(
      "INSERT INTO users (id, email, password_hash, password_plain, name, user_role, user_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, em, passwordHash, pw, trimmedName, "user", "active"]
    );

    const token = signToken(id);
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
router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const em = (email || "").trim().toLowerCase();
  const pw = typeof password === "string" ? password : "";

  if (!em || !pw) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

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
  const {
    email,
    password,
    name,
    role,
    status,
  } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
    status?: string;
  };

  const em = (email || "").trim().toLowerCase();
  const pw = typeof password === "string" ? password : "";
  const trimmedName = name ? String(name).trim() || null : null;
  const normalizedRole = (role || "user").toLowerCase() === "admin" ? "admin" : "user";
  const normalizedStatusFlag = dbStatusToFlag(status || "active");

  if (!em || !pw) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (pw.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

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
  const {
    email,
    password,
    name,
    role,
    status,
  } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
    status?: string;
  };

  if (!id) {
    res.status(400).json({ error: "User id required" });
    return;
  }

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
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
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
