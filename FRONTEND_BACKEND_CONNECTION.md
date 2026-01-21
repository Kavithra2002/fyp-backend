# How the Backend Connects to the Frontend

## Part 1: How YOUR Current Connection Works

You use **3 pieces** that work together: the frontend API client, Next.js rewrites (proxy), and the backend server.

---

### 1. Frontend: Where the request starts

**File:** `frontend/src/services/api.ts`

```ts
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
```

- If `NEXT_PUBLIC_API_URL` is **not set** → `BASE = "/api"`.
- The frontend calls **same-origin** URLs like:
  - `http://localhost:3000/api/health`
  - `http://localhost:3000/api/data`
  - `http://localhost:3000/api/models`
  - etc.

So the **browser** thinks it is only talking to the frontend (localhost:3000). It does **not** directly call localhost:4000.

---

### 2. Next.js: The proxy (rewrites)

**File:** `frontend/next.config.ts`

```ts
async rewrites() {
  return [{ source: "/api/:path*", destination: "http://localhost:4000/:path*" }];
}
```

What this does:

| Browser requests           | Next.js rewrites to              |
|---------------------------|----------------------------------|
| `GET /api/health`         | `GET http://localhost:4000/health` |
| `GET /api/data`           | `GET http://localhost:4000/data`   |
| `POST /api/forecast`      | `POST http://localhost:4000/forecast` |
| `GET /api/models/abc`     | `GET http://localhost:4000/models/abc` |

- The **browser** only sees `https://yoursite.com/api/...` or `http://localhost:3000/api/...`.
- The **Next.js dev server** (or production server) forwards those to the backend on port 4000.
- This is a **server-side proxy**: the backend URL is never sent to the browser.

---

### 3. Backend: Receives the request

**File:** `backend/src/index.ts`

- Listens on **port 4000**: `http://localhost:4000`
- **CORS:** `cors({ origin: true })` — allows any origin. Needed when the frontend calls the backend **directly** (e.g. with `NEXT_PUBLIC_API_URL=http://localhost:4000`). When using the `/api` proxy, the browser only talks to the same origin (3000), so CORS is less critical, but it does not hurt.
- **Routes:** `/health`, `/data`, `/models`, `/forecast`, `/explain`, `/scenario`, `/export` (as in `api.ts`).

---

### End-to-end flow (your current setup)

```
┌─────────────┐      GET /api/health       ┌─────────────────┐      GET /health        ┌─────────────┐
│   Browser   │ ─────────────────────────► │  Next.js (3000) │ ──────────────────────► │  Backend    │
│ (localhost  │   (same origin: 3000)      │  rewrites       │   (server-to-server)  │ (4000)      │
│    :3000)   │                            │  /api/* → 4000  │                         │  Express    │
└─────────────┘ ◄───────────────────────── └─────────────────┘ ◄────────────────────── └─────────────┘
     JSON            { status: "ok" }              proxies                    { status: "ok" }
```

1. **Browser** → `fetch('/api/health')` → `http://localhost:3000/api/health`
2. **Next.js** → sees `/api/:path*`, forwards to `http://localhost:4000/health`
3. **Backend** → handles `GET /health`, returns `{ status: "ok", timestamp: "..." }`
4. **Next.js** → passes that response back to the browser
5. **Browser** → receives JSON; it never sees `localhost:4000`

---

### Summary of your setup

| Layer        | Role                                                                 |
|-------------|----------------------------------------------------------------------|
| **api.ts**  | Uses `BASE = "/api"`, builds `/api/health`, `/api/data`, etc.        |
| **Next.js** | Rewrites `/api/:path*` → `http://localhost:4000/:path*` (proxy)      |
| **Backend** | Listens on 4000, serves `/health`, `/data`, `/models`, etc., CORS on |

So: **frontend calls /api/…, Next.js proxies to the backend, backend responds.** That is how your backend is connected to the frontend.

---

## Part 2: Other Ways to Connect Backend to Frontend

### 1. Direct URL (no proxy) — **you can switch to this easily**

Frontend calls the backend **directly** from the browser.

**Setup:**

- In `frontend/.env.local`:
  ```
  NEXT_PUBLIC_API_URL=http://localhost:4000
  ```
- Your `api.ts` already uses:  
  `const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");`  
  So with this env, `BASE = "http://localhost:4000"` and calls go to:
  - `http://localhost:4000/health`
  - `http://localhost:4000/data`
  - etc.

**Flow:**
```
Browser (3000) ──────► Backend (4000)
                fetch("http://localhost:4000/health")
```

**Pros:** Simple, no proxy; backend URL is explicit.  
**Cons:** Backend must have CORS enabled (you do); in production you must point to the real API URL (e.g. `https://api.yourapp.com`).

---

### 2. Next.js Rewrites (proxy) — **what you use now**

Already described above: `/api/:path*` → `http://localhost:4000/:path*`.

**Pros:** Same-origin for the browser (avoids CORS in dev), can hide backend URL, can swap backend without changing frontend code (only `next.config`/env).  
**Cons:** Next.js must be running for the proxy to work; a bit more moving parts than direct URL.

---

### 3. Next.js API Routes (Backend-inside-Next.js)

Implement the “backend” as **Next.js API routes** in `app/api/` or `pages/api/`.

Example: `frontend/src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}
```

Then frontend calls `/api/health`; no separate Express server.

**Pros:** One app, one deploy; no CORS; simple for small backends.  
**Cons:** You’re moving logic from Express into Next.js; if you want to keep a separate Node/Express backend, this replaces it for those routes.

---

### 4. Next.js API Routes as a “BFF” (Backend-for-Frontend)

Next.js API routes **call your existing backend** and optionally reshape the response.

Example: `frontend/src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch("http://localhost:4000/health");
  const data = await res.json();
  return NextResponse.json(data);
}
```

Frontend still calls `/api/health`; the BFF talks to Express.

**Pros:** Backend stays separate; BFF can combine several backend calls, add auth, or change the response shape.  
**Cons:** Extra hop and more code than a simple rewrite.

---

### 5. Custom Next.js Server that mounts Express

Run the **Express app inside the Next.js server** (custom server).

Rough idea:

```ts
// server.js (custom server)
const express = require("express");
const next = require("next");
const backend = require("./backend-app"); // your Express app

const app = next({ dev: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();
  server.use("/api", backend);  // or mount at /api
  server.all("*", (req, res) => handle(req, res));
  server.listen(3000);
});
```

**Pros:** One process, one port (e.g. 3000); `/api` can be your full Express app.  
**Cons:** You lose some Next.js optimizations; deployment and debugging are more involved. Next.js docs generally recommend not using a custom server unless necessary.

---

### 6. Server Components / Server-side `fetch` (Next.js App Router)

In **Server Components**, you can `fetch` the backend from the **server**, so the browser never talks to the backend.

Example: `frontend/src/app/dashboard/page.tsx`:

```ts
async function Dashboard() {
  const res = await fetch("http://localhost:4000/data", { cache: "no-store" });
  const data = await res.json();
  return <div>{/* render data */}</div>;
}
```

- `fetch` runs on the **Next.js server** (or at build time, depending on caching).
- The backend URL can be `http://localhost:4000` or an internal URL in production (e.g. `http://backend:4000`).
- No CORS and no `NEXT_PUBLIC_*` needed for that URL, because the browser never sees it.

**Pros:** Backend can be internal only; good for SEO and some security cases.  
**Cons:** Only for Server Components / server-side code; for client-side interactivity you still need `api.ts` + proxy or direct URL.

---

### 7. Reverse proxy in front of both (production)

In production, a **reverse proxy** (e.g. Nginx, Caddy, or a PaaS) sits in front of both:

- `yourapp.com` → Next.js (e.g. 3000)
- `yourapp.com/api/*` → Backend (e.g. 4000)

So the browser still calls `https://yourapp.com/api/health`; the proxy sends `/api/*` to the backend. Conceptually the same as Next.js rewrites, but at the infrastructure layer.

**Pros:** Flexible; can add SSL, load balancing, rate limiting, etc.  
**Cons:** Requires server/DevOps setup.

---

## Comparison (short)

| Method                    | Who calls the backend?      | CORS needed? | Complexity | Your project        |
|---------------------------|----------------------------|--------------|------------|---------------------|
| **Next.js rewrites**      | Next.js server (proxy)     | No*          | Low        | ✅ **Current**      |
| **Direct URL**            | Browser                    | Yes          | Low        | Easy to switch      |
| **Next.js API Routes**    | Next.js (no Express)       | No           | Low        | Replaces Express    |
| **BFF (API route → Express)** | Next.js server          | No           | Medium     | Optional            |
| **Custom server**         | Next+Express in one process| No           | High       | Usually unnecessary |
| **Server Components fetch** | Next.js server only     | No           | Medium     | For server-only     |
| **Reverse proxy (Nginx)** | Proxy → backend            | No           | DevOps     | For production      |

\*With rewrites, the browser only talks to the same origin; CORS is not required for that, but your backend’s CORS stays useful if you ever use the direct URL (e.g. from another app or Postman).

---

## What to use when

- **Keep current (dev):** Next.js rewrites + `BASE = "/api"` — minimal config, works well.
- **Production:**  
  - Either keep rewrites and deploy Next.js so it can reach the backend (e.g. `http://backend:4000` in `next.config` or env),  
  - Or use `NEXT_PUBLIC_API_URL=https://api.yourapp.com` and direct URL, with CORS and HTTPS on the backend.
- **Fully merge backend into Next.js:** Use API Routes or BFF pattern and, over time, move Express logic there if you want a single service.

Your `api.ts` is already written to support both **proxy** (`/api`) and **direct** (`NEXT_PUBLIC_API_URL`); you only switch via environment variables.
