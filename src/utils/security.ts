import type { Request, Response } from "express";

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is required. Set it in environment variables.");
  }
  if (secret.length < 24) {
    throw new Error("JWT_SECRET is too short. Use at least 24 characters.");
  }
  return secret;
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

export function getTokenFromRequest(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookies = parseCookies(req);
  return cookies["fyp_auth"] || null;
}

export function setAuthCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  res.cookie("fyp_auth", token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: ONE_WEEK_SECONDS * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production";
  res.clearCookie("fyp_auth", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });
}
