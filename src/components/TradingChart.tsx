/**
 * TradingView-style chart powered by lightweight-charts.
 *
 * Chart instance is created ONCE and reused.  Candle data is pushed via:
 *   series.setData()  — on full reloads (symbol/TF change, epoch fetch)
 *   series.update()   — on live price ticks (only last bar changes)
 *
 * This avoids visual wick flickering that happens when setData() is called
 * on every 15-second price poll.  SMC zones are drawn on a synced overlay
 * canvas sitting on top of the chart pane.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "@/lib/forex";
import { formatPrice } from "@/lib/forex";
import { TOOLS, type Zone } from "@/lib/smc";

export type ChartType = "candlestick" | "line";

interface Props {
  candles: Candle[];
  zones: Zone[];
  digits: number;
  /** Changes when symbol or timeframe changes → chart re-fits content. */
  resetKey: string;
  isLoading?: boolean;
  chartType?: ChartType;
  /** Candle countdown string from useCandleTimer, e.g. "04:37" */
  formattedTime?: string;
}

// ─── chart palette ───────────────────────────────────────────────────────────
const C = {
  bg: "#0e1117",
  text: "#a9b3c4",
  grid: "rgba(43,52,68,0.55)",
  border: "rgba(60,72,92,0.7)",
  bull: "#26a69a",
  bear: "#ef5350",
  crosshair: "rgba(148,163,184,0.5)",
};

const toolColor = (id: Zone["tool"]) => TOOLS.find((t) => t.id === id)?.color ?? "#38bdf8";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function toBar(c: Candle): CandlestickData {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function toLinePoint(c: Candle): LineData {
  return { time: c.time as UTCTimestamp, value: c.close };
}

function createSeriesForType(
  chart: IChartApi,
  type: ChartType,
  digits: number,
): ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> {
  const priceFormat = {
    type: "price" as const,
    precision: digits,
    minMove: 1 / Math.pow(10, digits),
  };

  if (type === "line") {
    return chart.addLineSeries({
      color: C.bull,
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: "#2962ff",
      priceLineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      priceFormat,
    });
  }

  return chart.addCandlestickSeries({
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
    priceFormat,
  });
}

function pushSeriesData(
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  type: ChartType,
  candles: Candle[],
) {
  if (type === "line") {
    (series as ISeriesApi<"Line">).setData(candles.map(toLinePoint));
  } else {
    (series as ISeriesApi<"Candlestick">).setData(candles.map(toBar));
  }
}

function updateSeriesLast(
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  type: ChartType,
  last: Candle,
) {
  if (type === "line") {
    (series as ISeriesApi<"Line">).update(toLinePoint(last));
  } else {
    (series as ISeriesApi<"Candlestick">).update(toBar(last));
  }
}

export function TradingChart({
  candles,
  zones,
  digits,
  resetKey,
  isLoading,
  chartType = "candlestick",
  formattedTime,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const seriesTypeRef = useRef<ChartType>(chartType);

  // Keep refs so overlay draw always sees current values
  const candlesRef = useRef<Candle[]>(candles);
  const zonesRef = useRef<Zone[]>(zones);
  const digitsRef = useRef<number>(digits);
  candlesRef.current = candles;
  zonesRef.current = zones;
  digitsRef.current = digits;

  // Track previous candles to decide setData vs update
  const prevCandlesRef = useRef<Candle[]>([]);

  const [legend, setLegend] = useState<Candle | null>(null);
  // Y-coordinate (px) of the current price on the chart, for timer placement
  const [priceY, setPriceY] = useState<number | null>(null);
  // Width of the right price scale, so timer badge exactly matches the price badge width
  const [scaleWidth, setScaleWidth] = useState<number>(0);

  // ── price-Y updater — called on every event that can shift the Y scale ──
  const updatePriceY = useRef<() => void>(() => {});
  updatePriceY.current = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const cs = candlesRef.current;
    if (!chart || !series || cs.length === 0) return;
    const lastClose = cs[cs.length - 1].close;
    const y = series.priceToCoordinate(lastClose);
    setPriceY(y ?? null);
    setScaleWidth(chart.priceScale("right").width());
  };

  // ── overlay drawing ───────────────────────────────────────────────────────
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
      if (x0 == null) x0 = 0;
      const x1 = paneRight;

      if (z.priceHigh != null && z.priceLow != null) {
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
        ctx.fillStyle = hexToRgba(color, 0.95);
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x0 + 4, top - 1 > 10 ? top - 1 : top + 11);
      } else if (z.price != null) {
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
      localization: { locale: "en-US" },
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
        vertLine: {
          color: C.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b2436",
        },
        horzLine: {
          color: C.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b2436",
        },
      },
      rightPriceScale: {
        borderColor: C.border,
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

    const series = createSeriesForType(chart, seriesTypeRef.current, digitsRef.current);

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        chart.resize(w, h);
        drawOverlay.current();
        updatePriceY.current();
      }
    });
    ro.observe(container);
    chart.resize(container.clientWidth, container.clientHeight);

    const onRange = () => { drawOverlay.current(); updatePriceY.current(); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // rAF loop — recalcs priceY every frame so vertical pan/zoom never
    // desynchronises the timer badge (no price-scale-change API in this lib version)
    let rafId: number;
    const rafLoop = () => {
      updatePriceY.current();
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        setLegend(null);
        return;
      }
      const raw = param.seriesData.get(series as ISeriesApi<"Candlestick" | "Line">);
      if (!raw) return;
      if (seriesTypeRef.current === "line") {
        const d = raw as LineData;
        setLegend({
          time: Number(param.time),
          open: d.value,
          high: d.value,
          low: d.value,
          close: d.value,
        });
      } else {
        const d = raw as CandlestickData;
        setLegend({
          time: Number(param.time),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        });
      }
    });

    if (candlesRef.current.length) {
      pushSeriesData(series, seriesTypeRef.current, candlesRef.current);
      prevCandlesRef.current = candlesRef.current;
      chart.timeScale().fitContent();
      drawOverlay.current();
    }

    return () => {
      cancelAnimationFrame(rafId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ── update price format when digits change ──────────────────────────────
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: {
        type: "price",
        precision: digits,
        minMove: 1 / Math.pow(10, digits),
      },
    });
  }, [digits]);

  // ── smart candle push: update() for live bar, setData() for full reload ──
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

    const prev = prevCandlesRef.current;
    const last = candles[candles.length - 1];
    const prevLast = prev[prev.length - 1];

    // Live update: same candle count and same last-bar timestamp → only OHLC changed
    if (prev.length > 0 && prev.length === candles.length && prevLast?.time === last?.time) {
      updateSeriesLast(series, seriesTypeRef.current, last);
    } else {
      // Full reload: candle count changed or first data
      pushSeriesData(series, seriesTypeRef.current, candles);
    }

    prevCandlesRef.current = candles;
    drawOverlay.current();
    updatePriceY.current();
  }, [candles]);

  // ── swap series type (candlestick ⇄ line) without recreating the chart ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || seriesTypeRef.current === chartType) return;

    if (seriesRef.current) chart.removeSeries(seriesRef.current);
    const series = createSeriesForType(chart, chartType, digitsRef.current);
    seriesRef.current = series;
    seriesTypeRef.current = chartType;

    if (candlesRef.current.length) {
      pushSeriesData(series, chartType, candlesRef.current);
      prevCandlesRef.current = candlesRef.current;
      chart.timeScale().fitContent();
    }
    drawOverlay.current();
  }, [chartType]);

  // ── re-fit + clear prev-ref when symbol / timeframe changes ────────────
  useEffect(() => {
    prevCandlesRef.current = [];
    if (candles.length === 0) return;
    chartRef.current?.timeScale().fitContent();
    drawOverlay.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // ── redraw overlay when zones change ───────────────────────────────────
  useEffect(() => {
    drawOverlay.current();
  }, [zones]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />

      {legend && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded-md bg-panel/80 px-2.5 py-1 text-[11px] backdrop-blur-sm">
          <span className="text-muted-foreground">
            O <span className="tabular text-foreground">{formatPrice(legend.open, digits)}</span>
          </span>
          <span className="text-muted-foreground">
            H <span className="tabular text-foreground">{formatPrice(legend.high, digits)}</span>
          </span>
          <span className="text-muted-foreground">
            L <span className="tabular text-foreground">{formatPrice(legend.low, digits)}</span>
          </span>
          <span className="text-muted-foreground">
            C <span className="tabular text-foreground">{formatPrice(legend.close, digits)}</span>
          </span>
        </div>
      )}

      {/* Candle countdown timer — sits flush below the price badge as one connected unit */}
      {formattedTime && priceY != null && scaleWidth > 0 && (
        <div
          className="pointer-events-none absolute z-10 flex items-center justify-center bg-[#1b2436] py-[2px] text-[11px] font-medium tabular-nums text-[#38bdf8]"
          style={{ top: priceY + 10, right: 0, width: scaleWidth - 6 }}
        >
          {formattedTime}
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col gap-2 bg-background/60 p-6 backdrop-blur-sm transition-smooth">
          <div className="skeleton h-6 w-40 rounded-md" />
          <div className="mt-auto flex items-end gap-1.5">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="skeleton flex-1 rounded-sm"
                style={{ height: `${20 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
