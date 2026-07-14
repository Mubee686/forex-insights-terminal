/**
 * Twelve Data market-data adapter — SERVER-ONLY.
 *
 * Single source of truth for talking to Twelve Data. The API key is read
 * here and nowhere else. Returns REAL OHLC candles exactly as reported by
 * Twelve Data's /time_series endpoint — no synthetic/interpolated data.
 *
 * To switch vendors: write a sibling adapter with the same exported shape
 * (`resolveSymbol`, `fetchHistory`) and repoint market.functions.ts /
 * api.price-stream.ts. Nothing else in the app talks to a provider directly.
 */
import type { Candle } from "../forex";
import { aggregateCandles } from "../candle-utils";
import { twelveDataPlan } from "../timeframes";

const BASE_URL = "https://api.twelvedata.com";
const MAX_CANDLES = 1500;

export function twelveDataApiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY is not set");
  return key;
}

/**
 * Map an app display symbol to a Twelve Data symbol.
 * Twelve Data uses the same "EUR/USD" convention for forex/metals — no
 * exchange prefix required.
 */
export function resolveSymbol(pairSymbol: string): string {
  return pairSymbol;
}

interface TwelveSeriesValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TwelveSeriesResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: TwelveSeriesValue[];
}

export interface MarketSeries {
  candles: Candle[];
  price: number;
  prevClose: number | null;
}

/**
 * Parse a Twelve Data UTC datetime string into unix seconds.
 *   intraday: "2024-05-01 14:30:00"
 *   daily:    "2024-05-01"
 */
function parseUtcSeconds(datetime: string): number {
  const iso = datetime.includes(" ")
    ? datetime.replace(" ", "T") + "Z"
    : datetime + "T00:00:00Z";
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * Fetch a full OHLC history for a pair + timeframe from Twelve Data.
 * Throws on network / API / auth failure — never returns synthetic data.
 */
export async function fetchHistory(pairSymbol: string, timeframeId: string): Promise<MarketSeries> {
  const symbol = resolveSymbol(pairSymbol);
  const plan = twelveDataPlan(timeframeId);

  const url =
    `${BASE_URL}/time_series` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(plan.interval)}` +
    `&outputsize=${plan.outputsize}` +
    `&order=ASC` +
    `&timezone=UTC` +
    `&format=JSON` +
    `&apikey=${twelveDataApiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status}`);
  }

  const json = (await res.json()) as TwelveSeriesResponse;

  if (json.status === "error" || !json.values || json.values.length === 0) {
    const msg = json.message || "No data returned for this instrument";
    if (json.code === 429) {
      throw new Error("Twelve Data rate limit reached — please wait a moment and retry.");
    }
    throw new Error(msg);
  }

  const rawCandles: Candle[] = [];
  for (const v of json.values) {
    const o = Number(v.open);
    const h = Number(v.high);
    const l = Number(v.low);
    const c = Number(v.close);
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c))
      continue;
    if (h < l) continue;
    rawCandles.push({ time: parseUtcSeconds(v.datetime), open: o, high: h, low: l, close: c });
  }

  if (rawCandles.length === 0) {
    throw new Error("No valid candles in feed response");
  }

  // Twelve Data returns ASC (oldest→newest) already, but sort defensively.
  rawCandles.sort((a, b) => a.time - b.time);

  let candles = aggregateCandles(rawCandles, plan.aggregateSeconds);
  if (candles.length > MAX_CANDLES) {
    candles = candles.slice(candles.length - MAX_CANDLES);
  }

  const price = candles[candles.length - 1].close;

  const todayUtcMidnight = Math.floor(Date.now() / 86_400_000) * 86_400;
  let prevClose: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time < todayUtcMidnight) {
      prevClose = candles[i].close;
      break;
    }
  }

  return { candles, price, prevClose };
}

/** Fetch the latest spot price for a symbol via REST (polling fallback). */
export async function fetchLatestPrice(pairSymbol: string): Promise<number | null> {
  const symbol = resolveSymbol(pairSymbol);
  const url =
    `${BASE_URL}/price` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${twelveDataApiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { price?: string; status?: string };
  if (!json.price) return null;
  const price = Number(json.price);
  return Number.isFinite(price) ? price : null;
}
