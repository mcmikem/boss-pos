# IMAC Enterprises POS

A lightweight, offline-first point-of-sale system for IMAC Enterprises. React/Vite PWA frontend with a single Express serverless function (`api/index.js`) backed by a Neon Postgres database.

- Works offline — service-worker cached app + product photos, syncs on reconnect
- Old-device friendly — supports Android 9 and back (Chrome 64+, legacy bundles for older)
- Multi-till sync with conflict resolution
- Daily close-out, inventory, expenses, tailoring/design orders, analytics
- Daily automated backups

## Run locally

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (Neon Postgres), `AUTH_SECRET`, and `CRON_SECRET`.
3. `npm run dev` — Vite serves the app on port 3000, API on 3001. Any device on the same WiFi can reach it via the printed Network URL.

## Test

`npm test` — integration smoke tests against the API. They require `DATABASE_URL` to point at a real database; write round-trips are opt-in via `ALLOW_TEST_WRITES=1`.

## Deploy

See [DEPLOY.md](DEPLOY.md) for Vercel/Render setup, environment variables, cron, and backup/restore notes.

### Cloudflare Workers

This repository can also deploy as a Cloudflare Worker with the static frontend served from Worker Assets. Connect `mcmikem/boss-pos` in Workers & Pages and use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. Set `DATABASE_URL` as an encrypted production secret on the Worker before deploying; it must point to the existing Boss POS Neon database. `AUTH_SECRET` is loaded from the database on first boot unless explicitly configured. Keep `CRON_SECRET` set if using the backup/export cron endpoints.

The Worker uses `nodejs_compat` for the existing Express API and a WASM image converter in place of native Sharp. On the free Workers plan, CPU-intensive requests such as password verification and image uploads can hit Cloudflare's 10 ms CPU limit; monitor Worker invocation errors after deployment. The existing Vercel/Render deployments are not changed by this configuration.
