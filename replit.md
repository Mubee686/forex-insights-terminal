# MF SMC Trader

## Overview
A live forex trading terminal with TradingView-style candlestick charts and Smart Money Concept (SMC) analysis tools (Order Blocks, Liquidity, POI, etc.). Imported from Lovable.

## Stack
- TanStack Start (React 19 + Vite + file-based router via `@tanstack/react-router`)
- `lightweight-charts` for the candlestick chart
- Tailwind CSS v4 + shadcn/radix UI components
- Bun as the package manager / runtime
- Market data from the Twelve Data API (`TWELVEDATA_API_KEY` secret, used server-side only in `src/lib/market.server.ts`)

## Running
- Dev server: `bun run dev` (runs `vite dev` on port 5000) — bound to the "Start application" workflow.
- Build: `bun run build`. Deployment target is autoscale, running `bun run src/server.ts` after `bun run build`.
- Requires the `TWELVEDATA_API_KEY` secret to fetch real OHLC candles and live prices; without it, `fetchMarketSeries`/`fetchCurrentPrice` throw and the feed shows an error state (no synthetic/fake data is ever generated).

## Architecture notes
- Candle timeframes, UTC-aligned open/close boundaries, and the close countdown are computed in `src/lib/timeframes.ts` (`candleOpenTime`, `candleSecondsLeft`, `formatCountdown`).
- `src/hooks/use-candle-timer.ts` ticks every second and bumps an `epoch` counter when a candle closes; `src/hooks/use-market-data.ts` watches that epoch to append a new forming candle immediately (real market clock, no artificial data) and refetches real OHLC in the background.
- The forming (last) candle's high/low only ever move in the direction of new live prices; close tracks the latest price. Full candle history always comes from Twelve Data — never fabricated.
- `src/components/TradingChart.tsx` renders the chart and draws SMC zones on a synced overlay canvas.

## Setup log
- Installed dependencies with `bun install` (were missing after import, causing the workflow to fail with `vite: command not found`).
- Requested and configured the `TWELVEDATA_API_KEY` secret (required for any market data).
