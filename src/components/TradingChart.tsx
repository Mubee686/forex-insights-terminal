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
import { TOOLS, detectAllBOS, type Zone } from "@/lib/smc";

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
      lastValueVisible: false,
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
    lastValueVisible: false,
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
      const baseColor = toolColor(z.tool);
      // Swept IDM renders faded; everything else at full opacity
      const alpha = z.tool === "idm" && z.swept ? 0.35 : 1;
      const color = baseColor;

      let x0 = xOf(z.startIndex);
      if (x0 == null) x0 = 0;
      const x1 = paneRight;

      if (z.priceHigh != null && z.priceLow != null) {
        // ── Box zone (OB, FVG, POI, LQ) ──────────────────────────────────
        const yh = yOf(z.priceHigh);
        const yl = yOf(z.priceLow);
        if (yh == null || yl == null) continue;
        const top = Math.min(yh, yl);
        const h = Math.abs(yl - yh);
        ctx.fillStyle = hexToRgba(color, 0.1 * alpha);
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = hexToRgba(color, 0.85 * alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h);
        ctx.fillStyle = hexToRgba(color, 0.95 * alpha);
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x0 + 4, top - 1 > 10 ? top - 1 : top + 11);

      } else if (z.price != null) {
        const y = yOf(z.price);
        if (y == null) continue;

        if (z.tool === "idm") {
          // ── IDM: dashed horizontal price-level line ───────────────────────
          const swept = !!z.swept;
          const lineAlpha = swept ? 0.3 : 0.9;
          const fillAlpha = swept ? 0.35 : 0.95;

          // Right edge: end exactly at the sweep candle when mitigated,
          // otherwise extend to the live right edge of the chart.
          const xRight = swept && z.sweepIndex != null
            ? (xOf(z.sweepIndex) ?? x1)
            : x1;

          // Clamp line start to the canvas left boundary so the line never
          // extends into candles that predate the IDM formation.
          const lineStart = Math.max(0, x0);
          const lineEnd   = Math.max(lineStart, xRight);

          // Skip if the entire zone is scrolled off screen
          if (swept && lineEnd <= 0) continue;

          // Dashed horizontal line
          ctx.strokeStyle = hexToRgba(color, lineAlpha);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(lineStart, y);
          ctx.lineTo(lineEnd, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Filled circle anchoring the line at the IDM candle
          // (only when the candle is within the visible pane)
          if (x0 >= 0 && x0 <= x1) {
            ctx.fillStyle = hexToRgba(color, fillAlpha);
            ctx.beginPath();
            ctx.arc(x0, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }

          // Label: "IDM" (active) or "IDM ✓" (swept).
          // Pin label to IDM candle; clamp so it stays inside the visible pane.
          const labelX = Math.max(4, Math.min(x0 + 8, x1 - 46));
          ctx.fillStyle = hexToRgba(color, fillAlpha);
          ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, labelX, y - 3);

        } else if (z.tool === "bos" || z.tool === "choch") {
          // BOS / CHoCH are drawn dynamically below — skip here to avoid
          // double-drawing with the zones-prop (which may still carry them).
          continue;

        } else {
          // ── Generic line zone (LQ lines, etc.) ───────────────────────
          ctx.strokeStyle = hexToRgba(color, 0.9 * alpha);
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = hexToRgba(color, 0.95 * alpha);
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, x0 + 4, y - 2);
        }
      }
    }

    // ── Dynamic BOS / CHoCH: recomputed from the visible candle range ─────
    // We always run detection on ALL candles so trend context is correct, but
    // only draw zones whose line segment intersects the current viewport.
    if (cs.length >= 10) {
      const visRange = ts.getVisibleLogicalRange();
      const visFrom = visRange ? Math.floor(visRange.from) - 1 : 0;
      const visTo   = visRange ? Math.ceil(visRange.to)  + 1 : cs.length - 1;

      const { bos: bosAll, choch: chochAll } = detectAllBOS(cs);
      // Only show BOS/CHoCH whose tools are currently enabled
      const enabledTools = new Set(zonesRef.current.map((z) => z.tool));
      const bosEnabled   = enabledTools.has("bos");
      const chochEnabled = enabledTools.has("choch");

      // Collect enabled zones that cross the visible area
      const visibleBOS: Zone[] = [];
      if (bosEnabled)   visibleBOS.push(...bosAll.filter((z) => z.endIndex >= visFrom && z.startIndex <= visTo));
      if (chochEnabled) visibleBOS.push(...chochAll.filter((z) => z.endIndex >= visFrom && z.startIndex <= visTo));

      for (const z of visibleBOS) {
        if (z.price == null) continue;
        const y = yOf(z.price);
        if (y == null || y < -20 || y > cssH + 20) continue;

        const color = toolColor(z.tool);
        const xSwing = xOf(z.startIndex); // swing origin (left anchor)
        const xBreak = xOf(z.endIndex);   // break candle  (right anchor)

        // Clamp to canvas edges
        const lineStart = xSwing != null ? Math.max(0, xSwing) : 0;
        const lineEnd   = xBreak != null ? Math.min(paneRight, xBreak) : paneRight;
        if (lineEnd <= 0 || lineStart >= paneRight) continue;

        // ── Horizontal line from swing level to break candle ─────────────
        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth = 2.5;
        ctx.setLineDash([7, 4]);
        ctx.beginPath();
        ctx.moveTo(lineStart, y);
        ctx.lineTo(lineEnd, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── Circle at swing origin ────────────────────────────────────────
        if (xSwing != null && xSwing >= 0 && xSwing <= paneRight) {
          ctx.fillStyle = hexToRgba(color, 0.95);
          ctx.beginPath();
          ctx.arc(xSwing, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // ── Label badge at break candle ───────────────────────────────────
        if (xBreak != null && xBreak >= 0 && xBreak <= paneRight) {
          const labelText = z.label; // "BOS" or "CHoCH"
          ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
          const textW  = ctx.measureText(labelText).width;
          const padX   = 6;
          const badgeW = textW + padX * 2;
          const badgeH = 18;
          const isBull = z.kind === "bullish";
          // Centre badge on break candle; clamp so it stays inside the pane
          const badgeX = Math.max(0, Math.min(xBreak - badgeW / 2, paneRight - badgeW));
          const badgeY = isBull ? y - badgeH - 6 : y + 6;

          // Rounded rectangle badge
          const r = 3;
          ctx.fillStyle = hexToRgba(color, 0.92);
          ctx.beginPath();
          ctx.moveTo(badgeX + r, badgeY);
          ctx.lineTo(badgeX + badgeW - r, badgeY);
          ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + r);
          ctx.lineTo(badgeX + badgeW, badgeY + badgeH - r);
          ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - r, badgeY + badgeH);
          ctx.lineTo(badgeX + r, badgeY + badgeH);
          ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - r);
          ctx.lineTo(badgeX, badgeY + r);
          ctx.quadraticCurveTo(badgeX, badgeY, badgeX + r, badgeY);
          ctx.closePath();
          ctx.fill();

          // Badge text
          ctx.fillStyle = "rgba(5,10,18,0.95)";
          ctx.textBaseline = "middle";
          ctx.fillText(labelText, badgeX + padX, badgeY + badgeH / 2 + 0.5);

          // Vertical tick from line to badge
          ctx.strokeStyle = hexToRgba(color, 0.55);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xBreak, y);
          ctx.lineTo(xBreak, isBull ? badgeY + badgeH : badgeY);
          ctx.stroke();
        }
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
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }} />

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

      {/* Combined price + timer badge — one single element on the right axis */}
      {priceY != null && scaleWidth > 0 && candles.length > 0 && (
        <div
          className="pointer-events-none absolute z-10 overflow-hidden"
          style={{ top: priceY - 9, right: 0, width: scaleWidth - 6 }}
        >
          {/* Price row */}
          <div
            className="flex items-center justify-center py-[2px] text-[11px] font-medium tabular-nums text-white"
            style={{ background: "#2962ff" }}
          >
            {formatPrice(candles[candles.length - 1].close, digits)}
          </div>
          {/* Timer row */}
          {formattedTime && (
            <div className="flex items-center justify-center bg-[#1b2436] py-[2px] text-[11px] font-medium tabular-nums text-[#38bdf8]">
              {formattedTime}
            </div>
          )}
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
