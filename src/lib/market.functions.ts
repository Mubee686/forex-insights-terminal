import { createServerFn } from "@tanstack/react-start";
import type { Candle } from "./forex";

export type CandleFetchResult =
  | { ok: true; candles: Candle[]; price: number; prevClose: number | null }
  | { ok: false; error: string };

export type PriceFetchResult =
  | { ok: true; price: number }
  | { ok: false; error: string };

/**
 * Fetch OHLC candles for a symbol + timeframe from Twelve Data.
 * The API key is used server-side — the browser never talks to the provider.
 */
export const fetchCandles = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) => d as { symbol: string; timeframeId: string },
  )
  .handler(async ({ data }): Promise<CandleFetchResult> => {
    try {
      const { fetchMarketSeries } = await import("./market.server");
      const series = await fetchMarketSeries(data.symbol, data.timeframeId);
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

/**
 * Fetch just the current price for a symbol.
 * Lightweight — used for live price updates between full candle refreshes.
 * Respects Twelve Data free-plan rate limits (8 calls/min).
 */
export const fetchPrice = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) => d as { symbol: string },
  )
  .handler(async ({ data }): Promise<PriceFetchResult> => {
    try {
      const { fetchCurrentPrice } = await import("./market.server");
      const price = await fetchCurrentPrice(data.symbol);
      return { ok: true, price };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to fetch price",
      };
    }
  });
