import { useEffect, useRef, useState } from "react";
import { applyTick, generateCandles, getTimeframe, type Candle } from "@/lib/forex";
import { serverFetchCandles } from "@/lib/server-candles";

export type FeedStatus = "simulated" | "connecting" | "live" | "error";

export interface MarketData {
  candles: Candle[];
  status: FeedStatus;
  isLoading: boolean;
}

// ─── Module-level caches ──────────────────────────────────────────────────────

const simCache = new Map<string, Candle[]>();

const liveCache = new Map<string, { candles: Candle[]; at: number }>();
const LIVE_TTL  = 30_000; // 30 s — consider stale after this

function cacheKey(symbol: string, tfId: string) {
  return `${symbol}|${tfId}`;
}

function getCachedSim(symbol: string, tfId: string): Candle[] {
  const key = cacheKey(symbol, tfId);
  const hit = simCache.get(key);
  if (hit) return hit;
  const fresh = generateCandles(symbol, tfId);
  simCache.set(key, fresh);
  return fresh;
}

function getCachedLive(symbol: string, tfId: string): Candle[] | null {
  const hit = liveCache.get(cacheKey(symbol, tfId));
  if (!hit) return null;
  if (Date.now() - hit.at > LIVE_TTL) return null;
  return hit.candles;
}

function setCachedLive(symbol: string, tfId: string, candles: Candle[]) {
  liveCache.set(cacheKey(symbol, tfId), { candles, at: Date.now() });
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides candle data for a given pair + timeframe.
 *
 * Live mode:   server-side function calls Twelve Data using TWELVE_DATA_API_KEY.
 *              Falls back to simulated when no key is configured or on error.
 * Simulated:   deterministic random-walk seeded by symbol + timeframe.
 *
 * Both paths are cached so pair/timeframe switches feel instant on re-visit.
 */
export function useMarketData(symbol: string, timeframeId: string): MarketData {
  const tf = getTimeframe(timeframeId);

  const [candles,   setCandles]   = useState<Candle[]>(() => getCachedSim(symbol, timeframeId));
  const [status,    setStatus]    = useState<FeedStatus>("simulated");
  const [isLoading, setIsLoading] = useState(false);

  // ── Load / reload ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const stale = getCachedLive(symbol, timeframeId);

    if (stale) {
      // Serve warm cache instantly, then silently refresh in background
      setCandles(stale);
      setStatus("live");
      setIsLoading(false);
    } else {
      // Serve sim immediately while we try to fetch live
      setCandles(getCachedSim(symbol, timeframeId));
      setStatus("connecting");
      setIsLoading(true);
    }

    serverFetchCandles({ data: { symbol, timeframeId, count: tf.count } })
      .then((res) => {
        if (cancelled) return;
        if (res.source === "live" && res.candles) {
          setCachedLive(symbol, timeframeId, res.candles);
          setCandles(res.candles);
          setStatus("live");
        } else {
          // No key or Twelve Data error — use simulated
          setCandles(getCachedSim(symbol, timeframeId));
          setStatus("simulated");
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCandles(getCachedSim(symbol, timeframeId));
        setStatus("simulated");
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframeId, tf.count]);

  // ── Ongoing updates ────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "simulated" || status === "connecting" || status === "error") {
      // Tick simulated data every second
      const id = setInterval(() => {
        setCandles((prev) => {
          const next = applyTick(prev, symbol, timeframeId);
          simCache.set(cacheKey(symbol, timeframeId), next);
          return next;
        });
      }, 1000);
      return () => clearInterval(id);
    }

    if (status === "live") {
      // Poll live data every 30 s
      const id = setInterval(() => {
        serverFetchCandles({ data: { symbol, timeframeId, count: tf.count } })
          .then((res) => {
            if (res.source === "live" && res.candles) {
              setCachedLive(symbol, timeframeId, res.candles);
              setCandles(res.candles);
            }
          })
          .catch(() => undefined);
      }, 30_000);
      return () => clearInterval(id);
    }

    return undefined;
  }, [status, symbol, timeframeId, tf.count]);

  return { candles, status, isLoading };
}
