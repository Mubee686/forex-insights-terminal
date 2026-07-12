import { createServerFn } from "@tanstack/react-start";
import type { Candle } from "./forex";

// ─── Twelve Data interval mapping ────────────────────────────────────────────
// Twelve Data supports these intervals (free tier: 1min–1h; paid: up to 1month)
const INTERVAL_MAP: Record<string, string> = {
  "1m":  "1min",
  "2m":  "2min",
  "3m":  "3min",
  "4m":  "4min",
  "5m":  "5min",
  "10m": "10min",
  "15m": "15min",
  "20m": "20min",
  "30m": "30min",
  "45m": "45min",
  "1h":  "1h",
  "2h":  "2h",
  "3h":  "3h",
  "4h":  "4h",
  "6h":  "6h",
  "8h":  "8h",
  "12h": "12h",
  "1d":  "1day",
  "2d":  "2day",
  "3d":  "3day",
  "1w":  "1week",
  "1M":  "1month",
};

function parseTime(dt: string): number {
  const iso = dt.includes(" ") ? `${dt.replace(" ", "T")}Z` : `${dt}T00:00:00Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

type ServerResult =
  | { source: "live"; candles: Candle[] }
  | { source: "simulated"; candles: null; reason: string };

/**
 * Server-only function: fetches OHLC candles from Twelve Data using the
 * TWELVE_DATA_API_KEY environment variable.  The API key is never sent to
 * the browser — all requests originate from the Node.js process.
 *
 * Returns { source: "simulated" } when no key is configured so the client
 * falls back to deterministic simulated data.
 */
export const serverFetchCandles = createServerFn()
  .validator(
    (d: unknown) => d as { symbol: string; timeframeId: string; count: number },
  )
  .handler(async ({ data }): Promise<ServerResult> => {
    const key = process.env.TWELVE_DATA_API_KEY?.trim();
    if (!key) {
      return {
        source: "simulated",
        candles: null,
        reason: "TWELVE_DATA_API_KEY not configured",
      };
    }

    const interval = INTERVAL_MAP[data.timeframeId];
    if (!interval) {
      return {
        source: "simulated",
        candles: null,
        reason: `Unsupported timeframe for live feed: ${data.timeframeId}`,
      };
    }

    const count  = Math.min(Math.max(50, data.count), 500);
    const url    =
      `https://api.twelvedata.com/time_series` +
      `?symbol=${encodeURIComponent(data.symbol)}` +
      `&interval=${interval}` +
      `&outputsize=${count}` +
      `&format=JSON` +
      `&apikey=${key}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) {
        return {
          source: "simulated",
          candles: null,
          reason: `Twelve Data HTTP ${res.status}`,
        };
      }

      const json = (await res.json()) as {
        status?: string;
        message?: string;
        values?: Array<{
          datetime: string;
          open: string;
          high: string;
          low: string;
          close: string;
        }>;
      };

      if (json.status === "error" || !Array.isArray(json.values) || json.values.length === 0) {
        return {
          source: "simulated",
          candles: null,
          reason: json.message ?? "Empty or error response from Twelve Data",
        };
      }

      const candles: Candle[] = json.values
        .map((v) => ({
          time:  parseTime(v.datetime),
          open:  Number(v.open),
          high:  Number(v.high),
          low:   Number(v.low),
          close: Number(v.close),
        }))
        .filter((c) => Number.isFinite(c.close) && c.high >= c.low)
        .reverse();

      if (candles.length === 0) {
        return { source: "simulated", candles: null, reason: "No valid candles in response" };
      }

      return { source: "live", candles };
    } catch (err) {
      return {
        source: "simulated",
        candles: null,
        reason: err instanceof Error ? err.message : "Network error",
      };
    }
  });
