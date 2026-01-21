import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "fyp-dev-secret-change-in-production";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
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
    };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
