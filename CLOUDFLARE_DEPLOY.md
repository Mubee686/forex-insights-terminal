# Cloudflare Workers Deployment Guide

## Prerequisites

```bash
# Wrangler CLI install karo (ek baar)
npm install -g wrangler

# Cloudflare account se login karo
wrangler login
```

---

## Step 1 — Secrets Set Karo

Har secret ko **alag alag** set karo (values kabhi `wrangler.toml` mein mat likho):

```bash
wrangler secret put TWELVEDATA_API_KEY
wrangler secret put SESSION_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_PUBLISHABLE_KEY
wrangler secret put SUPABASE_PROJECT_ID
wrangler secret put VITE_SUPABASE_URL
wrangler secret put VITE_SUPABASE_PUBLISHABLE_KEY
wrangler secret put VITE_SUPABASE_PROJECT_ID
```

> Har command ke baad Wrangler value enter karne ko kahega — wahi `.env` file ki values dalo.

---

## Step 2 — Build & Deploy

```bash
# Cloudflare ke liye build karo + deploy karo (ek command)
bun run deploy:cloudflare

# Ya alag alag:
bun run build:cloudflare   # .output/ folder banta hai
wrangler deploy            # Cloudflare Workers pe push karta hai
```

---

## Step 3 — Custom Domain (Optional)

Cloudflare Dashboard → Workers & Pages → `mf-smc-trader` → Settings → Domains & Routes mein apna domain add karo.

---

## ⚠️ Important Limitation — Live Price Streaming

**Cloudflare Workers stateless hote hain** — har request ek naya isolate mein run hoti hai.

`src/lib/providers/twelvedata-stream.server.ts` mein `setInterval` + `globalThis` use ho raha hai jo persistent background polling karta hai. Ye pattern Workers mein kaam **nahi karta** kyunki:

- Koi background timer nahi chalta requests ke beech
- `globalThis` state persist nahi hoti across requests
- SSE connections Worker ki CPU time limit tak limited hain

### Fix Options:

| Option | Effort | Description |
|--------|--------|-------------|
| **Cloudflare Durable Objects** | Medium | Persistent WebSocket/polling state per symbol |
| **External polling service** | Low | Alag Bun/Node server pe stream chalaao, Cloudflare sirf frontend serve kare |
| **Cloudflare Queues + Workers** | High | Event-driven polling architecture |

### Abhi ke liye:

Agar sirf frontend deploy karna hai aur price stream baad mein fix karna hai — `src/routes/api.price-stream.ts` ko temporarily disable karo ya ek placeholder response return karo.

---

## Local Dev (unchanged)

```bash
bun run dev   # Replit ya local pe normal dev server
```

Dev server `process.env` se secrets padhta hai — Cloudflare secrets sirf deployed Worker mein kaam karte hain.

---

## Build Output Structure

```
.output/
  server/
    index.mjs        ← Cloudflare Worker entry point (wrangler.toml ka `main`)
  public/
    _app/            ← JS/CSS bundles
    index.html       ← Shell HTML
```
