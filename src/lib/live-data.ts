import type { ApiConfig } from "./config";
import type { Candle } from "./forex";
import { getTimeframe } from "./forex";

/**
 * Client-side sliding-window rate limiter shared across all live requests.
 * Mirrors provider quotas (e.g. Twelve Data free tier = 8 req/min) so the app
 * self-throttles instead of getting 429s.
 */
const requestLog: number[] = [];
let maxPerMinute = 8;

export function setRateLimit(max: number): void {
  maxPerMinute = Math.max(1, max);
}

function prune(): void {
  const cutoff = Date.now() - 60_000;
  while (requestLog.length && requestLog[0] < cutoff) requestLog.shift();
}

export function getQuota(): { used: number; max: number; resetInMs: number } {
  prune();
  const resetInMs = requestLog.length ? Math.max(0, 60_000 - (Date.now() - requestLog[0])) : 0;
  return { used: requestLog.length, max: maxPerMinute, resetInMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireSlot(retryOnLimit: boolean): Promise<void> {
  prune();
  if (requestLog.length >= maxPerMinute) {
    if (!retryOnLimit) {
      throw new Error(
        `Rate limit reached (${maxPerMinute}/min). Retry disabled — request dropped.`,
      );
    }
    const wait = 60_000 - (Date.now() - requestLog[0]) + 50;
    await sleep(Math.max(250, wait));
    return acquireSlot(retryOnLimit);
  }
  requestLog.push(Date.now());
}

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

function parseTime(dt: string): number {
  const iso = dt.includes(" ") ? `${dt.replace(" ", "T")}Z` : `${dt}T00:00:00Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt);
}

/**
 * Fetch candles from the configured provider (Twelve Data format), applying
 * the rate limiter and 429 retry/backoff policy.
 */
export async function fetchLiveCandles(
  config: ApiConfig,
  symbol: string,
  timeframeId: string,
): Promise<Candle[]> {
  setRateLimit(config.rateLimit.maxPerMinute);
  const tf = getTimeframe(timeframeId);
  const interval = INTERVAL_MAP[timeframeId] ?? "15min";
  const base = config.baseUrl.replace(/\/$/, "");
  const url =
    `${base}/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${interval}&outputsize=${tf.count}&format=JSON` +
    `&apikey=${encodeURIComponent(config.apiKey.trim())}`;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await acquireSlot(config.rateLimit.retryOnLimit);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch {
      throw new Error("Network error contacting data provider.");
    }

    if (res.status === 429) {
      if (config.rateLimit.retryOnLimit && attempt < config.rateLimit.maxRetries) {
        attempt++;
        await sleep(backoff(attempt));
        continue;
      }
      throw new Error("Provider returned 429 — rate limit exceeded. Lower requests/min.");
    }
    if (!res.ok) {
      throw new Error(`Provider error (HTTP ${res.status}).`);
    }

    const json = (await res.json()) as {
      status?: string;
      message?: string;
      values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
    };

    if (json.status === "error" || !Array.isArray(json.values)) {
      throw new Error(json.message || "Invalid response from provider.");
    }

    return json.values
      .map((v) => ({
        time: parseTime(v.datetime),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
      }))
      .filter((c) => Number.isFinite(c.close))
      .reverse();
  }
}
