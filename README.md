# FYP Forecast & XAI – Backend

Node.js API for the forecasting platform. Implements **mock** responses for all routes; replace with database and ML service later.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data` | List datasets |
| GET | `/data/:id` | Get dataset |
| PUT | `/data/:id/active` | Set active dataset |
| POST | `/data/upload` | Upload CSV (multipart `file`) |
| GET | `/models` | List models |
| GET | `/models/:id` | Get model |
| PUT | `/models/:id/active` | Set active model |
| POST | `/models/train` | Start training (`{ datasetId, type, params? }`) |
| GET | `/models/job/:jobId` | Training job status |
| POST | `/forecast` | Run forecast (`{ datasetId, modelId, horizon }`) |
| POST | `/explain` | Get SHAP + attention (`{ modelId, runId? }`) |
| POST | `/scenario` | What‑if (`{ baseRunId, overrides }`) |
| POST | `/export` | Export PDF or XLSX (`{ type, runId?, scenarioRunId? }`) |

## Run

```bash
cd backend
npm install
npm run dev
```

Runs at **http://localhost:4000**. For production build:

```bash
npm run build
npm start
```

## Connect the frontend

**Option A – env (recommended for dev)**

In `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Start backend on 4000, then `npm run dev` in `frontend`. The frontend will call `http://localhost:4000/data`, etc.

**Option B – Next.js rewrites**

In `frontend/next.config.ts`, uncomment and set:

```ts
async rewrites() {
  return [{ source: "/api/:path*", destination: "http://localhost:4000/:path*" }];
}
```

Then keep `NEXT_PUBLIC_API_URL` unset (or `/api`). The frontend will request `/api/data` and Next will proxy to `http://localhost:4000/data`.

## Data

- CSV uploads are saved under `backend/uploads/`.
- Datasets and models are kept **in memory**; they reset when the server restarts. Add Prisma (or similar) for persistence.
