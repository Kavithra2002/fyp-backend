# Frontend-Backend Connection Guide

## Current Setup ✅

- **Backend**: Running on `http://localhost:4000`
- **Frontend**: Running on `http://localhost:3000`
- **Proxy**: Next.js rewrites proxy `/api/*` → `http://localhost:4000/:path*`

## How It Works

1. Frontend makes API calls to `/api/data`, `/api/models`, etc.
2. Next.js rewrites intercept these and proxy to `http://localhost:4000/data`, `http://localhost:4000/models`, etc.
3. Backend receives requests and responds with JSON
4. CORS is enabled on backend, so cross-origin requests work

## Verify Connection

### Method 1: Test Backend Directly (in browser or terminal)

```bash
# Health check
curl http://localhost:4000/health
# Expected: {"status":"ok","timestamp":"..."}

# List datasets
curl http://localhost:4000/data
# Expected: []

# API info
curl http://localhost:4000/
# Expected: API info with available routes
```

### Method 2: Test Through Frontend Proxy (in browser)

Open your browser console (F12) and run:

```javascript
// Test health check
fetch('/api/health')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);

// Test data endpoint
fetch('/api/data')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
```

Expected results:
- Health check: `{status: "ok", timestamp: "..."}`
- Data: `[]` (empty array if no datasets)

### Method 3: Check Browser Network Tab

1. Open DevTools (F12) → Network tab
2. Go to Dashboard page (`http://localhost:3000/dashboard`)
3. Look for API calls:
   - `/api/data` → Should show 200 status
   - `/api/models` → Should show 200 status
4. Click on any API call to see:
   - Request URL: `http://localhost:3000/api/data`
   - Response: JSON data from backend

### Method 4: Test Full Flow

1. **Upload a dataset**:
   - Go to Data Management page
   - Upload a CSV file
   - Check backend console for upload confirmation

2. **Train a model**:
   - Go to Model Management page
   - Select dataset and train a model
   - Check backend console for training confirmation

3. **Run forecast**:
   - Go to Dashboard
   - Select dataset and model
   - Click "Run forecast"
   - Chart should update with forecast data

## Troubleshooting

### Issue: API calls return 404 or connection error

**Solution**: 
- Verify backend is running: `http://localhost:4000/health`
- Check backend console for errors
- Restart backend: `npm run dev` in `backend/` folder

### Issue: CORS errors in browser

**Solution**: 
- Backend already has `cors({ origin: true })` enabled
- If still seeing errors, check backend `src/index.ts` line 18

### Issue: Frontend shows "No datasets" but backend has data

**Solution**: 
- Backend uses in-memory storage (resets on restart)
- Upload dataset again after restart
- Or use `/api/data` endpoint to verify backend has data

### Issue: Proxy not working

**Solution**: 
1. Check `frontend/next.config.ts` has rewrites configured:
   ```ts
   async rewrites() {
     return [{ source: "/api/:path*", destination: "http://localhost:4000/:path*" }];
   }
   ```
2. Restart frontend after changing `next.config.ts`
3. Or set environment variable: Create `frontend/.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:4000
   ```

## Alternative: Use Environment Variable

Instead of Next.js rewrites, you can use direct connection:

1. Create `frontend/.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:4000
   ```

2. Restart frontend

3. Frontend will call backend directly (bypassing proxy)

## Quick Test Script

Save as `test-connection.js` in backend folder:

```javascript
// Quick test script
const testEndpoints = [
  'http://localhost:4000/health',
  'http://localhost:4000/',
  'http://localhost:4000/data',
  'http://localhost:4000/models',
];

async function test() {
  for (const url of testEndpoints) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log(`✅ ${url}:`, data);
    } catch (err) {
      console.error(`❌ ${url}:`, err.message);
    }
  }
}

test();
```

Run with: `node test-connection.js` (requires Node 18+ with fetch)
