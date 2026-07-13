# MF SMC Trader

## Overview
A live forex trading terminal with TradingView-style candlestick charts and Smart Money Concept (SMC) analysis tools (Order Blocks, Liquidity, POI, etc.). Imported from Lovable.

## Stack
- TanStack Start (React 19 + Vite + file-based router via `@tanstack/react-router`)
- `lightweight-charts` for the candlestick chart
- Tailwind CSS v4 + shadcn/radix UI components
- Bun as the package manager / runtime
- Market data from **Finnhub** (`FINNHUB_API_KEY` secret): historical OHLC via REST (`src/lib/providers/finnhub.server.ts`), live price ticks via a persistent server-side WebSocket bridged to the browser over SSE (`src/lib/providers/finnhub-stream.server.ts`, `src/routes/api.price-stream.ts`)

## Running
- Dev server: `bun run dev` (runs `vite dev` on port 5000) — bound to the "Start application" workflow.
- Build: `bun run build`. Deployment target is autoscale, running `bun run src/server.ts` after `bun run build`.
- Requires the `FINNHUB_API_KEY` secret. **Finnhub's Forex Candles REST endpoint (historical OHLC) is Premium-only** — on a free-tier key it returns HTTP 403 and the UI shows a "Live (no history)" state: live price ticks keep streaming (free tier), but historical bars stay empty until the key is upgraded to a paid Finnhub plan. No code changes are needed when that happens — it starts working the moment the same key gains access.

## Architecture notes
- **Provider is swappable by design.** `src/lib/forex.ts` and `src/lib/timeframes.ts` are provider-agnostic (client-safe, no vendor imports). All Finnhub-specific code lives under `src/lib/providers/`. To switch vendors: write a sibling adapter with the same shape (`resolveSymbol`, `fetchHistory`) and point `src/lib/market.functions.ts` / `src/routes/api.price-stream.ts` at it — no other file needs to change.
- Candle timeframes, UTC-aligned open/close boundaries, and the close countdown are computed in `src/lib/timeframes.ts` (`candleOpenTime`, `candleSecondsLeft`, `formatCountdown`); this countdown is derived from UTC time, not device clock or ticks, so it stays accurate regardless of feed state.
- `src/hooks/use-candle-timer.ts` ticks every second and bumps an `epoch` counter when a candle closes; `src/hooks/use-market-data.ts` watches that epoch to append a new forming candle immediately (real market clock, no artificial data) and refetches real OHLC in the background.
- Live prices arrive over Server-Sent Events (`EventSource` in `use-market-data.ts` → `GET /api/price-stream?symbol=...`), fed by one persistent Finnhub WebSocket per server process (`finnhub-stream.server.ts`), ref-counted per symbol so multiple browser tabs/pairs share a single upstream connection (Finnhub allows only one). Both layers auto-reconnect independently on drop — the server-side WS with exponential backoff, the browser's `EventSource` natively.
- The forming (last) candle's high/low only ever move in the direction of new live prices; close tracks the latest price. If no historical backfill is available yet (free-tier limitation above), the very first live tick seeds the forming candle instead of leaving the chart blank — still 100% real tick data, never fabricated.
- `src/components/TradingChart.tsx` renders the chart and draws SMC zones on a synced overlay canvas.

## Setup log
- Installed dependencies with `bun install` (were missing after import, causing the workflow to fail with `vite: command not found`).
- Replaced the Twelve Data integration with Finnhub (`FINNHUB_API_KEY` secret) for a real-time WebSocket feed instead of polling; see Architecture notes above for the Premium/free-tier caveat on historical candles.
