/**
 * GET /api/futures/exchange-info
 *
 * Server-side proxy for Binance Futures exchangeInfo (all perpetual pairs).
 * Same geo-restriction bypass rationale as /api/futures/klines.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/futures/exchange-info")({
  server: {
    handlers: {
      GET: async () => {
        const upstream = "https://fapi.binance.com/fapi/v1/exchangeInfo";

        try {
          const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) });
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: {
              "Content-Type": "application/json",
              // Cache for 5 minutes — pairs list doesn't change often
              "Cache-Control": "public, max-age=300",
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
  component: () => null,
});
