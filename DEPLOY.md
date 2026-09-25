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
    - **Name:** `boss-pos-ug`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node server.js`
5. Click **"Create Web Service"**
6. Wait 2-3 minutes for first deploy
7. Your permanent URL will be: `https://boss-pos-ug.onrender.com`

### Step 4: Install as PWA on Phones
1. Open `https://boss-pos-ug.onrender.com` on your phone
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
- **Render:** use an external cron service (cron-job.org, GitHub Actions cron) hitting `https://boss-pos-ug.onrender.com/api/cron/backup` with the same bearer header.

### Backups — what actually happens
- Snapshots are JSON blobs stored in the `backups` table inside Postgres itself (last 30 kept, one claimed per 24h, idempotent across cold starts). Every table is captured: products, suppliers, sales, expenses, settings, credit payments/transfer register, tailoring/design orders, quotes, stock movements, credit eats, production register, wastage log, momo transfers, settlements, close sessions, shift handovers and a metadata-only manifest of uploaded photos.
- Besides the cron, the server also snapshots opportunistically on boot/sale (throttled to once per 24h) and on demand via `POST /api/backups/run` (manager only). A manual run always takes a fresh snapshot and answers with the real `id` and `created_at` of the row it wrote — the till shows that exact id and time.
- If you lose the DB itself you lose the snapshots too — for true off-site protection, download the export (`GET /api/export`, manager token) somewhere else.

### The backup file format
Exports and stored snapshots are a **versioned envelope**, not a flat dump:

| field | meaning |
| --- | --- |
| `formatVersion` | schema version of the file (currently `2`). A newer file is refused, not half-applied |
| `appVersion` | build of the server that wrote it |
| `exportedAt` | when the snapshot was taken |
| `shop` | shop id/tenant, name, build and a per-database fingerprint (a hash of the shop's own auth secret — it identifies the database without revealing it) |
| `scope` | the report range the export was filtered to (always the full shop for backups) |
| `redaction` | what was withheld: `mode`, the list of excluded settings, whether staff PIN hashes were included, and `imageBytesIncluded: false` |
| `tables` | per table: `rows` + `checksum` (`sha256:` of a key-sorted canonical form) |
| `checksum` | `sha256:` of the whole `data` object |
| `data` | the table rows themselves |

**Credentials are never in a portable export.** `authSecret`, `authVersion`, the till `pinHash`, every staff `pin_hash`, the EFRIS provider token and the Google Sheets webhook URL are stripped. `GET /api/export/with-credentials` is a **separately named, manager-only, audited** endpoint that keeps them — use it only to rebuild a wiped shop completely, and treat the file as a password. `GET /api/cron/export` (the fleet pull) is redacted like the till's own download, so off-site copies never carry PIN hashes.

**Photo bytes are never in a JSON backup.** The envelope carries an `uploads` manifest (id, content type, size) and a restore reports how many referenced `/uploads/...` images the target database is missing. For a full off-site copy of images, back up the Postgres `uploads` table separately (or the whole database).

### Restore / disaster recovery
Restore **merges** a snapshot over the target database **by primary key** (`POST /api/restore`, manager only). Rows present in the backup update the target; rows missing from the backup are left alone; **nothing is ever deleted**. Every write goes through an explicit per-table column allowlist, and these are never written by a restore no matter what a file claims: `authSecret`, `authVersion`, `authSecret`/`pinHash`-class credentials, staff `pin_hash`, the `orderCounter`/`purchaseOrderCounter` counters, and recovery/migration flags (`lastAutoBackupAt`, `*Migrated`, `catalogSynced`, `drinksSynced`, `onboarded`, `sheet_last_*`). A restore of the same shop therefore can never log your tills out, hand out an order number twice, or skip a migration. Skipped keys are reported back in the response.

**Always preflight first.** `POST /api/restore?dryRun=1` (or `POST /api/restore/preflight`) runs the identical validation and prints the plan without writing a row:

- `formatVersion` (newer than the app → refused), shop identity (a foreign shop → refused unless you send `allowCrossShop=1`), unknown tables, and every table/payload checksum
- per-table `rows`, `collisions` (how many incoming ids already exist → `overwrite` vs `insert`, with samples) and `totals`
- the settings that were skipped and why, plus how many product photos the target is missing

A real restore answers with the same report plus `restored` per table; if any table fails you get `partial: true` with the failing tables instead of a success message. An `audit` row records both the preflight and the restore.

To restore (e.g. into a fresh database after data loss):

1. Get the snapshot JSON — `GET /api/export` with a **manager** token, read the latest `backups` row from Postgres (column `data`), or copy a file pulled by `scripts/pull-backups.mjs`.
2. Swap `DATABASE_URL` to the target database (deploy the app, or point it locally at a new Neon database). Use the same `APP_TENANT_ID` so the shop identity matches.
3. Run the preflight, read it, then `POST /api/restore` with the snapshot as the body.

For a true "wipe and restore to an earlier point", restore into an **empty** database — not by overwriting the live one, since the merge never deletes rows.

### Restore drill
`scripts/restore-drill.mjs` is the executable drill. It prints a machine-readable JSON report and **exits nonzero on any mismatch**, so it can run in CI or a cron without a database:

```bash
# 1. Verify a backup file you already have (checksums, row counts, identity, no leaked credentials)
node scripts/restore-drill.mjs backups/kampala-2026-09-25.json

# 2. Pull a live snapshot from a shop and verify it in one step
node scripts/restore-drill.mjs --url https://shop.example.com --secret "$CRON_SECRET" --out /tmp/snap.json

# 3. Dry-run the restore against a shop and assert what the server plans to write
node scripts/restore-drill.mjs --preflight --url https://shop.example.com --token "$TILL_TOKEN" \
  --expect-shop kampala --expect-rows products=412,sales=18430 /tmp/snap.json

# 4. Compare two snapshots for lost rows
node scripts/restore-drill.mjs --compare /tmp/a.json /tmp/b.json

# 5. Machine-readable report for an ops dashboard
node scripts/restore-drill.mjs /tmp/snap.json --report drill.json
```

It fails (exit 1) on an unsupported `formatVersion`, a payload/table checksum mismatch, a row-count mismatch, a missing shop identity, a portable export that still carries credentials, a preflight that was not a dry run, a preflight that would write a credential-class setting, a plan that lost rows, and an unreachable target (exit 2 for bad usage). `--apply` runs the real restore through the same checks. `tests/backup-restore.test.js` runs the drill against synthetic and tampered files with `node --test` (no database, no network, no packages).


### Continuous Deployment (optional)
`.github/workflows/ci.yml` already type-checks, builds, and runs the test suites on every push. A production deploy job is wired up too — it runs on `main` pushes once a `VERCEL_TOKEN` GitHub secret exists:

1. Create a token at https://vercel.com/account/tokens (a full-access "Vercel" token).
2. Add it as a repo secret `VERCEL_TOKEN` alongside the already-set `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
3. Every push to `main` then deploys straight to production (`vercel deploy --prod`).

### Fleet mode (selling to other shops)
The repo productizes cleanly — see `scripts/`:

- `scripts/provision-shop.mjs` — creates an isolated shop: fresh Neon database (or `--database-url`), own `AUTH_SECRET`/`CRON_SECRET`, own Vercel project (`imac-pos-<slug>`), build-time `VITE_APP_NAME` brand, blank catalog unless `--seed-catalog`. Records the shop + secrets in `fleet/registry.json` (git-ignored).
- `scripts/init-db.mjs` — boot a shop's database against the app's idempotent migrations/`ensureDefaultSettings`.
- `scripts/pull-backups.mjs` — weekly off-site pull of every shop's full snapshot via `GET /api/cron/export` (guarded by that shop's `CRON_SECRET`; no till PIN needed). Every payload is verified (format version, shop identity, per-table row counts and checksums, no leaked credentials) before it is written; a shop that fails verification is reported and the script exits nonzero.
- `scripts/restore-drill.mjs` — verify a backup file (or a live pull / restore preflight) and print a machine-readable report; nonzero exit on any mismatch. See the restore drill section above.

The /api/cron/backup and /api/cron/export endpoints self-guard with CRON_SECRET and are exempt from the till-token middleware (they run headless from cron/fleet tooling).

### Important Notes
- Render free tier spins down after 15 min of inactivity (first load takes ~30s)
- Data persists in Postgres (`DATABASE_URL`), never SQLite
- For always-on + persistent data, upgrade to Render paid plan ($7/month)
- Every device shares the same data from the server database
- Product photos are uploaded through the API and stored in the DB; Vercel rewrites `/uploads/*` to the API function automatically (already configured in `vercel.json`).
