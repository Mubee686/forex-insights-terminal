/**
 * TradingView-style canvas chart engine.
 *
 * Viewport model
 * ──────────────
 *   xOf(i)  = rightX - offsetPx + (i - N + 0.5) × cw
 *
 *   cw       – pixels per candle  (horizontal zoom)
 *   offsetPx – pixels scrolled left from the right anchor  (pan)
 *   yZoom    – price-range multiplier  (1 = auto-fit, <1 zoom in, >1 zoom out)
 *   yShift   – fractional vertical shift of the auto-fit centre
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

// ─── palette  (TradingView dark theme) ────────────────────────────────────────

const P = {
  bg:        "#131722",
  bull:      "#26a69a",
  bear:      "#ef5350",
  grid:      "rgba(42,50,66,0.85)",
  axis:      "rgba(148,163,184,0.65)",
  crosshair: "rgba(148,163,184,0.45)",
  livePrice: "#2962ff",
  xLabelBg:  "rgba(13,18,28,0.96)",
  axisBg:    "rgba(18,24,36,0.97)",
  ob:        "rgba(56,189,248,0.09)",
  obLine:    "#38bdf8",
  fvg:       "rgba(167,139,250,0.09)",
  fvgLine:   "#a78bfa",
  poi:       "rgba(236,72,153,0.11)",
  poiLine:   "#ec4899",
  liq:       "#f59e0b",
  bos:       "#34d399",
  choch:     "#facc15",
};

// ─── layout constants ─────────────────────────────────────────────────────────

const PAD       = { top: 10, right: 70, bottom: 28, left: 0 } as const;
const CW_DEF    = 9;
const CW_MIN    = 2;
const CW_MAX    = 80;
const MIN_VIS   = 4;   // minimum visible candles before pan stops
const ZOOM_SPD  = 0.0012;

// ─── helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function touchDist(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMidX(a: Touch, b: Touch) {
  return (a.clientX + b.clientX) / 2;
}

/**
 * Returns a "nice" step value for grid ticks — produces round numbers
 * like 0.0001, 0.0002, 0.0005, 0.001 … so price levels always align cleanly.
 */
function niceStep(rawStep: number): number {
  if (rawStep <= 0) return 1;
  const mag  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  if (norm < 1.5) return mag;
  if (norm < 3)   return 2 * mag;
  if (norm < 7)   return 5 * mag;
  return 10 * mag;
}

/** Format a unix-second timestamp as a tick label for the time axis. */
function fmtTick(unixSec: number, tfSec: number): string {
  const d  = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const mo = d.getMonth() + 1;
  const dy = d.getDate();
  if (tfSec >= 2_592_000) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  if (tfSec >=   604_800) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (tfSec >=    86_400) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return `${mo}/${dy}`;
  return `${hh}:${mi}`;
}

/** Format a candle time for the crosshair label (more detail than a tick). */
function fmtCandleTime(unixSec: number, tfSec: number): string {
  const d  = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  const yr = d.getFullYear();
  if (tfSec >= 2_592_000) return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  if (tfSec >=    86_400) return `${mo}/${dy}/${yr}`;
  return `${mo}/${dy} ${hh}:${mi}`;
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

  // ── viewport (all refs → zero re-renders during interaction) ──────────────
  const cw      = useRef(CW_DEF);  // pixels per candle
  const offsetPx = useRef(0);       // pixels scrolled left from right anchor
  const yZoom   = useRef(1.0);      // price range multiplier
  const yShift  = useRef(0.0);      // fractional shift of the auto-fit centre

  // ── stable data refs ──────────────────────────────────────────────────────
  const rCandles = useRef(candles);      rCandles.current  = candles;
  const rZones   = useRef(zones);        rZones.current    = zones;
  const rDigits  = useRef(digits);       rDigits.current   = digits;
  const rTf      = useRef(timeframeSeconds); rTf.current   = timeframeSeconds;
  const rSize    = useRef(size);         rSize.current     = size;
  const rLoading = useRef(isLoading);    rLoading.current  = isLoading;

  // ── interaction state ─────────────────────────────────────────────────────
  const drag      = useRef<{ x: number; offset: number } | null>(null);
  const priceDrag = useRef<{ y: number; z0: number; s0: number } | null>(null);
  const pinch     = useRef<{
    dist: number; midX: number; cw0: number; off0: number;
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

  // ─── derived helpers ──────────────────────────────────────────────────────
  const maxOffset = useCallback(() => {
    return Math.max(0, (rCandles.current.length - MIN_VIS) * cw.current);
  }, []);

  const applyZoom = useCallback(
    (newCW: number, cursorX: number) => {
      const { w } = rSize.current;
      const rightX = PAD.left + w - PAD.left - PAD.right;
      const ratio  = newCW / cw.current;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, w, h);

    const plotW  = w - PAD.left - PAD.right;
    const plotH  = h - PAD.top  - PAD.bottom;
    const rightX = PAD.left + plotW;

    if (rLoading.current || rCandles.current.length === 0) {
      drawSkeleton(ctx, w, h, plotW, plotH);
      return;
    }

    const allC = rCandles.current;
    const N    = allC.length;
    const cwV  = cw.current;

    // clamp pan
    offsetPx.current = clamp(offsetPx.current, 0, maxOffset());
    const off = offsetPx.current;

    const xOf = (i: number) => rightX - off + (i - N + 0.5) * cwV;

    // visible range
    const visStart = clamp(Math.floor(N - 1 - (plotW + off) / cwV) - 2, 0, N - 1);
    const visEnd   = clamp(Math.ceil(N + off / cwV) + 2, 0, N - 1);

    // ── Y scale: auto-fit visible range ─────────────────────────────────────
    let rawHi = -Infinity, rawLo = Infinity;
    for (let i = visStart; i <= visEnd; i++) {
      if (allC[i].high > rawHi) rawHi = allC[i].high;
      if (allC[i].low  < rawLo) rawLo = allC[i].low;
    }
    const rawRange = rawHi - rawLo || rawHi * 0.001 || 1;
    rawHi += rawRange * 0.07;
    rawLo -= rawRange * 0.04;
    const autoRange = rawHi - rawLo;

    const span     = autoRange * yZoom.current;
    const midPrice = (rawHi + rawLo) / 2 + yShift.current * autoRange;
    const hi = midPrice + span / 2;
    const lo = midPrice - span / 2;

    const yOf = (p: number) => PAD.top + ((hi - p) / span) * plotH;
    const dig  = rDigits.current;
    const tf   = rTf.current;

    // ── nice price grid ──────────────────────────────────────────────────────
    const targetRows = Math.max(4, Math.floor(plotH / 52));
    const step       = niceStep(span / targetRows);
    const firstTick  = Math.ceil(lo / step) * step;

    ctx.lineWidth = 1;
    ctx.font = "11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

    for (let p = firstTick; p <= hi + step * 0.01; p += step) {
      const y = Math.round(yOf(p)) + 0.5;
      if (y < PAD.top - 1 || y > PAD.top + plotH + 1) continue;

      // grid line
      ctx.strokeStyle = P.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(rightX, y);
      ctx.stroke();

      // axis label (right of chart)
      ctx.fillStyle    = P.axis;
      ctx.textAlign    = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatPrice(p, dig), rightX + 6, y);
    }

    // ── time axis ────────────────────────────────────────────────────────────
    const minTickGapPx = 72;
    const labelStep    = Math.max(1, Math.ceil(minTickGapPx / cwV));
    const firstLabel   = Math.ceil(visStart / labelStep) * labelStep;

    ctx.textAlign    = "center";
    ctx.textBaseline = "top";

    for (let i = firstLabel; i <= visEnd; i += labelStep) {
      const x = Math.round(xOf(i)) + 0.5;
      if (x < PAD.left || x > rightX) continue;
      ctx.strokeStyle = P.grid;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH + 4);
      ctx.stroke();
      ctx.fillStyle = P.axis;
      ctx.fillText(fmtTick(allC[i].time, tf), x, PAD.top + plotH + 6);
    }

    // ── price-axis panel background ──────────────────────────────────────────
    ctx.fillStyle = P.axisBg;
    ctx.fillRect(rightX, 0, PAD.right, h);

    // ── clip to plot area ─────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH + 1);
    ctx.clip();

    const bodyW = clamp(Math.floor(cwV * 0.72), 1, 24);

    // ── box zones (behind candles) ────────────────────────────────────────────
    for (const z of rZones.current) {
      if (z.priceHigh == null || z.priceLow == null) continue;
      const x1   = xOf(z.startIndex) - bodyW / 2;
      const yTop = yOf(z.priceHigh);
      const yBot = yOf(z.priceLow);
      const bh   = Math.max(2, yBot - yTop);

      let fill: string, stroke: string, dashed = false;
      if (z.tool === "orderBlocks") { fill = P.ob;  stroke = P.obLine;  }
      else if (z.tool === "poi")    { fill = P.poi; stroke = P.poiLine; dashed = true; }
      else if (z.tool === "fvg")    { fill = P.fvg; stroke = P.fvgLine; }
      else continue;

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

    // ── candles ───────────────────────────────────────────────────────────────
    for (let i = visStart; i <= visEnd; i++) {
      const c   = allC[i];
      const cx  = Math.round(xOf(i));
      const up  = c.close >= c.open;
      const col = up ? P.bull : P.bear;

      const yH  = yOf(c.high);
      const yL  = yOf(c.low);
      const yO  = yOf(c.open);
      const yC  = yOf(c.close);
      const top = Math.min(yO, yC);
      const bh2 = Math.max(1, Math.abs(yC - yO));

      // wick
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, yH);
      ctx.lineTo(cx + 0.5, yL);
      ctx.stroke();

      // body
      const bx = Math.round(cx - bodyW / 2);
      ctx.fillStyle = col;
      ctx.fillRect(bx, top, bodyW, bh2);
    }

    // ── line zones (above candles) ────────────────────────────────────────────
    for (const z of rZones.current) {
      let col: string, dash: number[], side: "left" | "right";
      if      (z.tool === "liquidity") { col = P.liq;   dash = [5, 4]; side = "right"; }
      else if (z.tool === "bos")       { col = P.bos;   dash = [];     side = "left";  }
      else if (z.tool === "choch")     { col = P.choch; dash = [];     side = "left";  }
      else continue;
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
      if (side === "left") {
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x1 + 3, y - 2);
      } else {
        ctx.textAlign = "right"; ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x2 - 3, y - 2);
      }
    }

    ctx.restore(); // end plot clip

    // ── live price line ───────────────────────────────────────────────────────
    const last = allC[N - 1];
    const ly   = yOf(last.close);
    ctx.strokeStyle = P.livePrice;
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, ly);
    ctx.lineTo(rightX, ly);
    ctx.stroke();
    ctx.setLineDash([]);

    // price badge
    const bw = PAD.right - 4;
    const bx = rightX + 2;
    ctx.fillStyle = P.livePrice;
    ctx.beginPath();
    ctx.roundRect(bx, ly - 9, bw, 18, 2);
    ctx.fill();
    ctx.fillStyle    = "#fff";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.fillText(formatPrice(last.close, dig), bx + bw / 2, ly);

    // ── crosshair ─────────────────────────────────────────────────────────────
    const hv      = hover.current;
    const inChart = hv &&
      hv.x >= PAD.left && hv.x <= rightX &&
      hv.y >= PAD.top  && hv.y <= PAD.top + plotH;

    if (hv && inChart) {
      const rawIdx = N - 0.5 - (rightX - hv.x - off) / cwV;
      const idx    = clamp(Math.round(rawIdx), visStart, visEnd);
      const cx2    = Math.round(xOf(idx)) + 0.5;

      // lines
      ctx.strokeStyle = P.crosshair;
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx2, PAD.top);
      ctx.lineTo(cx2, PAD.top + plotH);
      ctx.moveTo(PAD.left, hv.y);
      ctx.lineTo(rightX, hv.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // price label on Y axis
      const hoverPrice = hi - ((hv.y - PAD.top) / plotH) * span;
      ctx.fillStyle   = "#1a2332";
      ctx.beginPath();
      ctx.roundRect(rightX + 1, hv.y - 9, bw, 18, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(100,116,139,0.2)";
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.fillStyle    = "#e2e8f0";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      ctx.fillText(formatPrice(hoverPrice, dig), rightX + 1 + bw / 2, hv.y);

      // time label on X axis
      const c = allC[idx];
      if (c) {
        const timeStr = fmtCandleTime(c.time, tf);
        ctx.font      = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        const tw      = ctx.measureText(timeStr).width;
        const lx      = clamp(cx2 - tw / 2 - 5, PAD.left, rightX - tw - 10);
        ctx.fillStyle = P.xLabelBg;
        ctx.beginPath();
        ctx.roundRect(lx, PAD.top + plotH + 2, tw + 10, 18, 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(100,116,139,0.2)";
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.fillStyle    = "#e2e8f0";
        ctx.textAlign    = "left";
        ctx.textBaseline = "top";
        ctx.fillText(timeStr, lx + 5, PAD.top + plotH + 5);

        // OHLC tooltip box
        const isUp = c.close >= c.open;
        const rows = [
          { l: "O", v: formatPrice(c.open,  dig), col: P.axis },
          { l: "H", v: formatPrice(c.high,  dig), col: P.axis },
          { l: "L", v: formatPrice(c.low,   dig), col: P.axis },
          { l: "C", v: formatPrice(c.close, dig), col: isUp ? P.bull : P.bear },
        ];
        const tW = 152, tH = 74;
        let tx = cx2 + 14;
        if (tx + tW > rightX - 4) tx = cx2 - tW - 14;
        const ty = PAD.top + 10;
        ctx.fillStyle   = "rgba(13,18,28,0.96)";
        ctx.strokeStyle = "rgba(100,116,139,0.18)";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tW, tH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        ctx.textBaseline = "top";
        rows.forEach(({ l, v, col }, ri) => {
          ctx.fillStyle = "rgba(100,116,139,0.6)";
          ctx.textAlign = "left";
          ctx.fillText(l, tx + 10, ty + 10 + ri * 13);
          ctx.fillStyle = col;
          ctx.textAlign = "right";
          ctx.fillText(v, tx + tW - 10, ty + 10 + ri * 13);
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
      ctx.fillStyle = "rgba(148,163,184,0.07)";
      ctx.fillRect(x - skCW / 2, y, skCW, Math.max(3, bodyH));
      ctx.fillRect(x - 0.5, y - bodyH * 0.4, 1, bodyH * 0.4);
      ctx.fillRect(x - 0.5, y + Math.max(3, bodyH), 1, bodyH * 0.4);
    }
    ctx.fillStyle    = "rgba(148,163,184,0.3)";
    ctx.font         = "13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
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

  // ── redraw on data / size change ──────────────────────────────────────────
  useEffect(() => { scheduleDraw(); }, [candles, zones, size, isLoading, scheduleDraw]);

  // ── non-passive wheel handler ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const cx     = e.clientX - rect.left;
      const { w }  = rSize.current;
      const rightX = PAD.left + w - PAD.left - PAD.right;

      // Over the price axis → vertical scale zoom
      if (cx > rightX) {
        yZoom.current = clamp(yZoom.current * (1 + e.deltaY * 0.003), 0.04, 20);
        scheduleDraw();
        return;
      }

      // Horizontal trackpad swipe → pan
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX > absY && absX > 3) {
        offsetPx.current = clamp(offsetPx.current + e.deltaX, 0, maxOffset());
        scheduleDraw();
        return;
      }

      // Vertical scroll / pinch (ctrl+wheel on macOS) → horizontal zoom
      const sensitivity = e.ctrlKey || e.metaKey ? 1.0 : 0.65;
      const delta = e.deltaY * sensitivity * ZOOM_SPD * cw.current;
      applyZoom(clamp(cw.current - delta, CW_MIN, CW_MAX), cx);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoom, maxOffset, scheduleDraw]);

  // ── pointer events ────────────────────────────────────────────────────────

  const isOnPriceAxis = useCallback((clientX: number, rect: DOMRect) => {
    const rightX = PAD.left + rSize.current.w - PAD.left - PAD.right;
    return (clientX - rect.left) > rightX;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      if (isOnPriceAxis(e.clientX, rect)) {
        priceDrag.current = { y: e.clientY, z0: yZoom.current, s0: yShift.current };
      } else {
        drag.current = { x: e.clientX, offset: offsetPx.current };
      }
    },
    [isOnPriceAxis],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      hover.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (priceDrag.current && e.pointerType !== "touch") {
        const delta = e.clientY - priceDrag.current.y;
        yZoom.current = clamp(
          priceDrag.current.z0 * Math.exp(delta * 0.006),
          0.04, 20,
        );
      } else if (drag.current && e.pointerType !== "touch") {
        offsetPx.current = clamp(
          drag.current.offset + (drag.current.x - e.clientX),
          0, maxOffset(),
        );
      }

      const canvas = e.target as HTMLCanvasElement;
      canvas.style.cursor =
        priceDrag.current ? "ns-resize" :
        isOnPriceAxis(e.clientX, rect) ? "ns-resize" :
        drag.current ? "grabbing" :
        "crosshair";

      scheduleDraw();
    },
    [maxOffset, scheduleDraw, isOnPriceAxis],
  );

  const onPointerUp = useCallback(() => {
    drag.current = priceDrag.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
  }, []);

  const onPointerLeave = useCallback(() => {
    hover.current = drag.current = priceDrag.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  /** Double-click on price axis resets Y zoom; anywhere else resets pan+zoom. */
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect   = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const rightX = PAD.left + rSize.current.w - PAD.left - PAD.right;
      if ((e.clientX - rect.left) > rightX) {
        // price axis → reset vertical zoom
        yZoom.current  = 1.0;
        yShift.current = 0.0;
      } else {
        // chart area → reset horizontal zoom + pan
        cw.current      = CW_DEF;
        offsetPx.current = 0;
      }
      scheduleDraw();
    },
    [scheduleDraw],
  );

  // ── touch events ──────────────────────────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      drag.current  = { x: e.touches[0].clientX, offset: offsetPx.current };
      pinch.current = null;
    } else if (e.touches.length === 2) {
      drag.current  = null;
      pinch.current = {
        dist: touchDist(e.touches[0], e.touches[1]),
        midX: touchMidX(e.touches[0], e.touches[1]),
        cw0:  cw.current,
        off0: offsetPx.current,
      };
    }
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();

      if (e.touches.length === 1 && drag.current) {
        offsetPx.current = clamp(
          drag.current.offset + (drag.current.x - e.touches[0].clientX),
          0, maxOffset(),
        );
        hover.current = {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      } else if (e.touches.length === 2 && pinch.current) {
        const dist  = touchDist(e.touches[0], e.touches[1]);
        const ratio = dist / pinch.current.dist;
        const newCW = clamp(pinch.current.cw0 * ratio, CW_MIN, CW_MAX);
        const midX  = touchMidX(e.touches[0], e.touches[1]) - rect.left;
        const rightX = PAD.left + rSize.current.w - PAD.left - PAD.right;
        const r2     = newCW / cw.current;
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

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (e.touches.length < 2) pinch.current = null;
      if (e.touches.length === 0) {
        drag.current  = null;
        hover.current = null;
        scheduleDraw();
      }
    },
    [scheduleDraw],
  );

  // ── render ────────────────────────────────────────────────────────────────
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
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />
    </div>
  );
}
