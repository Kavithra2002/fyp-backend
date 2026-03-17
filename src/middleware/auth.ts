import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const SECRET = process.env.JWT_SECRET || "fyp-dev-secret-change-in-production";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role?: string | null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, SECRET) as { userId: string };
    (req as Request & { user?: AuthUser }).user = {
      id: payload.userId,
      email: "",
      name: null,
      role: null,
    };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const baseUser = (req as Request & { user?: AuthUser }).user;
  if (!baseUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [rows] = await pool.query(
      "SELECT email, name, user_role FROM users WHERE id = ?",
      [baseUser.id]
    );
    const list = rows as { email: string; name: string | null; user_role?: string | null }[];
    const dbUser = list?.[0];
    if (!dbUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const role = (dbUser.user_role || "").toLowerCase();
    (req as Request & { user?: AuthUser }).user = {
      id: baseUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role,
    };

    if (role !== "admin") {
      res.status(403).json({ error: "Forbidden – admin only" });
      return;
    }

    next();
  } catch (e) {
    console.error("requireAdmin error:", e);
    res.status(500).json({ error: "Server error" });
  }
}
