/**
 * Server-only market data helpers.  Fetches OHLC from Yahoo Finance — a single
 * live feed shared by every timeframe.  Non-native intervals are aggregated
 * from a finer native interval so all timeframes are built from the same data.
 *
 * This file is server-only (imported by market.functions.ts inside its handler
 * / at module scope of a *.server.ts file which the bundler strips from the
 * client).
 */
import type { Candle } from "./forex";
import { yahooPlan } from "./timeframes";

export interface MarketSeries {
  candles: Candle[];
  /** Latest traded price from the feed — identical across all timeframes. */
  price: number;
  /** Previous session close, for day-change calculation. */
  prevClose: number | null;
  currency: string | null;
}

interface YahooResult {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
    }>;
  };
  meta?: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    currency?: string;
  };
}

const MAX_CANDLES = 1500;

/** Aggregate fine candles into fixed-second buckets (TradingView-style). */
function aggregate(base: Candle[], bucketSeconds: number): Candle[] {
  if (bucketSeconds <= 0) return base;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;

  for (const c of base) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    if (!cur || bucket !== curBucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
      curBucket = bucket;
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Fetch a market series for a Yahoo symbol + timeframe id.
 * Throws on network / provider failure so the caller can surface a real error
 * (we never silently substitute synthetic data).
 */
export async function fetchMarketSeries(
  yahooSymbol: string,
  timeframeId: string,
): Promise<MarketSeries> {
  const plan = yahooPlan(timeframeId);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?interval=${plan.interval}&range=${plan.range}&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; MF-SMC-Trader/1.0)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    chart?: { result?: YahooResult[]; error?: { description?: string } | null };
  };

  if (json.chart?.error) {
    throw new Error(json.chart.error.description ?? "Yahoo Finance error");
  }

  const result = json.chart?.result?.[0];
  const ts = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];

  if (!result || !ts || !quote) {
    throw new Error("No data returned for this instrument");
  }

  const base: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!Number.isFinite(o) || !Number.isFinite(c) || h < l) continue;
    base.push({ time: ts[i], open: o, high: h, low: l, close: c });
  }

  if (base.length === 0) {
    throw new Error("No valid candles in feed response");
  }

  let candles = aggregate(base, plan.aggregateSeconds);
  if (candles.length > MAX_CANDLES) {
    candles = candles.slice(candles.length - MAX_CANDLES);
  }

  const meta = result.meta ?? {};
  const price =
    Number.isFinite(meta.regularMarketPrice)
      ? (meta.regularMarketPrice as number)
      : candles[candles.length - 1].close;

  // Force the forming candle's close to equal the live price so the current
  // market price is identical across every timeframe.
  const last = candles[candles.length - 1];
  if (Number.isFinite(price)) {
    last.close = price;
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
  }

  const prevClose =
    Number.isFinite(meta.chartPreviousClose)
      ? (meta.chartPreviousClose as number)
      : Number.isFinite(meta.previousClose)
        ? (meta.previousClose as number)
        : null;

  return { candles, price, prevClose, currency: meta.currency ?? null };
}
