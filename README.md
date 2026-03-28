# Backend (Node API + ML service)

## Quick start

1. Copy `.env.example` to `.env` and set values.
2. Install packages:
   - `npm install`
3. Build/run:
   - `npm run dev`

## Security baseline implemented

- JWT secret is mandatory (`JWT_SECRET`).
- Auth supports HttpOnly cookie (`fyp_auth`) in addition to bearer token.
- `helmet` and rate limiting are enabled.
- Input validation is added for core auth/model/forecast/explain endpoints.
- CORS is allowlist-based via `CORS_ORIGINS`.

## DB migration notes

- Fresh setup: run `sql/init.sql`.
- Existing setup: run `sql/add_user_role_status.sql` if role/status columns are missing.

## ML service

- Service file: `ml-service/app.py`
- Set `ML_DEBUG=false` in production.
- Optional path restriction: `ML_ALLOWED_DATA_PREFIXES`.
