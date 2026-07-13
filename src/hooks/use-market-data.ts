import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/forex";
import { getPair } from "@/lib/forex";
import { fetchCandles } from "@/lib/market.functions";

export type FeedStatus = "connecting" | "live" | "error";

export interface MarketData {
  candles: Candle[];
  price: number | null;
  prevClose: number | null;
  status: FeedStatus;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

// ─── Module-level cache (survives pair / timeframe switches) ─────────────────

interface CacheEntry {
  candles: Candle[];
  price: number;
  prevClose: number | null;
  at: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 20_000; // treat entries older than this as stale
const POLL_MS = 8_000; // live refresh cadence

function key(symbol: string, tf: string) {
  return `${symbol}|${tf}`;
}

/**
 * Provides candle data for a pair + timeframe from ONE live feed.
 * - Warm cache is served instantly, then refreshed in the background.
 * - Polls every few seconds so the current price stays in sync with the market.
 * - Never falls back to synthetic data; surfaces a real error instead.
 */
export function useMarketData(symbol: string, timeframeId: string): MarketData {
  const pair = getPair(symbol);
  const yahoo = pair.yahoo;

  const cached = cache.get(key(symbol, timeframeId));
  const [candles, setCandles] = useState<Candle[]>(cached?.candles ?? []);
  const [price, setPrice] = useState<number | null>(cached?.price ?? null);
  const [prevClose, setPrevClose] = useState<number | null>(cached?.prevClose ?? null);
  const [status, setStatus] = useState<FeedStatus>(cached ? "live" : "connecting");
  const [error, setError] = useState<string | null>(null);

  const reqId = useRef(0);

  const load = useCallback(
    async (isBackground: boolean) => {
      const id = ++reqId.current;
      if (!isBackground) setError(null);

      try {
        const res = await fetchCandles({ data: { yahoo, timeframeId } });
        if (id !== reqId.current) return; // superseded

        if (res.ok) {
          cache.set(key(symbol, timeframeId), {
            candles: res.candles,
            price: res.price,
            prevClose: res.prevClose,
            at: Date.now(),
          });
          setCandles(res.candles);
          setPrice(res.price);
          setPrevClose(res.prevClose);
          setStatus("live");
          setError(null);
        } else if (!isBackground) {
          setStatus("error");
          setError(res.error);
        }
      } catch (err) {
        if (id !== reqId.current) return;
        if (!isBackground) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Network error");
        }
      }
    },
    [symbol, timeframeId, yahoo],
  );

  // Initial / on-change load
  useEffect(() => {
    const warm = cache.get(key(symbol, timeframeId));
    if (warm) {
      setCandles(warm.candles);
      setPrice(warm.price);
      setPrevClose(warm.prevClose);
      setStatus("live");
      setError(null);
      // Refresh in background if stale
      if (Date.now() - warm.at > CACHE_TTL) void load(true);
    } else {
      setStatus("connecting");
      void load(false);
    }
  }, [symbol, timeframeId, load]);

  // Live polling
  useEffect(() => {
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = useCallback(() => void load(false), [load]);

  return {
    candles,
    price,
    prevClose,
    status,
    error,
    isLoading: status === "connecting" && candles.length === 0,
    refresh,
  };
}
