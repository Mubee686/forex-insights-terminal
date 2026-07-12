/**
 * TradingView-style canvas chart engine.
 *
 * Viewport model
 * ──────────────
 * xOf(i) = rightX - offsetPx + (i - totalCandles + 0.5) * cw
 *
 *   cw        – pixels per candle (zoom level)
 *   offsetPx  – pixels scrolled left from the right anchor (pan)
 *   rightX    – PAD.left + plotW (right edge of the plot area)
 *
 * At offsetPx=0 the latest candle centre sits half a candle-width from the
 * right edge.  Positive offsetPx scrolls the chart into history (leftward).
 *
 * Zoom centred on cursor
 * ──────────────────────
 * ratio     = newCW / oldCW
 * newOffset = (rightX - cursorX) × (1 - ratio) + oldOffset × ratio
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
  chartKey?: string;
}

// ─── constants ────────────────────────────────────────────────────────────────

const PALETTE = {
  bull: "#26a69a",
  bear: "#ef5350",
  grid: "rgba(42,50,66,0.75)",
  axis: "rgba(148,163,184,0.55)",
  crosshair: "rgba(148,163,184,0.35)",
  livePrice: "#2962ff",
  ob: "rgba(56,189,248,0.11)",
  obLine: "#38bdf8",
  fvg: "rgba(167,139,250,0.11)",
  fvgLine: "#a78bfa",
  poi: "rgba(236,72,153,0.13)",
  poiLine: "#ec4899",
  liq: "#f59e0b",
  bos: "#34d399",
  choch: "#facc15",
};

const PAD = { top: 20, right: 76, bottom: 32, left: 0 } as const;
const CW_DEFAULT = 9;
const CW_MIN = 2;
const CW_MAX = 80;
const MIN_VISIBLE = 6;
const ZOOM_SPEED = 0.0012;

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

// ─── component ────────────────────────────────────────────────────────────────

export function TradingChart({
  candles,
  zones,
  digits,
  timeframeSeconds,
  isLoading = false,
  chartKey = "",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });

  // ── viewport state (all refs → no re-render on pan/zoom) ──────────────────
  const cw = useRef(CW_DEFAULT);       // pixels per candle
  const offsetPx = useRef(0);          // pixels scrolled left

  // ── interaction state ────────────────────────────────────────────────────
  const drag = useRef<{ x: number; offset: number } | null>(null);
  const pinch = useRef<{
    dist: number;
    midX: number;
    startOffset: number;
    startCW: number;
  } | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef<number | null>(null);

  // ── stable refs for rendering (avoid stale closures) ─────────────────────
  const rCandles = useRef(candles);
  rCandles.current = candles;
  const rZones = useRef(zones);
  rZones.current = zones;
  const rDigits = useRef(digits);
  rDigits.current = digits;
  const rTf = useRef(timeframeSeconds);
  rTf.current = timeframeSeconds;
  const rSize = useRef(size);
  rSize.current = size;
  const rLoading = useRef(isLoading);
  rLoading.current = isLoading;

  // ── reset viewport when pair / timeframe changes ──────────────────────────
  const prevKey = useRef(chartKey);
  if (prevKey.current !== chartKey) {
    prevKey.current = chartKey;
    cw.current = CW_DEFAULT;
    offsetPx.current = 0;
  }

  // ── RAF-gated draw request ────────────────────────────────────────────────
  const scheduleDraw = useCallback(() => {
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      drawFrame();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── main draw function (reads only refs) ─────────────────────────────────
  function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = rSize.current;
    const dpr = window.devicePixelRatio || 1;
    const cw2 = Math.round(w * dpr);
    const ch2 = Math.round(h * dpr);
    if (canvas.width !== cw2 || canvas.height !== ch2) {
      canvas.width = cw2;
      canvas.height = ch2;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const rightX = PAD.left + plotW;

    if (rLoading.current || rCandles.current.length === 0) {
      drawSkeleton(ctx, w, h, plotW, plotH);
      return;
    }

    const allCandles = rCandles.current;
    const N = allCandles.length;
    const cwVal = cw.current;
    const off = offsetPx.current;

    // x-coordinate of candle at absolute index i
    const xOf = (i: number) =>
      rightX - off + (i - N + 0.5) * cwVal;

    // visible candle index range (with one extra candle of margin on each side)
    const visStart = clamp(
      Math.floor(N - 1.5 - plotW / cwVal + off / cwVal) - 1,
      0,
      N - 1,
    );
    const visEnd = clamp(
      Math.ceil(N + 0.5 + off / cwVal) + 1,
      0,
      N - 1,
    );

    // ── Y scale from visible candles ────────────────────────────────────────
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = visStart; i <= visEnd; i++) {
      const c = allCandles[i];
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    const priceRange = hi - lo || 1;
    hi += priceRange * 0.07;
    lo -= priceRange * 0.04;
    const span = hi - lo;

    const yOf = (p: number) => PAD.top + ((hi - p) / span) * plotH;
    const dig = rDigits.current;

    // ── grid ─────────────────────────────────────────────────────────────────
    const gridCount = Math.max(4, Math.floor(plotH / 60));
    ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.lineWidth = 1;
    for (let g = 0; g <= gridCount; g++) {
      const p = hi - (span * g) / gridCount;
      const y = yOf(p);
      ctx.strokeStyle = PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(rightX, y);
      ctx.stroke();
      ctx.fillStyle = PALETTE.axis;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatPrice(p, dig), rightX + 5, y);
    }

    // ── time axis ────────────────────────────────────────────────────────────
    const minLabelGap = 72;
    const labelStep = Math.max(1, Math.ceil(minLabelGap / cwVal));
    // align labels to neat multiples
    const firstLabel = Math.ceil(visStart / labelStep) * labelStep;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = firstLabel; i <= visEnd; i += labelStep) {
      const x = xOf(i);
      if (x < PAD.left - 1 || x > rightX + 1) continue;
      ctx.strokeStyle = PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH);
      ctx.stroke();
      const d = new Date(allCandles[i].time * 1000);
      const tf = rTf.current;
      const label =
        tf >= 86400
          ? `${d.getMonth() + 1}/${d.getDate()}`
          : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      ctx.fillStyle = PALETTE.axis;
      ctx.fillText(label, x, PAD.top + plotH + 6);
    }

    // ── clip to plot area ────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH + 1);
    ctx.clip();

    const bodyW = clamp(cwVal * 0.7, 1, 24);

    // ── box zones (behind candles) ───────────────────────────────────────────
    for (const z of rZones.current) {
      if (z.priceHigh == null || z.priceLow == null) continue;
      const x1 = xOf(z.startIndex) - bodyW / 2;
      const yTop = yOf(z.priceHigh);
      const yBot = yOf(z.priceLow);
      const bh = Math.max(2, yBot - yTop);

      let fill: string;
      let stroke: string;
      let dashed = false;
      if (z.tool === "orderBlocks") {
        fill = PALETTE.ob;
        stroke = PALETTE.obLine;
      } else if (z.tool === "poi") {
        fill = PALETTE.poi;
        stroke = PALETTE.poiLine;
        dashed = true;
      } else if (z.tool === "fvg") {
        fill = PALETTE.fvg;
        stroke = PALETTE.fvgLine;
      } else {
        continue;
      }

      ctx.fillStyle = fill;
      ctx.fillRect(x1, yTop, rightX - x1, bh);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = dashed ? 1.2 : 1;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, yTop, rightX - x1, bh);
      ctx.setLineDash([]);

      ctx.fillStyle = stroke;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.font = "9px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      ctx.fillText(z.label, Math.max(PAD.left + 2, x1 + 3), yTop - 1);
      ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    }

    // ── candles (only visible ones) ─────────────────────────────────────────
    for (let i = visStart; i <= visEnd; i++) {
      const c = allCandles[i];
      const x = xOf(i);
      const up = c.close >= c.open;
      const col = up ? PALETTE.bull : PALETTE.bear;
      const yH = yOf(c.high);
      const yL = yOf(c.low);
      const yO = yOf(c.open);
      const yC = yOf(c.close);
      const top = Math.min(yO, yC);
      const bh2 = Math.max(1, Math.abs(yC - yO));

      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh2);
    }

    // ── line zones (on top of candles) ──────────────────────────────────────
    for (const z of rZones.current) {
      let col: string;
      let dash: number[];
      let labelSide: "left" | "right";
      if (z.tool === "liquidity") {
        col = PALETTE.liq;
        dash = [5, 4];
        labelSide = "right";
      } else if (z.tool === "bos") {
        col = PALETTE.bos;
        dash = [];
        labelSide = "left";
      } else if (z.tool === "choch") {
        col = PALETTE.choch;
        dash = [];
        labelSide = "left";
      } else {
        continue;
      }
      if (z.price == null) continue;

      const x1 = xOf(z.startIndex);
      const x2 = z.tool === "liquidity" ? rightX : xOf(z.endIndex);
      const y = yOf(z.price);

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = col;
      ctx.font = "9px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      if (labelSide === "left") {
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x1 + 3, y - 2);
      } else {
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x2 - 3, y - 2);
      }
      ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    }

    ctx.restore(); // end plot clip

    // ── live price line (outside clip → reaches right axis) ─────────────────
    const lastCandle = allCandles[N - 1];
    const ly = yOf(lastCandle.close);
    ctx.strokeStyle = PALETTE.livePrice;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, ly);
    ctx.lineTo(rightX, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    // price badge on right axis
    const badgeW = PAD.right - 4;
    const badgeX = rightX + 2;
    ctx.fillStyle = PALETTE.livePrice;
    ctx.beginPath();
    ctx.roundRect(badgeX, ly - 9, badgeW, 18, 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.fillText(formatPrice(lastCandle.close, dig), badgeX + badgeW / 2, ly);

    // ── crosshair ────────────────────────────────────────────────────────────
    const hv = hover.current;
    if (hv && hv.x >= PAD.left && hv.x <= rightX && hv.y >= PAD.top && hv.y <= PAD.top + plotH) {
      // snap to nearest candle centre
      const rawIdx = N - 0.5 - (rightX - hv.x - off) / cwVal;
      const idx = clamp(Math.round(rawIdx), visStart, visEnd);
      const cx = xOf(idx);

      ctx.strokeStyle = PALETTE.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, PAD.top);
      ctx.lineTo(cx, PAD.top + plotH);
      ctx.moveTo(PAD.left, hv.y);
      ctx.lineTo(rightX, hv.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // y-axis price label
      const hoverPrice = hi - ((hv.y - PAD.top) / plotH) * span;
      ctx.fillStyle = "rgba(30,40,55,0.92)";
      ctx.beginPath();
      ctx.roundRect(rightX + 1, hv.y - 9, badgeW, 18, 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      ctx.fillText(formatPrice(hoverPrice, dig), rightX + 1 + badgeW / 2, hv.y);

      // OHLC tooltip
      const c = allCandles[idx];
      if (c) {
        const isUp = c.close >= c.open;
        const lines = [
          { label: "O", val: formatPrice(c.open, dig), col: PALETTE.axis },
          { label: "H", val: formatPrice(c.high, dig), col: PALETTE.axis },
          { label: "L", val: formatPrice(c.low, dig), col: PALETTE.axis },
          { label: "C", val: formatPrice(c.close, dig), col: isUp ? PALETTE.bull : PALETTE.bear },
        ];
        const tipW = 142;
        const tipH = 76;
        let bx = cx + 14;
        if (bx + tipW > rightX - 4) bx = cx - tipW - 14;
        const by = PAD.top + 8;
        ctx.fillStyle = "rgba(13,18,28,0.94)";
        ctx.strokeStyle = "rgba(100,116,139,0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, tipW, tipH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.font = "10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        ctx.textBaseline = "top";
        lines.forEach(({ label, val, col }, i) => {
          ctx.fillStyle = "rgba(100,116,139,0.7)";
          ctx.textAlign = "left";
          ctx.fillText(label, bx + 10, by + 9 + i * 15);
          ctx.fillStyle = col;
          ctx.textAlign = "right";
          ctx.fillText(val, bx + tipW - 10, by + 9 + i * 15);
        });
      }
    }
  }

  // ── skeleton screen ────────────────────────────────────────────────────────
  function drawSkeleton(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    plotW: number,
    plotH: number,
  ) {
    const skCW = 12;
    const gap = 4;
    const count = Math.floor(plotW / (skCW + gap));
    const base = PAD.top + plotH * 0.55;

    for (let i = 0; i < count; i++) {
      const x = PAD.left + i * (skCW + gap) + skCW / 2;
      const bodyH = 15 + Math.abs(Math.sin(i * 0.65 + 1)) * 40 + Math.cos(i * 0.3) * 15;
      const y = base - bodyH / 2 + Math.sin(i * 0.42) * 18;
      const wickH = bodyH * 0.4;
      ctx.fillStyle = "rgba(148,163,184,0.07)";
      ctx.fillRect(x - skCW / 2, y, skCW, Math.max(3, bodyH));
      ctx.fillRect(x - 0.5, y - wickH, 1, wickH);
      ctx.fillRect(x - 0.5, y + Math.max(3, bodyH), 1, wickH);
    }

    // subtle "Loading" label
    ctx.fillStyle = "rgba(148,163,184,0.35)";
    ctx.font = "12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Loading…", w / 2, h / 2);
  }

  // ── helpers for pan / zoom ─────────────────────────────────────────────────
  const maxOffset = useCallback(() => {
    const N = rCandles.current.length;
    return Math.max(0, (N - MIN_VISIBLE) * cw.current);
  }, []);

  const applyZoom = useCallback(
    (newCW: number, cursorX: number) => {
      const { w } = rSize.current;
      const plotW = w - PAD.left - PAD.right;
      const rightX = PAD.left + plotW;
      const oldCW = cw.current;
      const ratio = newCW / oldCW;
      cw.current = newCW;
      offsetPx.current = clamp(
        (rightX - cursorX) * (1 - ratio) + offsetPx.current * ratio,
        0,
        maxOffset(),
      );
      scheduleDraw();
    },
    [maxOffset, scheduleDraw],
  );

  // ── ResizeObserver ─────────────────────────────────────────────────────────
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

  // ── redraw whenever size or data changes ──────────────────────────────────
  useEffect(() => {
    scheduleDraw();
  }, [candles, zones, size, isLoading, scheduleDraw]);

  // ── non-passive wheel handler (must be added via addEventListener) ─────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;

      // Intent detection:
      //   horizontal trackpad swipe (|deltaX| > |deltaY|) → pan
      //   everything else (vertical scroll, ctrl/meta+scroll, mouse wheel) → zoom
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isPan = absX > absY && absX > 3;

      if (isPan) {
        offsetPx.current = clamp(offsetPx.current + e.deltaX, 0, maxOffset());
        scheduleDraw();
      } else {
        // ctrl/meta = macOS pinch-to-zoom (already scaled); plain = mouse wheel / trackpad scroll
        const sensitivity = e.ctrlKey || e.metaKey ? 1 : 0.6;
        const cwDelta = e.deltaY * sensitivity * ZOOM_SPEED * cw.current;
        const newCW = clamp(cw.current - cwDelta, CW_MIN, CW_MAX);
        applyZoom(newCW, cursorX);
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoom, maxOffset, scheduleDraw]);

  // ── pointer events (mouse drag for pan) ───────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") return; // handled via touch events
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, offset: offsetPx.current };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      hover.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (drag.current !== null && e.pointerType !== "touch") {
        const delta = drag.current.x - e.clientX;
        offsetPx.current = clamp(drag.current.offset + delta, 0, maxOffset());
      }
      scheduleDraw();
    },
    [maxOffset, scheduleDraw],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onPointerLeave = useCallback(() => {
    hover.current = null;
    drag.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  // ── touch events (pan + pinch-to-zoom) ────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      drag.current = { x: e.touches[0].clientX, offset: offsetPx.current };
      pinch.current = null;
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      drag.current = null;
      pinch.current = {
        dist: touchDist(t0, t1),
        midX: touchMidX(t0, t1),
        startOffset: offsetPx.current,
        startCW: cw.current,
      };
    }
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();

      if (e.touches.length === 1 && drag.current !== null) {
        const delta = drag.current.x - e.touches[0].clientX;
        offsetPx.current = clamp(drag.current.offset + delta, 0, maxOffset());
        hover.current = {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
        scheduleDraw();
      } else if (e.touches.length === 2 && pinch.current !== null) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = touchDist(t0, t1);
        const midX = touchMidX(t0, t1) - rect.left;
        const scale = dist / pinch.current.dist;
        const newCW = clamp(pinch.current.startCW * scale, CW_MIN, CW_MAX);

        const { w } = rSize.current;
        const plotW = w - PAD.left - PAD.right;
        const rightX = PAD.left + plotW;
        const ratio = newCW / pinch.current.startCW;

        cw.current = newCW;
        offsetPx.current = clamp(
          (rightX - midX) * (1 - ratio) + pinch.current.startOffset * ratio,
          0,
          maxOffset(),
        );
        scheduleDraw();
      }
    },
    [maxOffset, scheduleDraw],
  );

  const onTouchEnd = useCallback(() => {
    drag.current = null;
    pinch.current = null;
  }, []);

  // ── zoom button helpers ────────────────────────────────────────────────────
  const handleZoomBtn = useCallback(
    (direction: "in" | "out") => {
      const { w } = rSize.current;
      const plotW = w - PAD.left - PAD.right;
      const rightX = PAD.left + plotW;
      const cursorX = rightX - offsetPx.current; // anchor on latest candle
      const factor = direction === "in" ? 1.4 : 1 / 1.4;
      const newCW = clamp(cw.current * factor, CW_MIN, CW_MAX);
      applyZoom(newCW, cursorX);
    },
    [applyZoom],
  );

  const canZoomIn = cw.current < CW_MAX - 0.5;
  const canZoomOut = cw.current > CW_MIN + 0.5;

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ cursor: drag.current ? "grabbing" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {/* Zoom buttons */}
      <div className="absolute bottom-9 right-[80px] flex flex-col gap-1">
        <button
          onClick={() => handleZoomBtn("in")}
          disabled={!canZoomIn}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-600/70 bg-slate-800/90 text-base font-bold text-slate-300 backdrop-blur-sm transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => handleZoomBtn("out")}
          disabled={!canZoomOut}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-600/70 bg-slate-800/90 text-base font-bold text-slate-300 backdrop-blur-sm transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          title="Zoom out"
        >
          −
        </button>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-primary" />
            <span className="text-xs text-slate-500">Loading market data…</span>
          </div>
        </div>
      )}
    </div>
  );
}
