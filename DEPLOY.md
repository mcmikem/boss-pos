# IMAC POS - Deployment Guide

## Quick Deploy to Render (Free Permanent URL)

### Step 1: Create a GitHub Repo
1. Go to https://github.com/new
2. Name it `boss-pos` (or any name)
3. Make it **Public** (free tier requires public repo on Render)
4. Don't initialize with README

### Step 2: Push Code to GitHub
Run these commands from your project folder:

```bash
cd /Users/me/Downloads/boss-pos
git init
git add .
git commit -m "IMAC POS - initial deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/boss-pos.git
git push -u origin main
```

### Step 3: Deploy on Render
1. Go to https://render.com and sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repo
4. Settings:
   - **Name:** `imac-pos`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node server.js`
5. Click **"Create Web Service"**
6. Wait 2-3 minutes for first deploy
7. Your permanent URL will be: `https://imac-pos.onrender.com`

### Step 4: Install as PWA on Phones
1. Open `https://imac-pos.onrender.com` on your phone
2. **iPhone:** Tap Share icon → "Add to Home Screen"
3. **Android:** Tap 3-dot menu → "Install App" or "Add to Home Screen"
4. The app icon will appear on your home screen!

### Server-Side Configuration (Variables)
- `DATABASE_URL` — required. A Postgres connection string (Neon). All data lives here; the deploy is stateless.
- `AUTH_SECRET` — optional. HMAC secret used to sign login tokens. Seeded automatically on first boot and stored in the DB; set it to keep tokens valid across restores/redeploys.
- `CRON_SECRET` — optional but recommended. Guards the scheduled-backup endpoint so it isn't publicly triggerable. See below.

### Scheduled Daily Backups
The server keeps its own snapshots (last 30, one per 24h) and also auto-backs up opportunistically on boot/sale, so nothing needs to be set up for basic protection. To guarantee a daily run, add a cron that hits the backup endpoint with your `CRON_SECRET`:

- **Vercel:** add a Cron Job (e.g. every day at 03:00 UTC) targeting `https://your-app.vercel.app/api/cron/backup` with header `Authorization: Bearer YOUR_CRON_SECRET`.
- **Render:** use an external cron service (cron-job.org, GitHub Actions cron) hitting `https://imac-pos.onrender.com/api/cron/backup` with the same bearer header.

### Backups — what actually happens
- Snapshots are JSON blobs stored in the `backups` table inside Postgres itself (last 30 kept, one claimed per 24h, idempotent across cold starts). Every table is captured: products, suppliers, sales, expenses, settings, credit payments/transfer register, tailoring/design orders, stock movements, credit eats, production register, wastage log, momo transfers.
- Besides the cron, the server also snapshots opportunistically on boot/sale (throttled to once per 24h) and on demand via `POST /api/backups/run`.
- If you lose the DB itself you lose the snapshots too — for true off-site protection, download the export (`GET /api/export` with a till token) somewhere else.

### Restore / disaster recovery
Restore merges a snapshot over the target database **by primary key** (`POST /api/restore`, auth required). Rows present in the backup update the target; rows missing from the backup are left alone. `authSecret` is deliberately preserved so tills don't suddenly get logged out.

To restore (e.g. into a fresh database after data loss):

1. Get the snapshot JSON — `GET /api/export` with a till token, or read the latest `backups` row from Postgres (column `data`).
2. Swap `DATABASE_URL` to the target database (deploy the app, or point it locally at a new Neon database).
3. `POST /api/restore` with the snapshot as the body. The response lists how many rows landed per table. An `audit` row records the restore.

For a true "wipe and restore to an earlier point", restore into an **empty** database — not by overwriting the live one, since the merge never deletes rows.

**Restore drill** (run once, then whenever you change the schema):
1. Create a throwaway Neon database.
2. Point the app at it locally (`DATABASE_URL`), boot, then POST the latest live snapshot to `/api/restore`.
3. Verify counts match the live DB — the smoke test's write round-trip will then also pass against the throwaway DB (`ALLOW_TEST_WRITES=1`).

### Continuous Deployment (optional)
`.github/workflows/ci.yml` already type-checks, builds, and runs the test suites on every push. A production deploy job is wired up too — it runs on `main` pushes once a `VERCEL_TOKEN` GitHub secret exists:

1. Create a token at https://vercel.com/account/tokens (a full-access "Vercel" token).
2. Add it as a repo secret `VERCEL_TOKEN` alongside the already-set `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
3. Every push to `main` then deploys straight to production (`vercel deploy --prod`).

### Important Notes
- Render free tier spins down after 15 min of inactivity (first load takes ~30s)
- Data persists in Postgres (`DATABASE_URL`), never SQLite
- For always-on + persistent data, upgrade to Render paid plan ($7/month)
- Every device shares the same data from the server database
- Product photos are uploaded through the API and stored in the DB; Vercel rewrites `/uploads/*` to the API function automatically (already configured in `vercel.json`).
