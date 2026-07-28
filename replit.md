# MF SMC Trader

## Overview
A live forex trading terminal with TradingView-style candlestick charts and Smart Money Concept (SMC) analysis tools (Order Blocks, Liquidity, POI, etc.).

## Stack
- TanStack Start (React 19 + Vite + file-based router via `@tanstack/react-router`)
- `lightweight-charts` for the candlestick chart
- Tailwind CSS v4 + shadcn/radix UI components
- Bun as the package manager / runtime
- Market data from **Twelve Data** (`TWELVEDATA_API_KEY` secret): historical OHLC via the `/time_series` REST endpoint (`src/lib/providers/twelvedata.server.ts`), live price ticks via a server-side poll loop against the `/price` endpoint bridged to the browser over SSE (`src/lib/providers/twelvedata-stream.server.ts`, `src/routes/api.price-stream.ts`)

## Running
- Dev server: `bun run dev` (runs `vite dev` on port 5000) — bound to the "Start application" workflow.
- Build: `bun run build`. Deployment target is autoscale, running `bun run src/server.ts` after `bun run build`.
- Requires the `TWELVEDATA_API_KEY` secret. **Twelve Data's WebSocket push feed is a Pro-plan feature** — on a free-tier key the app polls the REST `/price` endpoint instead (every 8s per actively-viewed symbol) to stay under the free-tier rate limit, so "live" prices update slightly less often than a true push feed but never use synthetic data.

## Architecture notes
- **Provider is swappable by design.** `src/lib/forex.ts` and `src/lib/timeframes.ts` are provider-agnostic (client-safe, no vendor imports). All Twelve Data-specific code lives under `src/lib/providers/`. To switch vendors: write a sibling adapter with the same shape (`resolveSymbol`, `fetchHistory`) and point `src/lib/market.functions.ts` / `src/routes/api.price-stream.ts` at it — no other file needs to change.
- Candle timeframes, UTC-aligned open/close boundaries, and the close countdown are computed in `src/lib/timeframes.ts` (`candleOpenTime`, `candleSecondsLeft`, `formatCountdown`); this countdown is derived from UTC time, not device clock or ticks, so it stays accurate regardless of feed state.
- `src/hooks/use-candle-timer.ts` ticks every second and bumps an `epoch` counter when a candle closes; `src/hooks/use-market-data.ts` watches that epoch to append a new forming candle immediately (real market clock, no artificial data) and refetches real OHLC in the background.
- Live prices arrive over Server-Sent Events (`EventSource` in `use-market-data.ts` → `GET /api/price-stream?symbol=...`), fed by one shared poll timer per symbol per server process (`twelvedata-stream.server.ts`), ref-counted so multiple browser tabs/pairs watching the same symbol share a single upstream poll instead of each polling independently. The browser's `EventSource` auto-reconnects natively on drop.
- The forming (last) candle's high/low only ever move in the direction of new live prices; close tracks the latest price. If historical backfill fails for any reason, the very first live tick seeds the forming candle instead of leaving the chart blank — still 100% real tick data, never fabricated.
- `src/components/TradingChart.tsx` renders the chart and draws SMC zones on a synced overlay canvas.

## Setup log
- Installed dependencies with `bun install` (were missing after import, causing the workflow to fail with `vite: command not found`).
- Replaced the Finnhub integration with Twelve Data (`TWELVEDATA_API_KEY` secret) at the user's request. Twelve Data's WebSocket is Pro-only, so live ticks are delivered via a rate-limited server-side REST poll loop instead — see Architecture notes above.
