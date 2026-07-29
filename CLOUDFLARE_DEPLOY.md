# Cloudflare Workers Deployment Guide

This project deploys to **Cloudflare Workers with Assets** — a single Worker that serves
both the SSR server (`dist/server/server.js`) and the static client bundle (`dist/client/`).
This is configured in `wrangler.toml`.

> **Do NOT use Cloudflare Pages** for this project. The `wrangler.toml` configuration
> targets Cloudflare Workers (not Pages), and the two products handle routing and Workers
> differently. Using `wrangler pages deploy` will break SSR.

---

## Automatic Deployment (Recommended)

Every push to the `main` branch is automatically built and deployed via the GitHub Actions
workflow at `.github/workflows/deploy.yml`. You do not need to run any command locally.

### One-time GitHub setup

Add these **GitHub repository secrets and variables** (Settings → Secrets and Variables → Actions):

| Kind | Name | Value / Where to find |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token (use "Edit Cloudflare Workers" template) |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right sidebar on Workers & Pages overview |
| Variable | `VITE_SUPABASE_URL` | `https://cgirdlkuarpzrpaybrkb.supabase.co` |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_TdHq5P1Gn_fxZyApaGBJww_SpehDX8i` |
| Variable | `VITE_SUPABASE_PROJECT_ID` | `cgirdlkuarpzrpaybrkb` |

### One-time Cloudflare Worker secrets

These are **runtime secrets** — they must be set directly on the Worker, not in GitHub:

```bash
# Run these once from your machine (wrangler must be logged in):
wrangler secret put SESSION_SECRET
wrangler secret put TWELVEDATA_API_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # admin routes only — skip if unused
```

> After running each command, paste the secret value when prompted.
> These are never committed to Git and never appear in `wrangler.toml`.

---

## Manual Deployment (Local)

```bash
# Install deps
bun install

# Build + deploy in one step
bun run deploy:cloudflare

# Or separately:
bun run build               # produces dist/server/server.js and dist/client/
wrangler deploy             # uploads Worker + assets to Cloudflare
```

---

## Environment Variables — Two Categories

### Build-time vars (baked into the client JS bundle by Vite)

These must be available when `bun run build` runs. Locally they come from `.env`.
In CI they come from GitHub Actions variables (set above).

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL — embedded in the browser bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ID |

### Runtime vars/secrets (read by the Cloudflare Worker via `process.env`)

Plain (non-secret) values live in `wrangler.toml` under `[vars]` and are visible in the
Cloudflare dashboard. Sensitive values must be Worker secrets.

| Source | Name | Secret? |
|---|---|---|
| `wrangler.toml [vars]` | `SUPABASE_PROJECT_ID` | No |
| `wrangler.toml [vars]` | `SUPABASE_URL` | No |
| `wrangler.toml [vars]` | `SUPABASE_PUBLISHABLE_KEY` | No |
| `wrangler.toml [vars]` | `ADMIN_DASHBOARD_PASSWORD_HASH` | No |
| Wrangler secret | `SESSION_SECRET` | **Yes** |
| Wrangler secret | `TWELVEDATA_API_KEY` | **Yes** |
| Wrangler secret | `SUPABASE_SERVICE_ROLE_KEY` | **Yes** |

---

## Build Output

```
dist/
  server/
    server.js        ← Cloudflare Worker entry (wrangler.toml `main`)
    assets/          ← server-side code chunks
  client/
    assets/          ← Vite JS/CSS bundles
    favicon.ico
    ...
```

---

## Live Price Streaming on Cloudflare Workers

**Cloudflare Workers are stateless** — each request runs in a fresh isolate.

`src/lib/providers/twelvedata-stream.server.ts` uses `setInterval` + `globalThis` for
persistent background polling. This pattern **does not work** on Workers because:

- No background timers persist between requests
- `globalThis` state is reset per isolate
- SSE connections are limited by the Worker's CPU time budget

### Options

| Option | Effort | Notes |
|---|---|---|
| **Cloudflare Durable Objects** | Medium | Persistent WebSocket/polling state per symbol |
| **External polling service** | Low | Run a separate Bun/Node server; Cloudflare only serves the frontend |
| **Cloudflare Queues + Workers** | High | Event-driven polling architecture |

Until this is resolved, live price streaming won't work in production. Auth, dashboard,
SMC analysis, and charts with cached/fetched OHLC data work normally.

---

## Local Dev (Replit)

```bash
bun run dev
```

Dev server reads from `.env` and Replit environment variables — Cloudflare secrets
only apply inside the deployed Worker.
