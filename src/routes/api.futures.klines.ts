/**
 * GET /api/futures/klines?symbol=BTCUSDT&interval=1m&limit=500
 *
 * Server-side proxy for Binance Futures klines.
 * Calling Binance directly from the browser fails in geo-restricted regions
 * (e.g. US IPs). Proxying through the Worker bypasses this because Cloudflare
 * edge nodes are not subject to the same restrictions.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/futures/klines")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const symbol   = url.searchParams.get("symbol")   ?? "BTCUSDT";
        const interval = url.searchParams.get("interval") ?? "1m";
        const limit    = url.searchParams.get("limit")    ?? "500";

        const upstream = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;

        try {
          const res = await fetch(upstream, { signal: AbortSignal.timeout(10_000) });
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: { "Content-Type": "application/json" },
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
