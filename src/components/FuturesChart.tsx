/**
 * FuturesChart — full trading-terminal panel for Binance crypto futures.
 *
 * Data source: Binance Futures public API (no key required)
 *   Klines REST:  https://fapi.binance.com/fapi/v1/klines
 *   Exchange info: https://fapi.binance.com/fapi/v1/exchangeInfo
 *   Live ticks WS: wss://fstream.binance.com/ws/<sym>@kline_<interval>
 *
 * SMC overlay: identical canvas approach to TradingChart.tsx — useLayoutEffect
 * for chart init, rAF loop + subscribeVisibleLogicalRangeChange for smooth
 * redraws, same BOS/CHoCH/IDM/OB/FVG/LQ/POI drawing routines.
 *
 * Self-contained — zero Forex code imported. Adding a Forex section later
 * requires no changes here.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";
import { Search } from "lucide-react";

import type { Candle } from "@/lib/forex";
import {
  TOOLS,
  type ToolId,
  type Zone,
  analyze,
  zonesForTools,
  detectAllBOS,
  detectVisibleIDM,
} from "@/lib/smc";

// ─── constants ────────────────────────────────────────────────────────────────

/** Shown immediately; replaced once exchangeInfo loads. */
const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "MATICUSDT", "LTCUSDT", "BCHUSDT", "UNIUSDT", "ATOMUSDT",
];

const INTERVALS = [
  { label: "1m",  value: "1m"  },
  { label: "5m",  value: "5m"  },
  { label: "15m", value: "15m" },
  { label: "1h",  value: "1h"  },
  { label: "4h",  value: "4h"  },
  { label: "1d",  value: "1d"  },
];

// ─── chart palette (matches site theme) ──────────────────────────────────────

const C = {
  bg:        "#0A1428",
  text:      "#a9b3c4",
  grid:      "rgba(43,52,68,0.55)",
  border:    "rgba(60,72,92,0.7)",
  bull:      "#26a69a",
  bear:      "#ef5350",
  crosshair: "rgba(148,163,184,0.5)",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const toolColor = (id: Zone["tool"]): string =>
  TOOLS.find((t) => t.id === id)?.color ?? "#38bdf8";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatLegendPrice(v: number): string {
  if (v > 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v > 1)    return v.toFixed(4);
  if (v > 0.01) return v.toFixed(6);
  return v.toFixed(8);
}

function formatLivePrice(v: number): string {
  if (v > 100) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v > 1)   return v.toFixed(4);
  return v.toFixed(6);
}

async function fetchKlines(symbol: string, interval: string): Promise<Candle[]> {
  // Use the server-side proxy to avoid browser geo-restrictions on fapi.binance.com
  const url = `/api/futures/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load chart data (${res.status})`);
  const rows = (await res.json()) as unknown[][];
  return rows.map((r) => ({
    time:  Math.floor(Number(r[0]) / 1000),
    open:  parseFloat(r[1] as string),
    high:  parseFloat(r[2] as string),
    low:   parseFloat(r[3] as string),
    close: parseFloat(r[4] as string),
  }));
}

// ─── component ────────────────────────────────────────────────────────────────

export function FuturesChart() {
  // ── DOM / chart refs ──────────────────────────────────────────────────────
  const containerRef   = useRef<HTMLDivElement>(null);
  const overlayRef     = useRef<HTMLCanvasElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const seriesRef      = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef          = useRef<WebSocket | null>(null);

  // Stable ref to the overlay draw function (refreshed each render)
  const drawOverlay    = useRef<() => void>(() => {});

  // Mutable refs for values read inside the overlay without triggering re-renders
  const candlesRef     = useRef<Candle[]>([]);
  const zonesRef       = useRef<Zone[]>([]);
  const enabledRef     = useRef<Set<ToolId>>(new Set<ToolId>());
  const liveCloseRef   = useRef<number | null>(null);
  const bosCacheRef    = useRef<{ key: string; result: ReturnType<typeof detectAllBOS> } | null>(null);
  const idmCacheRef    = useRef<{ key: string; result: Zone[] } | null>(null);

  // ── state ─────────────────────────────────────────────────────────────────
  const [allSymbols,   setAllSymbols]   = useState<string[]>(DEFAULT_SYMBOLS);
  const [query,        setQuery]        = useState("");
  const [symbol,       setSymbol]       = useState("BTCUSDT");
  const [timeframe,    setTimeframe]    = useState("1m");
  const [candles,      setCandles]      = useState<Candle[]>([]);
  const [livePrice,    setLivePrice]    = useState<number | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [retryKey,     setRetryKey]     = useState(0);
  const [enabledTools, setEnabledTools] = useState<Set<ToolId>>(
    () => new Set<ToolId>(["idm", "bos"]),
  );
  const [legend, setLegend] = useState<Candle | null>(null);

  // Keep mutable refs in sync with current state/values
  candlesRef.current = candles;
  enabledRef.current = enabledTools;

  // ── SMC zones (memoized — BOS/CHoCH drawn directly in overlay) ────────────
  const zones = useMemo<Zone[]>(() => {
    if (candles.length < 10) return [];
    const result = analyze(candles);
    // Exclude bos/choch from the zones array; the overlay draws them via
    // detectAllBOS so they remain live on pan/zoom without re-analyzing.
    return zonesForTools({ ...result, bos: [], choch: [] }, enabledTools);
  }, [candles, enabledTools]);
  zonesRef.current = zones;

  // ── overlay draw (updated each render via ref) ────────────────────────────
  drawOverlay.current = () => {
    const chart     = chartRef.current;
    const series    = seriesRef.current;
    const cvs       = overlayRef.current;
    const container = containerRef.current;
    if (!chart || !series || !cvs || !container) return;

    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    const dpr  = window.devicePixelRatio || 1;

    if (cvs.width !== cssW * dpr || cvs.height !== cssH * dpr) {
      cvs.width        = cssW * dpr;
      cvs.height       = cssH * dpr;
      cvs.style.width  = `${cssW}px`;
      cvs.style.height = `${cssH}px`;
    }

    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cs = candlesRef.current;
    if (cs.length === 0) return;

    const ts        = chart.timeScale();
    const paneRight = ts.width();
    const visRange  = ts.getVisibleLogicalRange();
    const visFrom   = visRange ? Math.floor(visRange.from) : 0;
    const visTo     = visRange ? Math.ceil(visRange.to)   : cs.length - 1;

    const xOf = (idx: number): number | null => {
      const i = Math.max(0, Math.min(cs.length - 1, idx));
      return ts.timeToCoordinate(cs[i].time as UTCTimestamp) ?? null;
    };
    const yOf = (price: number): number | null =>
      series.priceToCoordinate(price) ?? null;

    // ── IDM (visible-window scoped) ──────────────────────────────────────────
    const idmEnabled = enabledRef.current.has("idm");
    const last = cs[cs.length - 1];
    const idmKey = [cs.length, last?.time ?? 0, last?.close ?? 0, visFrom, visTo].join(":");
    if (idmEnabled && cs.length >= 15) {
      if (!idmCacheRef.current || idmCacheRef.current.key !== idmKey) {
        idmCacheRef.current = { key: idmKey, result: detectVisibleIDM(cs, visFrom, visTo) };
      }
    } else {
      idmCacheRef.current = null;
    }
    const visibleIDM = idmEnabled ? (idmCacheRef.current?.result ?? []) : [];

    // ── Non-BOS/CHoCH zones + IDM ────────────────────────────────────────────
    for (const z of [...zonesRef.current.filter((z) => z.tool !== "idm"), ...visibleIDM]) {
      const baseColor = toolColor(z.tool);
      const alpha     = z.tool === "idm" && z.swept ? 0.35 : 1;

      let x0 = xOf(z.startIndex);
      if (x0 == null) x0 = 0;
      const x1 = paneRight;

      if (z.priceHigh != null && z.priceLow != null) {
        // ── Box zone (OB, FVG, POI, LQ) ────────────────────────────────────
        const yh = yOf(z.priceHigh);
        const yl = yOf(z.priceLow);
        if (yh == null || yl == null) continue;
        const top = Math.min(yh, yl);
        const h   = Math.abs(yl - yh);
        ctx.fillStyle   = hexToRgba(baseColor, 0.1 * alpha);
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = hexToRgba(baseColor, 0.85 * alpha);
        ctx.lineWidth   = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h);
        ctx.fillStyle   = hexToRgba(baseColor, 0.95 * alpha);
        ctx.font        = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x0 + 4, top - 1 > 10 ? top - 1 : top + 11);
      } else if (z.price != null) {
        const y = yOf(z.price);
        if (y == null) continue;

        if (z.tool === "idm") {
          // ── IDM dashed line ────────────────────────────────────────────────
          const swept     = !!z.swept;
          const lineAlpha = swept ? 0.3 : 0.9;
          const fillAlpha = swept ? 0.35 : 0.95;
          const xRight    = swept && z.sweepIndex != null ? (xOf(z.sweepIndex) ?? x1) : x1;
          const lineStart = Math.max(0, x0);
          const lineEnd   = Math.max(lineStart, xRight);
          if (swept && lineEnd <= 0) continue;

          ctx.strokeStyle = hexToRgba(baseColor, lineAlpha);
          ctx.lineWidth   = 1.5;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(lineStart, y);
          ctx.lineTo(lineEnd, y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (x0 >= 0 && x0 <= x1) {
            ctx.fillStyle = hexToRgba(baseColor, fillAlpha);
            ctx.beginPath();
            ctx.arc(x0, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          const labelX = Math.max(4, Math.min(x0 + 8, x1 - 46));
          ctx.fillStyle   = hexToRgba(baseColor, fillAlpha);
          ctx.font        = "bold 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, labelX, y - 3);

        } else if (z.tool === "bos" || z.tool === "choch") {
          continue; // handled below via detectAllBOS
        } else {
          // ── Generic line zone (LQ) ─────────────────────────────────────────
          ctx.strokeStyle = hexToRgba(baseColor, 0.9 * alpha);
          ctx.lineWidth   = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle   = hexToRgba(baseColor, 0.95 * alpha);
          ctx.font        = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, x0 + 4, y - 2);
        }
      }
    }

    // ── BOS / CHoCH (full-history detection, visible-range filter) ───────────
    const bosEnabled   = enabledRef.current.has("bos");
    const chochEnabled = enabledRef.current.has("choch");

    if (cs.length >= 10 && (bosEnabled || chochEnabled)) {
      const cacheKey = `${cs.length}:${cs[cs.length - 1]?.time ?? 0}`;
      if (!bosCacheRef.current || bosCacheRef.current.key !== cacheKey) {
        bosCacheRef.current = { key: cacheKey, result: detectAllBOS(cs) };
      }
      const { bos: bosAll, choch: chochAll } = bosCacheRef.current.result;
      const visible: Zone[] = [];
      if (bosEnabled)   visible.push(...bosAll.filter((z)  => z.endIndex >= visFrom && z.startIndex <= visTo));
      if (chochEnabled) visible.push(...chochAll.filter((z) => z.endIndex >= visFrom && z.startIndex <= visTo));

      for (const z of visible) {
        if (z.price == null) continue;
        const y = yOf(z.price);
        if (y == null || y < -20 || y > cssH + 20) continue;

        const color  = toolColor(z.tool);
        const xSwing = xOf(z.startIndex);
        const xBreak = xOf(z.endIndex);
        const lineStart = xSwing != null ? Math.max(0, xSwing) : 0;
        const lineEnd   = xBreak != null ? Math.min(paneRight, xBreak) : paneRight;
        if (lineEnd <= 0 || lineStart >= paneRight) continue;

        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth   = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lineStart, y);
        ctx.lineTo(lineEnd, y);
        ctx.stroke();

        if (xSwing != null && xSwing >= 0 && xSwing <= paneRight) {
          ctx.fillStyle = hexToRgba(color, 0.95);
          ctx.beginPath();
          ctx.arc(xSwing, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        if (xBreak != null && xBreak >= 0 && xBreak <= paneRight) {
          const text  = z.label;
          ctx.font    = "bold 11px ui-sans-serif, system-ui, sans-serif";
          const tw    = ctx.measureText(text).width;
          const padX  = 6;
          const bW    = tw + padX * 2;
          const bH    = 18;
          const isBull = z.kind === "bullish";
          const bX    = Math.max(0, Math.min(xBreak - bW / 2, paneRight - bW));
          const bY    = isBull ? y - bH - 5 : y + 5;
          const r     = 3;

          ctx.fillStyle = hexToRgba(color, 0.92);
          ctx.beginPath();
          ctx.moveTo(bX + r, bY);
          ctx.lineTo(bX + bW - r, bY);
          ctx.quadraticCurveTo(bX + bW, bY, bX + bW, bY + r);
          ctx.lineTo(bX + bW, bY + bH - r);
          ctx.quadraticCurveTo(bX + bW, bY + bH, bX + bW - r, bY + bH);
          ctx.lineTo(bX + r, bY + bH);
          ctx.quadraticCurveTo(bX, bY + bH, bX, bY + bH - r);
          ctx.lineTo(bX, bY + r);
          ctx.quadraticCurveTo(bX, bY, bX + r, bY);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle   = "rgba(5,10,18,0.95)";
          ctx.textBaseline = "middle";
          ctx.fillText(text, bX + padX, bY + bH / 2 + 0.5);

          ctx.strokeStyle = hexToRgba(color, 0.5);
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(xBreak, y);
          ctx.lineTo(xBreak, isBull ? bY + bH : bY);
          ctx.stroke();
        }
      }
    }
  };

  // ── chart init — useLayoutEffect so the container is sized before createChart ──
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      localization: { locale: "en-US" },
      layout: {
        background:      { color: C.bg },
        textColor:       C.text,
        fontFamily:      "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode:     CrosshairMode.Normal,
        vertLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b2436" },
        horzLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b2436" },
      },
      rightPriceScale: {
        borderColor:  C.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor:    C.border,
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    6,
      },
      handleScroll: true,
      handleScale:  true,
      autoSize:     false,
    });

    const series = chart.addCandlestickSeries({
      upColor:          C.bull,
      downColor:        C.bear,
      borderUpColor:    C.bull,
      borderDownColor:  C.bear,
      wickUpColor:      C.bull,
      wickDownColor:    C.bear,
      priceLineVisible: true,
      priceLineColor:   "#2962ff",
      priceLineWidth:   1,
      lastValueVisible: false,
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    chart.resize(container.clientWidth, container.clientHeight);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) { chart.resize(w, h); drawOverlay.current(); }
    });
    ro.observe(container);

    const onRange = () => drawOverlay.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // rAF loop — detects price-scale shifts (lightweight-charts v4 has no
    // subscription for this), redraws overlay so BOS/IDM lines never drift.
    let rafId: number;
    let lastRafY: number | null | undefined = undefined;
    const rafLoop = () => {
      const s     = seriesRef.current;
      const close = liveCloseRef.current ?? candlesRef.current[candlesRef.current.length - 1]?.close;
      if (s && close != null) {
        const y = s.priceToCoordinate(close);
        if (y !== lastRafY) { lastRafY = y; drawOverlay.current(); }
      }
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) { setLegend(null); return; }
      const d = param.seriesData.get(series as ISeriesApi<"Candlestick">) as CandlestickData | undefined;
      if (!d) return;
      setLegend({ time: Number(param.time), open: d.open, high: d.high, low: d.low, close: d.close });
    });

    return () => {
      cancelAnimationFrame(rafId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // ── fetch all USDT perpetual pairs from Binance exchangeInfo ──────────────
  useEffect(() => {
    fetch("/api/futures/exchange-info")
      .then((r) => r.json())
      .then((data: {
        symbols: { symbol: string; status: string; contractType: string; quoteAsset: string }[];
      }) => {
        const syms = data.symbols
          .filter(
            (s) =>
              s.status === "TRADING" &&
              s.contractType === "PERPETUAL" &&
              s.quoteAsset === "USDT",
          )
          .map((s) => s.symbol)
          .sort();
        if (syms.length > 0) setAllSymbols(syms);
      })
      .catch(() => { /* keep DEFAULT_SYMBOLS */ });
  }, []);

  // ── load historical klines (re-runs on symbol / timeframe / retry change) ─
  useEffect(() => {
    const series = seriesRef.current;
    setLoading(true);
    setError(null);
    setLivePrice(null);
    liveCloseRef.current = null;
    // Clear the chart immediately so the old data doesn't flash
    if (series) series.setData([]);
    setCandles([]);

    let cancelled = false;
    fetchKlines(symbol, timeframe)
      .then((klines) => { if (!cancelled) setCandles(klines); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, retryKey]);

  // ── push candles to series whenever they change ───────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();
    drawOverlay.current();
  }, [candles]);

  // ── redraw overlay when zones or enabled tools change ────────────────────
  useEffect(() => { drawOverlay.current(); }, [zones, enabledTools]);

  // ── WebSocket live feed ───────────────────────────────────────────────────
  useEffect(() => {
    if (wsRef.current) { wsRef.current.close(1000, "symbol/tf change"); wsRef.current = null; }

    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${timeframe}`;
    const ws    = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as {
          k: { t: number; o: string; h: string; l: string; c: string; x: boolean };
        };
        const k = msg.k;
        if (!k) return;

        const close   = parseFloat(k.c);
        liveCloseRef.current = close;

        const candle: CandlestickData = {
          time:  Math.floor(k.t / 1000) as UTCTimestamp,
          open:  parseFloat(k.o),
          high:  parseFloat(k.h),
          low:   parseFloat(k.l),
          close,
        };

        seriesRef.current?.update(candle);
        setLivePrice(close);
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = () => setError("WebSocket connection failed — retrying…");
    ws.onclose = (ev) => {
      if (!ev.wasClean && ev.code !== 1000) setError("Live feed disconnected.");
    };

    return () => { ws.close(1000, "unmount"); };
  }, [symbol, timeframe]);

  // ── filtered / searched pair list ─────────────────────────────────────────
  const filteredSymbols = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? allSymbols.filter((s) => s.includes(q)) : allSymbols;
  }, [allSymbols, query]);

  // ── tool toggle ───────────────────────────────────────────────────────────
  const toggleTool = useCallback((id: ToolId) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">

      {/* ══ Pair sidebar (desktop) ═══════════════════════════════════════════ */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-[#1E3A6E] bg-[#091629] md:flex">
        <div className="p-3 pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7BA8CC]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pairs…"
              className="w-full rounded-md border border-[#1E3A6E] bg-[#0D1F3C] py-2 pl-8 pr-3 text-sm text-white outline-none placeholder:text-[#7BA8CC] focus:border-[#2563EB]"
            />
          </div>
          <div className="mt-1 text-[10px] text-[#1E3A6E]">
            {filteredSymbols.length} pair{filteredSymbols.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredSymbols.map((s) => {
            const active = s === symbol;
            return (
              <button
                key={s}
                onClick={() => { setSymbol(s); setQuery(""); }}
                className={`w-full border-l-2 px-4 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-[#2563EB] bg-[#1A3560] text-white"
                    : "border-transparent text-[#7BA8CC] hover:bg-[#0D1F3C] hover:text-white"
                }`}
              >
                <div className="truncate font-medium">{s}</div>
                {active && livePrice != null && (
                  <div className="mt-0.5 font-mono text-[11px] text-[#60A5FA]">
                    {formatLivePrice(livePrice)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ══ Main area ════════════════════════════════════════════════════════ */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1E3A6E] bg-[#091629] px-3 py-2">

          {/* Mobile: symbol search + dropdown */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7BA8CC]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-28 rounded-md border border-[#1E3A6E] bg-[#0D1F3C] py-1.5 pl-7 pr-2 text-xs text-white outline-none focus:border-[#2563EB]"
              />
            </div>
            <select
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value); setLivePrice(null); setQuery(""); }}
              className="rounded-md border border-[#1E3A6E] bg-[#0D1F3C] py-1.5 pr-6 pl-2 text-sm font-semibold text-white focus:border-[#2563EB] focus:outline-none"
            >
              {filteredSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Desktop: active symbol + live price */}
          <div className="hidden items-center gap-2 md:flex">
            <span className="text-sm font-bold text-white">{symbol}</span>
            {livePrice != null && (
              <>
                <span className="font-mono text-sm font-semibold text-[#60A5FA]">
                  {formatLivePrice(livePrice)}
                </span>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              </>
            )}
          </div>

          {/* Timeframe buttons */}
          <div className="flex overflow-hidden rounded-md border border-[#1E3A6E]">
            {INTERVALS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setTimeframe(value)}
                className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  timeframe === value
                    ? "bg-[#2563EB] text-white"
                    : "bg-[#0D1F3C] text-[#7BA8CC] hover:bg-[#1A3560] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* SMC tool toggles */}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {TOOLS.map((tool) => {
              const on = enabledTools.has(tool.id);
              return (
                <button
                  key={tool.id}
                  onClick={() => toggleTool(tool.id)}
                  title={`${tool.name} — ${tool.description}`}
                  style={
                    on
                      ? { borderColor: tool.color, color: tool.color, backgroundColor: `${tool.color}20` }
                      : {}
                  }
                  className={`rounded px-2 py-1 text-[11px] font-bold leading-none transition-all ${
                    on
                      ? "border"
                      : "border border-[#1E3A6E] text-[#7BA8CC] hover:border-[#2563EB] hover:text-white"
                  }`}
                >
                  {tool.short}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Chart + overlay ───────────────────────────────────────────────── */}
        <div className="relative min-h-0 flex-1">
          {/* lightweight-charts mounts here */}
          <div ref={containerRef} className="absolute inset-0" />

          {/* SMC overlay canvas — must sit above chart's internal canvases */}
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: 2 }}
          />

          {/* Crosshair OHLC legend */}
          {legend && (
            <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded-md bg-[#0A1428]/80 px-2.5 py-1 text-[11px] backdrop-blur-sm">
              {(["open", "high", "low", "close"] as const).map((k) => (
                <span key={k} className="text-[#7BA8CC]">
                  {k[0].toUpperCase()}{" "}
                  <span className="text-white">{formatLegendPrice(legend[k])}</span>
                </span>
              ))}
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0A1428]/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[#7BA8CC]">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
                <span className="text-sm">Loading {symbol}…</span>
              </div>
            </div>
          )}

          {/* Error overlay */}
          {!loading && error && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0A1428]/90">
              <p className="max-w-xs text-center text-sm text-red-400">{error}</p>
              <button
                onClick={() => { setError(null); setRetryKey((k) => k + 1); }}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* ── Attribution footer ────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-[#1E3A6E] bg-[#091629] px-3 py-1 text-right text-[10px] text-[#1E3A6E]">
          Data: Binance Futures — public market feed · {filteredSymbols.length} symbols loaded
        </div>
      </div>
    </div>
  );
}
