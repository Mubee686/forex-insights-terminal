import { useEffect, useRef, useState } from "react";
import { applyTick, generateCandles, type Candle } from "@/lib/forex";
import { isLiveReady, type ApiConfig } from "@/lib/config";
import { fetchLiveCandles, setRateLimit } from "@/lib/live-data";

export type FeedStatus = "simulated" | "connecting" | "live" | "error";

export interface MarketData {
  candles: Candle[];
  status: FeedStatus;
  error: string | null;
  isLoading: boolean;
}

// ─── Module-level caches ──────────────────────────────────────────────────────

// Simulated candles are deterministic; cache indefinitely per key.
const simCache = new Map<string, Candle[]>();

// Live candles expire after 30 s so repeated pair switches feel instant.
const liveCache = new Map<string, { candles: Candle[]; at: number }>();
const LIVE_TTL = 30_000;

function simKey(symbol: string, tfId: string) {
  return `${symbol}|${tfId}`;
}

function getCachedSim(symbol: string, tfId: string): Candle[] {
  const key = simKey(symbol, tfId);
  const hit = simCache.get(key);
  if (hit) return hit;
  const fresh = generateCandles(symbol, tfId);
  simCache.set(key, fresh);
  return fresh;
}

function getCachedLive(symbol: string, tfId: string): Candle[] | null {
  const hit = liveCache.get(simKey(symbol, tfId));
  if (!hit) return null;
  if (Date.now() - hit.at > LIVE_TTL) return null;
  return hit.candles;
}

function setCachedLive(symbol: string, tfId: string, candles: Candle[]) {
  liveCache.set(simKey(symbol, tfId), { candles, at: Date.now() });
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides candle data based on config: deterministic simulated feed or a
 * rate-limited live provider feed. Live failures fall back to simulated.
 * Both simulated and live data are cached so pair/timeframe switches are
 * near-instant on repeat visits.
 */
export function useMarketData(
  config: ApiConfig,
  hydrated: boolean,
  symbol: string,
  timeframeId: string,
): MarketData {
  const [candles, setCandles] = useState<Candle[]>(() =>
    getCachedSim(symbol, timeframeId),
  );
  const [status, setStatus] = useState<FeedStatus>("simulated");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;

  const wantLive = hydrated && isLiveReady(config);

  // ── Load / reload when instrument, timeframe or feed changes ──────────────
  useEffect(() => {
    let cancelled = false;

    if (!wantLive) {
      // Simulated: serve from cache immediately (no loading state)
      setStatus("simulated");
      setError(null);
      setIsLoading(false);
      setCandles(getCachedSim(symbol, timeframeId));
      return () => {
        cancelled = true;
      };
    }

    // Live mode: serve stale cache immediately to avoid blank chart,
    // then refresh in the background.
    const stale = getCachedLive(symbol, timeframeId);
    if (stale) {
      setCandles(stale);
      setStatus("live");
      setIsLoading(false);
    } else {
      // No cached data → show simulated while we fetch
      setCandles(getCachedSim(symbol, timeframeId));
      setStatus("connecting");
      setIsLoading(true);
    }
    setError(null);
    setRateLimit(configRef.current.rateLimit.maxPerMinute);

    fetchLiveCandles(configRef.current, symbol, timeframeId)
      .then((res) => {
        if (cancelled) return;
        setCachedLive(symbol, timeframeId, res);
        setCandles(res);
        setStatus("live");
        setIsLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus("error");
        setIsLoading(false);
        // Fall back to simulated if nothing cached
        if (!stale) setCandles(getCachedSim(symbol, timeframeId));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantLive, symbol, timeframeId, config.apiKey, config.baseUrl, config.provider]);

  // ── Ongoing updates: simulated ticks or live polling ─────────────────────
  useEffect(() => {
    if (!wantLive || status === "error" || status === "simulated") {
      const id = setInterval(() => {
        setCandles((prev) => {
          const next = applyTick(prev, symbol, timeframeId);
          // Keep simulated cache warm with the latest ticked state
          simCache.set(simKey(symbol, timeframeId), next);
          return next;
        });
      }, 1000);
      return () => clearInterval(id);
    }

    if (status === "live") {
      const maxPerMin = Math.max(1, configRef.current.rateLimit.maxPerMinute);
      const pollMs = Math.max(15_000, Math.ceil(65_000 / maxPerMin));
      const id = setInterval(() => {
        fetchLiveCandles(configRef.current, symbol, timeframeId)
          .then((res) => {
            setCachedLive(symbol, timeframeId, res);
            setCandles(res);
            setError(null);
          })
          .catch((e: unknown) =>
            setError(e instanceof Error ? e.message : String(e)),
          );
      }, pollMs);
      return () => clearInterval(id);
    }

    return undefined;
  }, [wantLive, status, symbol, timeframeId]);

  return { candles, status, error, isLoading };
}
