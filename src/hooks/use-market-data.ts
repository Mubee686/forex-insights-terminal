import { useEffect, useRef, useState } from "react";
import { applyTick, generateCandles, type Candle } from "@/lib/forex";
import { isLiveReady, type ApiConfig } from "@/lib/config";
import { fetchLiveCandles, setRateLimit } from "@/lib/live-data";

export type FeedStatus = "simulated" | "connecting" | "live" | "error";

export interface MarketData {
  candles: Candle[];
  status: FeedStatus;
  error: string | null;
}

/**
 * Provides candle data based on config: deterministic simulated feed, or a
 * rate-limited live provider feed. Live failures fall back to the simulated
 * feed so the terminal never goes blank.
 */
export function useMarketData(
  config: ApiConfig,
  hydrated: boolean,
  symbol: string,
  timeframeId: string,
): MarketData {
  const [candles, setCandles] = useState<Candle[]>(() => generateCandles(symbol, timeframeId));
  const [status, setStatus] = useState<FeedStatus>("simulated");
  const [error, setError] = useState<string | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const wantLive = hydrated && isLiveReady(config);

  // Load / reload the full series when the instrument, timeframe or feed changes
  useEffect(() => {
    let cancelled = false;

    if (!wantLive) {
      setStatus("simulated");
      setError(null);
      setCandles(generateCandles(symbol, timeframeId));
      return () => {
        cancelled = true;
      };
    }

    setStatus("connecting");
    setError(null);
    setRateLimit(configRef.current.rateLimit.maxPerMinute);
    fetchLiveCandles(configRef.current, symbol, timeframeId)
      .then((res) => {
        if (cancelled) return;
        setCandles(res);
        setStatus("live");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        setCandles(generateCandles(symbol, timeframeId));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantLive, symbol, timeframeId, config.apiKey, config.baseUrl, config.provider]);

  // Ongoing updates: simulated ticks or live polling (rate-limit aware)
  useEffect(() => {
    if (!wantLive || status === "error" || status === "simulated") {
      const id = setInterval(() => {
        setCandles((prev) => applyTick(prev, symbol, timeframeId));
      }, 1000);
      return () => clearInterval(id);
    }

    if (status === "live") {
      const maxPerMin = Math.max(1, configRef.current.rateLimit.maxPerMinute);
      const pollMs = Math.max(15_000, Math.ceil(65_000 / maxPerMin));
      const id = setInterval(() => {
        fetchLiveCandles(configRef.current, symbol, timeframeId)
          .then((res) => {
            setCandles(res);
            setError(null);
          })
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      }, pollMs);
      return () => clearInterval(id);
    }

    return undefined;
  }, [wantLive, status, symbol, timeframeId]);

  return { candles, status, error };
}
