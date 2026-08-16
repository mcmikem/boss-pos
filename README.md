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
