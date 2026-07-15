/**
 * Finnhub market-data adapter — SERVER-ONLY.
 *
 * This is the single file that knows how to talk to Finnhub. To switch
 * vendors in the future: write a sibling adapter (same exported shape:
 * `resolveSymbol`, `fetchHistory`) and point `market.functions.ts` /
 * `price-stream.server.ts` at it. Nothing else in the app imports Finnhub
 * directly, and the API key is only ever read here.
 *
 * Historical OHLC candles require a Finnhub paid plan (Forex Candles is
 * a Premium-only REST endpoint) — this throws a clear, actionable error on
 * the free tier so the UI can surface it instead of silently failing.
 * Live price ticks (see finnhub-stream.server.ts) work on the free tier.
 */
import type { Candle } from "../forex";
import { aggregateCandles } from "../candle-utils";
import { finnhubPlan } from "../timeframes";

const BASE_URL = "https://finnhub.io/api/v1";
const MAX_CANDLES = 1500;

export function finnhubApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set");
  return key;
}

/** Map an app display symbol ("EUR/USD") to a Finnhub OANDA symbol. */
export function resolveSymbol(pairSymbol: string): string {
  return `OANDA:${pairSymbol.replace("/", "_")}`;
}

interface FinnhubCandleResponse {
  s: string; // "ok" | "no_data"
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
}

export interface MarketSeries {
  candles: Candle[];
  price: number;
  prevClose: number | null;
}

/**
 * Fetch a full OHLC history for a pair + timeframe from Finnhub.
 * Throws on network / API / plan-access failure — never returns synthetic data.
 */
export async function fetchHistory(pairSymbol: string, timeframeId: string): Promise<MarketSeries> {
  const symbol = resolveSymbol(pairSymbol);
  const plan = finnhubPlan(timeframeId);
  const to = Math.floor(Date.now() / 1000);
  const from = to - plan.lookbackSeconds;

  const url =
    `${BASE_URL}/forex/candle` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${plan.resolution}` +
    `&from=${from}` +
    `&to=${to}` +
    `&token=${finnhubApiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 403) {
    throw new Error(
      "Finnhub Forex Candles is a Premium-only endpoint on your current plan. " +
        "Live price ticks are still streaming — historical bars will appear " +
        "automatically once the key is upgraded, no code changes needed.",
    );
  }
  if (!res.ok) {
    throw new Error(`Finnhub HTTP ${res.status}`);
  }

  const json = (await res.json()) as FinnhubCandleResponse;

  if (json.s !== "ok" || !json.t || json.t.length === 0) {
    throw new Error("No data returned for this instrument");
  }

  const rawCandles: Candle[] = [];
  for (let i = 0; i < json.t.length; i++) {
    const o = json.o?.[i];
    const h = json.h?.[i];
    const l = json.l?.[i];
    const c = json.c?.[i];
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c))
      continue;
    if ((h as number) < (l as number)) continue;
    rawCandles.push({
      time: json.t[i],
      open: o as number,
      high: h as number,
      low: l as number,
      close: c as number,
    });
  }

  if (rawCandles.length === 0) {
    throw new Error("No valid candles in feed response");
  }

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
