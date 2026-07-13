/**
 * Server-only market data helpers.  Fetches OHLC from the Twelve Data API.
 * Non-native intervals are aggregated from a finer native interval so all
 * timeframes are built from the same underlying feed.
 *
 * This file is server-only — imported by market.functions.ts inside its
 * handler so the bundler strips it from the client bundle.
 */
import type { Candle } from "./forex";
import { twelvedataPlan } from "./timeframes";

const BASE_URL = "https://api.twelvedata.com";
const MAX_CANDLES = 1500;

function apiKey(): string {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not set");
  return key;
}

/** Parse a Twelve Data datetime string to a UTC Unix timestamp (seconds). */
function parseDatetime(dt: string): number {
  if (dt.length === 10) {
    // "YYYY-MM-DD"
    return (
      Date.UTC(
        parseInt(dt.slice(0, 4), 10),
        parseInt(dt.slice(5, 7), 10) - 1,
        parseInt(dt.slice(8, 10), 10),
      ) / 1000
    );
  }
  // "YYYY-MM-DD HH:MM:SS"
  return (
    Date.UTC(
      parseInt(dt.slice(0, 4), 10),
      parseInt(dt.slice(5, 7), 10) - 1,
      parseInt(dt.slice(8, 10), 10),
      parseInt(dt.slice(11, 13), 10),
      parseInt(dt.slice(14, 16), 10),
      parseInt(dt.slice(17, 19), 10),
    ) / 1000
  );
}

interface TdValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TdTimeSeries {
  status?: string;
  code?: number;
  message?: string;
  values?: TdValue[];
}

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

export interface MarketSeries {
  candles: Candle[];
  /** Latest traded price from the feed. */
  price: number;
  /** Previous UTC-day close for day-change calculation. */
  prevClose: number | null;
}

/**
 * Fetch a full market series for a Twelve Data symbol + timeframe.
 * Throws on network / API failure — never returns synthetic data.
 */
export async function fetchMarketSeries(
  tdSymbol: string,
  timeframeId: string,
): Promise<MarketSeries> {
  const plan = twelvedataPlan(timeframeId);

  const url =
    `${BASE_URL}/time_series` +
    `?symbol=${encodeURIComponent(tdSymbol)}` +
    `&interval=${plan.interval}` +
    `&outputsize=${plan.outputsize}` +
    `&timezone=UTC` +
    `&apikey=${apiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status}`);
  }

  const json = (await res.json()) as TdTimeSeries;

  if (json.status === "error" || json.code != null) {
    throw new Error(json.message ?? "Twelve Data API error");
  }

  if (!json.values || json.values.length === 0) {
    throw new Error("No data returned for this instrument");
  }

  // Twelve Data returns newest-first — reverse to oldest-first for the chart.
  const rawCandles: Candle[] = [];
  for (const v of [...json.values].reverse()) {
    const o = parseFloat(v.open);
    const h = parseFloat(v.high);
    const l = parseFloat(v.low);
    const c = parseFloat(v.close);
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (h < l) continue;
    rawCandles.push({ time: parseDatetime(v.datetime), open: o, high: h, low: l, close: c });
  }

  if (rawCandles.length === 0) {
    throw new Error("No valid candles in feed response");
  }

  let candles = aggregate(rawCandles, plan.aggregateSeconds);
  if (candles.length > MAX_CANDLES) {
    candles = candles.slice(candles.length - MAX_CANDLES);
  }

  // Latest price = close of the most recent (forming) candle.
  const price = candles[candles.length - 1].close;

  // prevClose = close of the last candle that started before today's UTC midnight.
  const todayUtcMidnight =
    Math.floor(Date.now() / 86_400_000) * 86_400;
  let prevClose: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time < todayUtcMidnight) {
      prevClose = candles[i].close;
      break;
    }
  }

  return { candles, price, prevClose };
}

/**
 * Fetch only the current price for a symbol.
 * Uses the lightweight /price endpoint — much cheaper on the rate-limit budget.
 */
export async function fetchCurrentPrice(tdSymbol: string): Promise<number> {
  const url =
    `${BASE_URL}/price` +
    `?symbol=${encodeURIComponent(tdSymbol)}` +
    `&apikey=${apiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    throw new Error(`Twelve Data price HTTP ${res.status}`);
  }

  const json = (await res.json()) as { price?: string; code?: number; message?: string };

  if (json.code != null) {
    throw new Error(json.message ?? "Twelve Data price error");
  }

  const price = parseFloat(json.price ?? "");
  if (!Number.isFinite(price)) {
    throw new Error("Invalid price response from Twelve Data");
  }

  return price;
}
