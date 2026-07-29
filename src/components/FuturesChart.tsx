/**
 * FuturesChart — real-time crypto futures candlestick chart.
 *
 * Data source: Binance Futures public API (no key required)
 *   REST:  https://fapi.binance.com/fapi/v1/klines  — historical candles
 *   WS:    wss://fstream.binance.com/ws/<symbol>@kline_<interval>  — live ticks
 *
 * Designed to be self-contained. Forex or other chart sections can be added
 * as sibling components without touching this file.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";

// ─── constants ────────────────────────────────────────────────────────────────

export const FUTURES_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
];

export const FUTURES_INTERVALS = [
  { label: "1m",  value: "1m"  },
  { label: "5m",  value: "5m"  },
  { label: "15m", value: "15m" },
  { label: "1h",  value: "1h"  },
  { label: "4h",  value: "4h"  },
  { label: "1d",  value: "1d"  },
];

// ─── chart colour palette (matches site theme) ────────────────────────────────

const PALETTE = {
  bg:         "#0A1428",
  text:       "#7BA8CC",
  grid:       "rgba(30,58,110,0.6)",
  border:     "#1E3A6E",
  bull:       "#10B981",
  bear:       "#EF4444",
  crosshair:  "rgba(96,165,250,0.5)",
};

// ─── Binance REST helper ──────────────────────────────────────────────────────

interface RawKline {
  time:  UTCTimestamp;
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

async function fetchKlines(symbol: string, interval: string): Promise<RawKline[]> {
  const url =
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await res.json()) as any[][];
  return rows.map((r) => ({
    time:  Math.floor(Number(r[0]) / 1000) as UTCTimestamp,
    open:  parseFloat(r[1]),
    high:  parseFloat(r[2]),
    low:   parseFloat(r[3]),
    close: parseFloat(r[4]),
  }));
}

// ─── component ────────────────────────────────────────────────────────────────

export function FuturesChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef        = useRef<WebSocket | null>(null);

  const [symbol,   setSymbol]   = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1m");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // ── chart init (runs once) ────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: PALETTE.bg },
        textColor:  PALETTE.text,
      },
      grid: {
        vertLines: { color: PALETTE.grid },
        horzLines: { color: PALETTE.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: PALETTE.border },
      timeScale:       { borderColor: PALETTE.border, timeVisible: true, secondsVisible: false },
      width:  el.clientWidth,
      height: 480,
    });

    const series = chart.addCandlestickSeries({
      upColor:        PALETTE.bull,
      downColor:      PALETTE.bear,
      borderUpColor:  PALETTE.bull,
      borderDownColor: PALETTE.bear,
      wickUpColor:    PALETTE.bull,
      wickDownColor:  PALETTE.bear,
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    // keep chart width in sync with container
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // ── historical data load ──────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!seriesRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const klines = await fetchKlines(symbol, timeframe);
      seriesRef.current.setData(klines as CandlestickData[]);
      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── live WebSocket feed ────────────────────────────────────────────────────
  useEffect(() => {
    // close any previous connection first
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${timeframe}`;
    const ws    = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string);
        const k   = msg.k;
        if (!k || !seriesRef.current) return;

        const candle: CandlestickData = {
          time:  Math.floor(Number(k.t) / 1000) as UTCTimestamp,
          open:  parseFloat(k.o),
          high:  parseFloat(k.h),
          low:   parseFloat(k.l),
          close: parseFloat(k.c),
        };
        seriesRef.current.update(candle);
        setLivePrice(parseFloat(k.c));
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => setError("WebSocket connection failed — data may be delayed.");
    ws.onclose = (ev) => {
      // only show error if the close was unexpected
      if (!ev.wasClean && ev.code !== 1000) {
        setError("WebSocket closed unexpectedly.");
      }
    };

    return () => {
      ws.close(1000, "component unmount");
    };
  }, [symbol, timeframe]);

  // ─── render ────────────────────────────────────────────────────────────────

  const displayPrice = livePrice ?? null;

  return (
    <div className="flex flex-col gap-4">

      {/* ── toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Symbol dropdown */}
        <select
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value); setLivePrice(null); }}
          className="rounded-lg border border-[#1E3A6E] bg-[#0D1F3C] px-3 py-2 text-sm font-semibold text-white focus:border-[#2563EB] focus:outline-none cursor-pointer"
        >
          {FUTURES_SYMBOLS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Timeframe buttons */}
        <div className="flex overflow-hidden rounded-lg border border-[#1E3A6E]">
          {FUTURES_INTERVALS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setTimeframe(value)}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                timeframe === value
                  ? "bg-[#2563EB] text-white"
                  : "bg-[#0D1F3C] text-[#7BA8CC] hover:bg-[#1A3560] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Live price badge */}
        {displayPrice !== null && (
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-[#1E3A6E] bg-[#0D1F3C] px-3 py-2">
            <span className="text-xs text-[#7BA8CC]">{symbol}</span>
            <span className="font-mono text-sm font-bold text-white">
              {displayPrice.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: displayPrice > 1000 ? 2 : 6,
              })}
            </span>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          </div>
        )}
      </div>

      {/* ── chart container ──────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-xl border border-[#1E3A6E]">
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0A1428]/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-[#7BA8CC]">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
              <span className="text-sm">Loading chart data…</span>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {!loading && error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0A1428]/90">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => { setError(null); loadHistory(); }}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
            >
              Retry
            </button>
          </div>
        )}

        <div ref={containerRef} className="w-full" />
      </div>

      {/* ── data attribution ─────────────────────────────────────────────── */}
      <p className="text-right text-[11px] text-[#1E3A6E]">
        Data: Binance Futures — public market feed
      </p>
    </div>
  );
}
