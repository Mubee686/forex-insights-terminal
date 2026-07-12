/**
 * TradingView-style canvas chart engine.
 *
 * Viewport model
 * ──────────────
 *   xOf(i) = rightX - offsetPx + (i - N + 0.5) * cw
 *
 *   cw        – pixels per candle (horizontal zoom)
 *   offsetPx  – pixels scrolled left from the right anchor (pan)
 *   yZoom     – price-range multiplier (1 = auto-fit, <1 zoom in, >1 zoom out)
 *   yOffset   – fractional vertical shift of the auto-fit centre
 *
 * Zoom centred on cursor X:
 *   ratio     = newCW / oldCW
 *   newOffset = (rightX - cursorX) × (1 – ratio) + oldOffset × ratio
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/forex";
import { formatPrice } from "@/lib/forex";
import type { Zone } from "@/lib/smc";

// ─── types ────────────────────────────────────────────────────────────────────

interface Props {
  candles: Candle[];
  zones: Zone[];
  digits: number;
  timeframeSeconds: number;
  isLoading?: boolean;
}

// ─── constants ────────────────────────────────────────────────────────────────

const PALETTE = {
  bg:         "#131722",
  bull:       "#26a69a",
  bear:       "#ef5350",
  grid:       "rgba(42,50,66,0.8)",
  axis:       "rgba(148,163,184,0.6)",
  crosshair:  "rgba(148,163,184,0.4)",
  xLabel:     "rgba(13,18,28,0.95)",
  livePrice:  "#2962ff",
  ob:         "rgba(56,189,248,0.10)",
  obLine:     "#38bdf8",
  fvg:        "rgba(167,139,250,0.10)",
  fvgLine:    "#a78bfa",
  poi:        "rgba(236,72,153,0.12)",
  poiLine:    "#ec4899",
  liq:        "#f59e0b",
  bos:        "#34d399",
  choch:      "#facc15",
  axisPanel:  "rgba(18,24,36,0.96)",
};

const PAD    = { top: 10, right: 72, bottom: 28, left: 0 } as const;
const CW_DEFAULT   = 9;
const CW_MIN       = 2;
const CW_MAX       = 80;
const MIN_VISIBLE  = 4;
const ZOOM_SPEED   = 0.0012;
const PRICE_AXIS_W = PAD.right;

// ─── helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function touchDist(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMidX(a: Touch, b: Touch) {
  return (a.clientX + b.clientX) / 2;
}

/** Format a candle timestamp for the crosshair X-label based on timeframe. */
function formatCandleTime(unixSec: number, tfSeconds: number): string {
  const d = new Date(unixSec * 1000);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (tfSeconds >= 2592000) {
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  if (tfSeconds >= 86400) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (tfSeconds >= 3600) {
    return `${mo}/${dy} ${hh}:${mm}`;
  }
  return `${mo}/${dy} ${hh}:${mm}`;
}

/** Format a candle time for the time-axis tick labels. */
function formatTickLabel(unixSec: number, tfSeconds: number): string {
  const d = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  if (tfSeconds >= 2592000) {
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  if (tfSeconds >= 604800) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (tfSeconds >= 86400) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (tfSeconds >= 3600) {
    if (d.getHours() === 0 && d.getMinutes() === 0) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return `${hh}:${mi}`;
  }
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return `${hh}:${mi}`;
}

// ─── component ────────────────────────────────────────────────────────────────

export function TradingChart({
  candles,
  zones,
  digits,
  timeframeSeconds,
  isLoading = false,
}: Props) {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });

  // ── viewport state (refs → no re-render on interaction) ───────────────────
  const cw        = useRef(CW_DEFAULT); // pixels per candle
  const offsetPx  = useRef(0);          // pixels scrolled left from right anchor
  const yZoom     = useRef(1.0);        // price range multiplier (1 = auto-fit)
  const yShift    = useRef(0.0);        // fractional shift of price centre

  // ── stable data refs (prevent stale closures in RAF callbacks) ────────────
  const rCandles = useRef(candles);      rCandles.current = candles;
  const rZones   = useRef(zones);        rZones.current   = zones;
  const rDigits  = useRef(digits);       rDigits.current  = digits;
  const rTf      = useRef(timeframeSeconds); rTf.current  = timeframeSeconds;
  const rSize    = useRef(size);         rSize.current    = size;
  const rLoading = useRef(isLoading);    rLoading.current = isLoading;

  // ── interaction state ─────────────────────────────────────────────────────
  const drag  = useRef<{ x: number; offset: number } | null>(null);
  const priceDrag = useRef<{
    y: number;
    startYZoom: number;
    startYShift: number;
  } | null>(null);
  const pinch = useRef<{
    dist: number;
    midX: number;
    startCW: number;
    startOffset: number;
  } | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const raf   = useRef<number | null>(null);

  // ─── RAF-gated draw ───────────────────────────────────────────────────────
  const scheduleDraw = useCallback(() => {
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      drawFrame();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── helpers ──────────────────────────────────────────────────────────────
  const maxOffset = useCallback(() => {
    const N = rCandles.current.length;
    return Math.max(0, (N - MIN_VISIBLE) * cw.current);
  }, []);

  const applyZoom = useCallback(
    (newCW: number, cursorX: number) => {
      const { w }  = rSize.current;
      const plotW  = w - PAD.left - PAD.right;
      const rightX = PAD.left + plotW;
      const oldCW  = cw.current;
      const ratio  = newCW / oldCW;
      cw.current   = newCW;
      offsetPx.current = clamp(
        (rightX - cursorX) * (1 - ratio) + offsetPx.current * ratio,
        0,
        maxOffset(),
      );
      scheduleDraw();
    },
    [maxOffset, scheduleDraw],
  );

  // ─── main draw ────────────────────────────────────────────────────────────
  function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = rSize.current;
    const dpr = window.devicePixelRatio || 1;
    const pw  = Math.round(w * dpr);
    const ph  = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width  = pw;
      canvas.height = ph;
    }
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, w, h);

    const plotW  = w - PAD.left - PAD.right;
    const plotH  = h - PAD.top - PAD.bottom;
    const rightX = PAD.left + plotW;

    if (rLoading.current || rCandles.current.length === 0) {
      drawSkeleton(ctx, w, h, plotW, plotH);
      return;
    }

    const allCandles = rCandles.current;
    const N  = allCandles.length;
    const cwV = cw.current;

    // clamp offset to valid range
    offsetPx.current = clamp(offsetPx.current, 0, maxOffset());
    const off = offsetPx.current;

    // candle-index ↔ x conversion
    const xOf = (i: number) => rightX - off + (i - N + 0.5) * cwV;

    // visible range (±2 candle margin)
    const visStart = clamp(Math.floor(N - 1 - (plotW + off) / cwV) - 2, 0, N - 1);
    const visEnd   = clamp(Math.ceil(N + off / cwV) + 2, 0, N - 1);

    // ── Y scale ─────────────────────────────────────────────────────────────
    let rawHi = -Infinity, rawLo = Infinity;
    for (let i = visStart; i <= visEnd; i++) {
      if (allCandles[i].high  > rawHi) rawHi = allCandles[i].high;
      if (allCandles[i].low   < rawLo) rawLo = allCandles[i].low;
    }
    const rawRange = rawHi - rawLo || rawHi * 0.001 || 1;
    // add padding
    rawHi += rawRange * 0.06;
    rawLo -= rawRange * 0.04;
    const autoRange = rawHi - rawLo;

    // apply price-axis zoom and shift
    const span     = autoRange * yZoom.current;
    const midPrice = (rawHi + rawLo) / 2 + yShift.current * autoRange;
    const hi = midPrice + span / 2;
    const lo = midPrice - span / 2;

    const yOf = (p: number) => PAD.top + ((hi - p) / span) * plotH;
    const dig  = rDigits.current;
    const tf   = rTf.current;

    // ── grid lines ──────────────────────────────────────────────────────────
    const gridRows = Math.max(4, Math.floor(plotH / 56));
    ctx.font      = "11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.lineWidth = 1;

    for (let g = 0; g <= gridRows; g++) {
      const p = hi - (span * g) / gridRows;
      const y = Math.round(yOf(p)) + 0.5;
      ctx.strokeStyle = PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(rightX, y);
      ctx.stroke();
      ctx.fillStyle   = PALETTE.axis;
      ctx.textAlign   = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatPrice(p, dig), rightX + 6, y);
    }

    // ── time axis ticks ─────────────────────────────────────────────────────
    const minTickGap = 72;
    const labelStep  = Math.max(1, Math.ceil(minTickGap / cwV));
    const firstLabel = Math.ceil(visStart / labelStep) * labelStep;
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";

    for (let i = firstLabel; i <= visEnd; i += labelStep) {
      const x = Math.round(xOf(i)) + 0.5;
      if (x < PAD.left || x > rightX) continue;
      ctx.strokeStyle = PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH + 4);
      ctx.stroke();
      ctx.fillStyle = PALETTE.axis;
      ctx.fillText(formatTickLabel(allCandles[i].time, tf), x, PAD.top + plotH + 6);
    }

    // ── price axis panel background ─────────────────────────────────────────
    ctx.fillStyle = PALETTE.axisPanel;
    ctx.fillRect(rightX, 0, PRICE_AXIS_W, h);

    // ── clip to plot area ────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH + 1);
    ctx.clip();

    const bodyW = clamp(Math.floor(cwV * 0.72), 1, 24);

    // ── box zones (behind candles) ────────────────────────────────────────
    for (const z of rZones.current) {
      if (z.priceHigh == null || z.priceLow == null) continue;
      const x1   = xOf(z.startIndex) - bodyW / 2;
      const yTop = yOf(z.priceHigh);
      const yBot = yOf(z.priceLow);
      const bh   = Math.max(2, yBot - yTop);

      let fill: string, stroke: string, dashed = false;
      if (z.tool === "orderBlocks") {
        fill = PALETTE.ob; stroke = PALETTE.obLine;
      } else if (z.tool === "poi") {
        fill = PALETTE.poi; stroke = PALETTE.poiLine; dashed = true;
      } else if (z.tool === "fvg") {
        fill = PALETTE.fvg; stroke = PALETTE.fvgLine;
      } else {
        continue;
      }

      ctx.fillStyle   = fill;
      ctx.fillRect(x1, yTop, rightX - x1, bh);
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = dashed ? 1.2 : 1;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, yTop, rightX - x1, bh);
      ctx.setLineDash([]);

      ctx.fillStyle    = stroke;
      ctx.textAlign    = "left";
      ctx.textBaseline = "bottom";
      ctx.font = "9px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      ctx.fillText(z.label, Math.max(PAD.left + 2, x1 + 3), yTop - 1);
      ctx.font = "11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    }

    // ── candles ───────────────────────────────────────────────────────────
    for (let i = visStart; i <= visEnd; i++) {
      const c  = allCandles[i];
      const x  = Math.round(xOf(i));
      const up = c.close >= c.open;
      const col = up ? PALETTE.bull : PALETTE.bear;

      const yH = yOf(c.high);
      const yL = yOf(c.low);
      const yO = yOf(c.open);
      const yC = yOf(c.close);
      const top = Math.min(yO, yC);
      const bh2 = Math.max(1, Math.abs(yC - yO));

      // wick
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, yH);
      ctx.lineTo(x + 0.5, yL);
      ctx.stroke();

      // body
      ctx.fillStyle = col;
      const bx = Math.round(x - bodyW / 2);
      ctx.fillRect(bx, top, bodyW, bh2);

      // hollow body for bull candles when wide enough
      if (up && bodyW >= 5) {
        ctx.strokeStyle = col;
        ctx.lineWidth   = 1;
        // slight inner border to mimic TradingView
        ctx.strokeRect(bx + 0.5, top + 0.5, bodyW - 1, Math.max(bh2 - 1, 0));
      }
    }

    // ── line zones (on top of candles) ────────────────────────────────────
    for (const z of rZones.current) {
      let col: string, dash: number[], labelSide: "left" | "right";
      if (z.tool === "liquidity") {
        col = PALETTE.liq; dash = [5, 4]; labelSide = "right";
      } else if (z.tool === "bos") {
        col = PALETTE.bos; dash = []; labelSide = "left";
      } else if (z.tool === "choch") {
        col = PALETTE.choch; dash = []; labelSide = "left";
      } else {
        continue;
      }
      if (z.price == null) continue;

      const x1 = xOf(z.startIndex);
      const x2 = z.tool === "liquidity" ? rightX : xOf(z.endIndex);
      const y  = yOf(z.price);

      ctx.strokeStyle = col;
      ctx.lineWidth   = 1.3;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle    = col;
      ctx.font = "9px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      if (labelSide === "left") {
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x1 + 3, y - 2);
      } else {
        ctx.textAlign = "right"; ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x2 - 3, y - 2);
      }
    }

    ctx.restore(); // end plot clip

    // ── live price dashed line ────────────────────────────────────────────
    const last = allCandles[N - 1];
    const ly   = yOf(last.close);
    ctx.strokeStyle = PALETTE.livePrice;
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, ly);
    ctx.lineTo(rightX, ly);
    ctx.stroke();
    ctx.setLineDash([]);

    // live price badge
    const badgeW = PRICE_AXIS_W - 4;
    const badgeX = rightX + 2;
    ctx.fillStyle = PALETTE.livePrice;
    ctx.beginPath();
    ctx.roundRect(badgeX, ly - 9, badgeW, 18, 2);
    ctx.fill();
    ctx.fillStyle    = "#ffffff";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.fillText(formatPrice(last.close, dig), badgeX + badgeW / 2, ly);

    // ── crosshair ─────────────────────────────────────────────────────────
    const hv = hover.current;
    const inChart = hv &&
      hv.x >= PAD.left && hv.x <= rightX &&
      hv.y >= PAD.top  && hv.y <= PAD.top + plotH;

    if (hv && inChart) {
      const rawIdx = N - 0.5 - (rightX - hv.x - off) / cwV;
      const idx    = clamp(Math.round(rawIdx), visStart, visEnd);
      const cx     = Math.round(xOf(idx)) + 0.5;

      // crosshair lines
      ctx.strokeStyle = PALETTE.crosshair;
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, PAD.top);
      ctx.lineTo(cx, PAD.top + plotH);
      ctx.moveTo(PAD.left, hv.y);
      ctx.lineTo(rightX, hv.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // price label on Y axis
      const hoverPrice = hi - ((hv.y - PAD.top) / plotH) * span;
      ctx.fillStyle    = "#1a2332";
      ctx.beginPath();
      ctx.roundRect(rightX + 1, hv.y - 9, badgeW, 18, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(100,116,139,0.25)";
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.fillStyle    = "#e2e8f0";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      ctx.fillText(formatPrice(hoverPrice, dig), rightX + 1 + badgeW / 2, hv.y);

      // time label on X axis
      const c = allCandles[idx];
      if (c) {
        const timeStr = formatCandleTime(c.time, tf);
        ctx.font      = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        const tw      = ctx.measureText(timeStr).width;
        const lx      = clamp(cx - tw / 2 - 5, PAD.left, rightX - tw - 10);
        ctx.fillStyle = PALETTE.xLabel;
        ctx.beginPath();
        ctx.roundRect(lx, PAD.top + plotH + 2, tw + 10, 18, 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(100,116,139,0.25)";
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.fillStyle    = "#e2e8f0";
        ctx.textAlign    = "left";
        ctx.textBaseline = "top";
        ctx.fillText(timeStr, lx + 5, PAD.top + plotH + 5);

        // OHLC tooltip
        const isUp = c.close >= c.open;
        const lines = [
          { label: "O", val: formatPrice(c.open,  dig), col: PALETTE.axis },
          { label: "H", val: formatPrice(c.high,  dig), col: PALETTE.axis },
          { label: "L", val: formatPrice(c.low,   dig), col: PALETTE.axis },
          { label: "C", val: formatPrice(c.close, dig), col: isUp ? PALETTE.bull : PALETTE.bear },
        ];
        const tipW = 148;
        const tipH = 76;
        let bx2 = cx + 14;
        if (bx2 + tipW > rightX - 4) bx2 = cx - tipW - 14;
        const by = PAD.top + 10;
        ctx.fillStyle   = "rgba(13,18,28,0.95)";
        ctx.strokeStyle = "rgba(100,116,139,0.2)";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.roundRect(bx2, by, tipW, tipH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        ctx.textBaseline = "top";
        lines.forEach(({ label, val, col }, i2) => {
          ctx.fillStyle = "rgba(100,116,139,0.65)";
          ctx.textAlign = "left";
          ctx.fillText(label, bx2 + 10, by + 10 + i2 * 14);
          ctx.fillStyle = col;
          ctx.textAlign = "right";
          ctx.fillText(val, bx2 + tipW - 10, by + 10 + i2 * 14);
        });
      }
    }
  }

  // ── skeleton ──────────────────────────────────────────────────────────────
  function drawSkeleton(
    ctx: CanvasRenderingContext2D,
    w: number, h: number, plotW: number, plotH: number,
  ) {
    const skCW = 12, gap = 4;
    const count = Math.floor(plotW / (skCW + gap));
    const base  = PAD.top + plotH * 0.55;
    for (let i = 0; i < count; i++) {
      const x     = PAD.left + i * (skCW + gap) + skCW / 2;
      const bodyH = 15 + Math.abs(Math.sin(i * 0.65 + 1)) * 40 + Math.cos(i * 0.3) * 15;
      const y     = base - bodyH / 2 + Math.sin(i * 0.42) * 18;
      const wickH = bodyH * 0.4;
      ctx.fillStyle = "rgba(148,163,184,0.07)";
      ctx.fillRect(x - skCW / 2, y, skCW, Math.max(3, bodyH));
      ctx.fillRect(x - 0.5, y - wickH, 1, wickH);
      ctx.fillRect(x - 0.5, y + Math.max(3, bodyH), 1, wickH);
    }
    ctx.fillStyle    = "rgba(148,163,184,0.3)";
    ctx.font         = "12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Loading…", w / 2, h / 2);
  }

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(240, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── redraw on data / size change ─────────────────────────────────────────
  useEffect(() => {
    scheduleDraw();
  }, [candles, zones, size, isLoading, scheduleDraw]);

  // ── non-passive wheel handler ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect    = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const { w }   = rSize.current;
      const plotW   = w - PAD.left - PAD.right;
      const rightX  = PAD.left + plotW;

      const onPriceAxis = cursorX > rightX;

      if (onPriceAxis) {
        // wheel over price axis → vertical scale zoom
        const delta = e.deltaY * 0.003;
        yZoom.current = clamp(yZoom.current * (1 + delta), 0.05, 20);
        scheduleDraw();
        return;
      }

      // Over chart area: horizontal swipe = pan, everything else = zoom
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isPan = absX > absY && absX > 3;

      if (isPan) {
        offsetPx.current = clamp(offsetPx.current + e.deltaX, 0, maxOffset());
        scheduleDraw();
      } else {
        const sensitivity = e.ctrlKey || e.metaKey ? 1.0 : 0.65;
        const cwDelta = e.deltaY * sensitivity * ZOOM_SPEED * cw.current;
        const newCW   = clamp(cw.current - cwDelta, CW_MIN, CW_MAX);
        applyZoom(newCW, cursorX);
      }

      void cursorY;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoom, maxOffset, scheduleDraw]);

  // ── pointer / mouse events ────────────────────────────────────────────────

  /** Returns true if the canvas x coordinate is over the price axis. */
  const isOnPriceAxis = useCallback((clientX: number, rect: DOMRect) => {
    const { w } = rSize.current;
    const plotW  = w - PAD.left - PAD.right;
    const rightX = PAD.left + plotW;
    return (clientX - rect.left) > rightX;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

      if (isOnPriceAxis(e.clientX, rect)) {
        priceDrag.current = {
          y:          e.clientY,
          startYZoom: yZoom.current,
          startYShift: yShift.current,
        };
      } else {
        drag.current = { x: e.clientX, offset: offsetPx.current };
      }
    },
    [isOnPriceAxis],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x    = e.clientX - rect.left;
      const y    = e.clientY - rect.top;
      hover.current = { x, y };

      // price axis drag → vertical zoom
      if (priceDrag.current !== null && e.pointerType !== "touch") {
        const delta = e.clientY - priceDrag.current.y;
        yZoom.current = clamp(
          priceDrag.current.startYZoom * Math.exp(delta * 0.006),
          0.05, 20,
        );
      }

      // chart drag → horizontal pan
      if (drag.current !== null && e.pointerType !== "touch") {
        const delta = drag.current.x - e.clientX;
        offsetPx.current = clamp(drag.current.offset + delta, 0, maxOffset());
      }

      // update cursor
      const canvas = e.target as HTMLCanvasElement;
      if (priceDrag.current) {
        canvas.style.cursor = "ns-resize";
      } else if (isOnPriceAxis(e.clientX, rect)) {
        canvas.style.cursor = "ns-resize";
      } else if (drag.current) {
        canvas.style.cursor = "grabbing";
      } else {
        canvas.style.cursor = "crosshair";
      }

      scheduleDraw();
    },
    [maxOffset, scheduleDraw, isOnPriceAxis],
  );

  const onPointerUp = useCallback(() => {
    drag.current      = null;
    priceDrag.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
  }, []);

  const onPointerLeave = useCallback(() => {
    hover.current     = null;
    drag.current      = null;
    priceDrag.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  // ── touch events (pan + pinch zoom) ──────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      drag.current = { x: e.touches[0].clientX, offset: offsetPx.current };
      pinch.current = null;
    } else if (e.touches.length === 2) {
      drag.current = null;
      pinch.current = {
        dist:        touchDist(e.touches[0], e.touches[1]),
        midX:        touchMidX(e.touches[0], e.touches[1]),
        startCW:     cw.current,
        startOffset: offsetPx.current,
      };
    }
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();

      if (e.touches.length === 1 && drag.current) {
        const delta = drag.current.x - e.touches[0].clientX;
        offsetPx.current = clamp(drag.current.offset + delta, 0, maxOffset());
        hover.current = {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      } else if (e.touches.length === 2 && pinch.current) {
        const dist  = touchDist(e.touches[0], e.touches[1]);
        const ratio = dist / pinch.current.dist;
        const newCW = clamp(pinch.current.startCW * ratio, CW_MIN, CW_MAX);
        const midX  = touchMidX(e.touches[0], e.touches[1]) - rect.left;
        const { w } = rSize.current;
        const rightX = PAD.left + (w - PAD.left - PAD.right);
        const oldCW  = cw.current;
        const r2     = newCW / oldCW;
        cw.current   = newCW;
        offsetPx.current = clamp(
          (rightX - midX) * (1 - r2) + offsetPx.current * r2,
          0, maxOffset(),
        );
      }
      scheduleDraw();
    },
    [maxOffset, scheduleDraw],
  );

  const onTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length < 2) pinch.current = null;
    if (e.touches.length === 0) { drag.current = null; hover.current = null; scheduleDraw(); }
  }, [scheduleDraw]);

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ cursor: "crosshair", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />
    </div>
  );
}
