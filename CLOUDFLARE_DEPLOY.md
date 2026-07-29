# Cloudflare Pages Deployment Guide

This project deploys to **Cloudflare Pages** using the Nitro Cloudflare-pages preset.
The Worker runs with the `nodejs_compat` compatibility flag so `process.env` works
for server-side code.

---

## Environment Variables — Two Categories

Cloudflare Pages separates **build-time** and **runtime** variables, and this project
needs both types. Setting a variable in the wrong place is the most common cause of
the "Missing Supabase environment variable" error.

### Build-time variables (Cloudflare Pages → Settings → Environment Variables)

These are read by **Vite at build time** and embedded into the client JavaScript bundle.
Without them the browser bundle has no Supabase URL and throws on load.

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `VITE_SUPABASE_PROJECT_ID` | `<project-ref>` |

> Set these under **Pages project → Settings → Environment Variables → Build variables**.
> They must be present when Cloudflare runs `bun run build:cloudflare`.

### Runtime secrets (Cloudflare Pages → Settings → Environment Variables → Runtime secrets)

These are read by the **Cloudflare Worker** at runtime via `process.env`. Never put
service-role keys or API keys as build vars.

```bash
# Use the Cloudflare Pages dashboard or wrangler to set these:
wrangler pages secret put SUPABASE_URL
wrangler pages secret put SUPABASE_PUBLISHABLE_KEY
wrangler pages secret put SUPABASE_PROJECT_ID
wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
wrangler pages secret put TWELVEDATA_API_KEY
wrangler pages secret put SESSION_SECRET
```

> `SUPABASE_SERVICE_ROLE_KEY` is only used by admin server functions. If you don't
> use the admin panel you can skip it; the app degrades gracefully.

---

## Step 1 — Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

---

## Step 2 — Build & Deploy

```bash
# Build for Cloudflare + deploy in one step
bun run deploy:cloudflare

# Or separately:
bun run build:cloudflare   # produces .output/
wrangler pages deploy .output/public --project-name=forex-insights-terminal
```

---

## Step 3 — Custom Domain (Optional)

Cloudflare Dashboard → Workers & Pages → your project → Settings → Domains & Routes.

---

## ⚠️ Live Price Streaming on Cloudflare Workers

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

Until this is resolved, price streaming won't work in production. The rest of the app
(auth, dashboard, SMC analysis, charts with cached data) works normally.

---

## Local Dev (Replit)

```bash
bun run dev
```

Dev server reads from `.env` and Replit environment variables — Cloudflare secrets
only apply inside the deployed Worker.

---

## Build Output

```
.output/
  server/
    index.mjs        ← Cloudflare Worker entry (wrangler.toml `main`)
  public/
    _app/            ← Vite JS/CSS bundles
    index.html
```
