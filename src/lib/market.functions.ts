import { createServerFn } from "@tanstack/react-start";
import type { Candle } from "./forex";

export type CandleFetchResult =
  | { ok: true; candles: Candle[]; price: number; prevClose: number | null }
  | { ok: false; error: string };

/**
 * Fetch OHLC candles for a symbol + timeframe from the single live feed.
 * The API key–free Yahoo Finance endpoint is called server-side so the same
 * feed powers every timeframe and the browser never talks to the provider
 * directly.
 */
export const fetchCandles = createServerFn({ method: "GET" })
  .inputValidator(
    (d: unknown) => d as { yahoo: string; timeframeId: string },
  )
  .handler(async ({ data }): Promise<CandleFetchResult> => {
    try {
      const { fetchMarketSeries } = await import("./market.server");
      const series = await fetchMarketSeries(data.yahoo, data.timeframeId);
      return {
        ok: true,
        candles: series.candles,
        price: series.price,
        prevClose: series.prevClose,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load market data",
      };
    }
  });
