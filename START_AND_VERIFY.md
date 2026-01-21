# Start Backend + Frontend & Verify Connection

## Step 1: Install dependencies (first time only)

**Backend** (in `E:\FYP\backend`):
```powershell
cd E:\FYP\backend
npm install
```

**Frontend** (in `E:\FYP\frontend`):
```powershell
cd E:\FYP\frontend
npm install
```

---

## Step 2: Start the backend (Cursor window 1)

In **Cursor window 1**:
```powershell
cd E:\FYP\backend
npm run dev
```

**Expected output:**
```
FYP Forecast API running at http://localhost:4000
```

Leave this terminal running. The backend runs on **port 4000**.

---

## Step 3: Start the frontend (Cursor window 2)

In **Cursor window 2**:
```powershell
cd E:\FYP\frontend
npm run dev
```

**Expected output:**
```
▲ Next.js 16.x.x
- Local:        http://localhost:3000
```

Leave this terminal running. The frontend runs on **port 3000**.

---

## Step 4: How they connect

- Frontend calls `/api/...` (e.g. `/api/health`, `/api/data`).
- Next.js rewrites `/api/:path*` → `http://localhost:4000/:path*`.
- So `/api/health` becomes `http://localhost:4000/health` on the backend.

No `.env` is required; the proxy in `next.config.ts` handles it.

---

## Step 5: Verify the connection

### A) Backend only (backend must be running)

In a **new** PowerShell:
```powershell
cd E:\FYP\backend
node test-connection.js
```

You should see `✅` for Health check, API info, List datasets, List models.

**Or** in a browser: open **http://localhost:4000/health**  
→ You should see: `{"status":"ok","timestamp":"..."}`

---

### B) Through the frontend (both must be running)

1. Open **http://localhost:3000** in your browser.
2. Press **F12** → **Console** tab.
3. Run:
   ```javascript
   fetch('/api/health').then(r=>r.json()).then(console.log).catch(console.error);
   ```
4. **Expected:** `{status: "ok", timestamp: "..."}`

**Or** use the **Network** tab:
- Go to **http://localhost:3000/dashboard**
- In DevTools → **Network**, filter by **Fetch/XHR**
- You should see requests to `/api/data`, `/api/models` with status **200**

---

## Step 6: Quick checklist

| Check | Command/Action | Expected |
|-------|----------------|----------|
| Backend running | `http://localhost:4000/health` in browser | `{"status":"ok",...}` |
| Frontend running | `http://localhost:3000` in browser | Login or app page |
| Backend script | `node test-connection.js` in `backend/` | All ✅ |
| Frontend → Backend | `fetch('/api/health')` in browser console on :3000 | `{status:"ok"}` |

---

## Troubleshooting

- **Backend "Cannot GET /"** or nothing on :4000 → run `npm run dev` in `E:\FYP\backend`.
- **Frontend /api/… 404 or 502** → backend not running or not on 4000; start `npm run dev` in backend.
- **CORS errors** → Backend has `cors({ origin: true })`; if it persists, restart backend.
- **"EADDRINUSE"** → Something else is using 3000 or 4000; stop that app or change the port.
