/**
 * TradingView-style chart powered by TradingView's own `lightweight-charts`
 * engine.  The chart instance is created ONCE and reused; only the candle data
 * is updated.  SMC zones are drawn on a synced overlay canvas on top of the
 * chart pane.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "@/lib/forex";
import { formatPrice } from "@/lib/forex";
import { TOOLS, type Zone } from "@/lib/smc";

interface Props {
  candles: Candle[];
  zones: Zone[];
  digits: number;
  /** Changes when symbol or timeframe changes → chart re-fits content. */
  resetKey: string;
  isLoading?: boolean;
}

// ─── chart palette (canvas library needs concrete colors) ────────────────────
const C = {
  bg: "#0e1117",
  text: "#a9b3c4",
  grid: "rgba(43,52,68,0.55)",
  border: "rgba(60,72,92,0.7)",
  bull: "#26a69a",
  bear: "#ef5350",
  crosshair: "rgba(148,163,184,0.5)",
};

const toolColor = (id: Zone["tool"]) =>
  TOOLS.find((t) => t.id === id)?.color ?? "#38bdf8";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function TradingChart({ candles, zones, digits, resetKey, isLoading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // latest data kept in refs so the overlay draw always sees current values
  const candlesRef = useRef<Candle[]>(candles);
  const zonesRef = useRef<Zone[]>(zones);
  const digitsRef = useRef<number>(digits);
  candlesRef.current = candles;
  zonesRef.current = zones;
  digitsRef.current = digits;

  const [legend, setLegend] = useState<Candle | null>(null);

  // ── overlay drawing ────────────────────────────────────────────────────────
  const drawOverlay = useRef<() => void>(() => {});
  drawOverlay.current = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const cvs = overlayRef.current;
    const container = containerRef.current;
    if (!chart || !series || !cvs || !container) return;

    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cvs.width !== cssW * dpr || cvs.height !== cssH * dpr) {
      cvs.width = cssW * dpr;
      cvs.height = cssH * dpr;
      cvs.style.width = `${cssW}px`;
      cvs.style.height = `${cssH}px`;
    }
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cs = candlesRef.current;
    if (cs.length === 0) return;

    const ts = chart.timeScale();
    const paneRight = ts.width();

    const xOf = (idx: number): number | null => {
      const i = Math.max(0, Math.min(cs.length - 1, idx));
      const t = cs[i].time as UTCTimestamp;
      const x = ts.timeToCoordinate(t);
      return x == null ? null : x;
    };
    const yOf = (price: number): number | null => {
      const y = series.priceToCoordinate(price);
      return y == null ? null : y;
    };

    for (const z of zonesRef.current) {
      const color = toolColor(z.tool);
      let x0 = xOf(z.startIndex);
      if (x0 == null) x0 = 0; // scrolled off left → clamp to pane edge
      const x1 = paneRight; // extend zones to the right like TradingView

      if (z.priceHigh != null && z.priceLow != null) {
        // Box zone (OB / FVG / POI)
        const yh = yOf(z.priceHigh);
        const yl = yOf(z.priceLow);
        if (yh == null || yl == null) continue;
        const top = Math.min(yh, yl);
        const h = Math.abs(yl - yh);
        ctx.fillStyle = hexToRgba(color, 0.1);
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = hexToRgba(color, 0.85);
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h);
        // label
        ctx.fillStyle = hexToRgba(color, 0.95);
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x0 + 4, top - 1 > 10 ? top - 1 : top + 11);
      } else if (z.price != null) {
        // Line zone (Liquidity / BOS / CHoCH)
        const y = yOf(z.price);
        if (y == null) continue;
        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hexToRgba(color, 0.95);
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x0 + 4, y - 2);
      }
    }
  };

  // ── create chart once ────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: C.bg },
        textColor: C.text,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b2436" },
        horzLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b2436" },
      },
      rightPriceScale: {
        borderColor: C.border,
        // TradingView-style dense price ladder that re-spaces on zoom
        scaleMargins: { top: 0.08, bottom: 0.08 },
        entireTextOnly: false,
        ticksVisible: true,
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      handleScroll: true,
      handleScale: true,
      autoSize: false,
    });

    const series = chart.addCandlestickSeries({
      upColor: C.bull,
      downColor: C.bear,
      borderUpColor: C.bull,
      borderDownColor: C.bear,
      wickUpColor: C.bull,
      wickDownColor: C.bear,
      priceLineVisible: true,
      priceLineColor: "#2962ff",
      priceLineWidth: 1,
      lastValueVisible: true,
      priceFormat: {
        type: "price",
        precision: digitsRef.current,
        minMove: 1 / Math.pow(10, digitsRef.current),
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Resize handling
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        chart.resize(w, h);
        drawOverlay.current();
      }
    });
    ro.observe(container);
    chart.resize(container.clientWidth, container.clientHeight);

    // Redraw overlay on any pan/zoom
    const onRange = () => drawOverlay.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // Crosshair OHLC legend
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        setLegend(null);
        return;
      }
      const d = param.seriesData.get(series) as CandlestickData | undefined;
      if (d) {
        setLegend({
          time: Number(param.time),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        });
      }
    });

    // Initial data
    if (candlesRef.current.length) {
      series.setData(mapData(candlesRef.current));
      chart.timeScale().fitContent();
      drawOverlay.current();
    }

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── update price format when digits change ──────────────────────────────────
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: {
        type: "price",
        precision: digits,
        minMove: 1 / Math.pow(10, digits),
      },
    });
  }, [digits]);

  // ── push new candle data (reuses the same series) ──────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(mapData(candles));
    drawOverlay.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  // ── re-fit when symbol / timeframe changes ─────────────────────────────────
  useEffect(() => {
    if (candles.length === 0) return;
    chartRef.current?.timeScale().fitContent();
    drawOverlay.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // ── redraw overlay when zones change ───────────────────────────────────────
  useEffect(() => {
    drawOverlay.current();
  }, [zones]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0"
      />

      {legend && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded-md bg-panel/80 px-2.5 py-1 text-[11px] backdrop-blur-sm">
          <span className="text-muted-foreground">O <span className="tabular text-foreground">{formatPrice(legend.open, digits)}</span></span>
          <span className="text-muted-foreground">H <span className="tabular text-foreground">{formatPrice(legend.high, digits)}</span></span>
          <span className="text-muted-foreground">L <span className="tabular text-foreground">{formatPrice(legend.low, digits)}</span></span>
          <span className="text-muted-foreground">C <span className="tabular text-foreground">{formatPrice(legend.close, digits)}</span></span>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/40 backdrop-blur-sm">
          <span className="text-sm text-muted-foreground">Loading market data…</span>
        </div>
      )}
    </div>
  );
}

function mapData(candles: Candle[]): CandlestickData[] {
  return candles.map((c) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}
