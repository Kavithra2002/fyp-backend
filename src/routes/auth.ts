import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const SECRET = process.env.JWT_SECRET || "fyp-dev-secret-change-in-production";

function signToken(userId: string) {
  return jwt.sign({ userId }, SECRET, { expiresIn: "7d" });
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

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(pw, 10);
    await pool.query(
      "INSERT INTO users (id, email, password_hash, password_plain, name) VALUES (?, ?, ?, ?, ?)",
      [id, em, passwordHash, pw, name ? String(name).trim() || null : null]
    );

    const token = signToken(id);
    res.status(201).json({
      user: { id, email: em, name: name ? String(name).trim() || null : null },
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
      "SELECT id, email, name, password_hash FROM users WHERE email = ?",
      [em]
    );
    const list = rows as { id: string; email: string; name: string | null; password_hash: string }[];
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
      user: { id: user.id, email: user.email, name: user.name },
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
    const [rows] = await pool.query("SELECT id, email, name FROM users WHERE id = ?", [userId]);
    const list = rows as { id: string; email: string; name: string | null }[];
    const user = list?.[0];
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    console.error("Auth me error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
