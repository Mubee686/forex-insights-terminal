/**
 * useMarketData — provides live candle data for a pair + timeframe.
 *
 * Data strategy (respects Twelve Data free-plan: 8 calls/min):
 *  • Full candle fetch  — on symbol/TF change, manual refresh, or candle close
 *                         (triggered via `candleCloseEpoch` from useCandleTimer)
 *  • Price-only fetch   — every 15 s between full reloads; updates the live
 *                         price and adjusts the last (forming) candle in-place
 *
 * Never falls back to synthetic data — surfaces real errors instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/forex";
import { getPair } from "@/lib/forex";
import { fetchCandles, fetchPrice } from "@/lib/market.functions";

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

// ─── Module-level cache ───────────────────────────────────────────────────────

interface CacheEntry {
  /** Base candles straight from the last full fetch. */
  baseCandles: Candle[];
  price: number;
  prevClose: number | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 30_000;  // stale threshold for background refresh
const PRICE_POLL_MS = 15_000; // lightweight price poll cadence

function cacheKey(symbol: string, tf: string) {
  return `${symbol}|${tf}`;
}

/** Apply the live price to the last (forming) candle without mutating the array. */
function applyLivePrice(base: Candle[], price: number): Candle[] {
  if (!base.length) return base;
  const last = base[base.length - 1];
  if (price === last.close) return base; // nothing changed
  const updated: Candle = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  return [...base.slice(0, -1), updated];
}

export function useMarketData(
  symbol: string,
  timeframeId: string,
  /** Increments each time a candle closes — drives automatic full reloads. */
  candleCloseEpoch: number = 0,
): MarketData {
  const pair = getPair(symbol);
  const tdSymbol = pair.twelvedata;

  // Initialise from cache if available.
  const initEntry = cache.get(cacheKey(symbol, timeframeId));
  const [baseCandles, setBaseCandles] = useState<Candle[]>(
    initEntry?.baseCandles ?? [],
  );
  const [price, setPrice] = useState<number | null>(initEntry?.price ?? null);
  const [prevClose, setPrevClose] = useState<number | null>(
    initEntry?.prevClose ?? null,
  );
  const [status, setStatus] = useState<FeedStatus>(
    initEntry ? "live" : "connecting",
  );
  const [error, setError] = useState<string | null>(null);

  const reqId = useRef(0);

  // ── Full candle fetch ───────────────────────────────────────────────────────
  const loadCandles = useCallback(
    async (isBackground: boolean) => {
      const id = ++reqId.current;
      if (!isBackground) setError(null);

      try {
        const res = await fetchCandles({ data: { symbol: tdSymbol, timeframeId } });
        if (id !== reqId.current) return; // superseded

        if (res.ok) {
          cache.set(cacheKey(symbol, timeframeId), {
            baseCandles: res.candles,
            price: res.price,
            prevClose: res.prevClose,
            at: Date.now(),
          });
          setBaseCandles(res.candles);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, timeframeId, tdSymbol],
  );

  // ── Lightweight price poll ──────────────────────────────────────────────────
  const pollPrice = useCallback(async () => {
    try {
      const res = await fetchPrice({ data: { symbol: tdSymbol } });
      if (res.ok) {
        setPrice(res.price);
        // Also update the cache entry's price so future cache hits are accurate.
        const entry = cache.get(cacheKey(symbol, timeframeId));
        if (entry) {
          cache.set(cacheKey(symbol, timeframeId), { ...entry, price: res.price, at: entry.at });
        }
      }
    } catch {
      // Silent — price poll failures don't surface as errors
    }
  }, [symbol, timeframeId, tdSymbol]);

  // ── Initial / on-change load ────────────────────────────────────────────────
  useEffect(() => {
    const warm = cache.get(cacheKey(symbol, timeframeId));
    if (warm) {
      setBaseCandles(warm.baseCandles);
      setPrice(warm.price);
      setPrevClose(warm.prevClose);
      setStatus("live");
      setError(null);
      if (Date.now() - warm.at > CACHE_TTL) void loadCandles(true);
    } else {
      setStatus("connecting");
      void loadCandles(false);
    }
  }, [symbol, timeframeId, loadCandles]);

  // ── Candle-close reload (epoch tick from useCandleTimer) ───────────────────
  useEffect(() => {
    if (candleCloseEpoch === 0) return; // skip the initial mount
    void loadCandles(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleCloseEpoch]);

  // ── Price polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => void pollPrice(), PRICE_POLL_MS);
    return () => clearInterval(timer);
  }, [pollPrice]);

  // ── Derive display candles (live price applied to forming candle) ───────────
  const candles = useMemo(
    () => (price != null ? applyLivePrice(baseCandles, price) : baseCandles),
    [baseCandles, price],
  );

  const refresh = useCallback(() => void loadCandles(false), [loadCandles]);

  return {
    candles,
    price,
    prevClose,
    status,
    error,
    isLoading: status === "connecting" && baseCandles.length === 0,
    refresh,
  };
}
