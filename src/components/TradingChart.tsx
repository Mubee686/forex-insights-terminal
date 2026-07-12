import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/forex";
import { formatPrice } from "@/lib/forex";
import type { Zone } from "@/lib/smc";

interface Props {
  candles: Candle[];
  zones: Zone[];
  digits: number;
  timeframeSeconds: number;
}

const PALETTE = {
  bull: "#22c55e",
  bear: "#ef4444",
  grid: "rgba(148,163,184,0.07)",
  axis: "rgba(148,163,184,0.65)",
  crosshair: "rgba(148,163,184,0.45)",
  livePrice: "#38f0d0",
  ob: { bullish: "rgba(56,189,248,0.14)", bearish: "rgba(56,189,248,0.14)" },
  obLine: "#38bdf8",
  fvg: { bullish: "rgba(167,139,250,0.16)", bearish: "rgba(167,139,250,0.16)" },
  fvgLine: "#a78bfa",
  poi: "rgba(236,72,153,0.16)",
  poiLine: "#ec4899",
  liq: "#f59e0b",
  bos: "#34d399",
  choch: "#facc15",
};

const PAD = { top: 16, right: 66, bottom: 26, left: 8 };
const ZOOM_FACTOR = 1.4;
const ZOOM_MIN = 20;

export function TradingChart({ candles, zones, digits, timeframeSeconds }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(280, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset zoom when candles array length changes (pair/timeframe switch)
  useEffect(() => {
    setVisibleCount(null);
  }, [candles.length]);

  const effectiveCount = Math.min(
    visibleCount ?? candles.length,
    candles.length,
  );

  const handleZoomIn = () => {
    setVisibleCount(Math.max(ZOOM_MIN, Math.round(effectiveCount / ZOOM_FACTOR)));
  };

  const handleZoomOut = () => {
    setVisibleCount(Math.min(candles.length, Math.round(effectiveCount * ZOOM_FACTOR)));
  };

  const canZoomIn = effectiveCount > ZOOM_MIN;
  const canZoomOut = effectiveCount < candles.length;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;

    // Slice to visible window (most recent candles)
    const count = Math.min(visibleCount ?? candles.length, candles.length);
    const offset = candles.length - count;
    const visibleCandles = candles.slice(offset);

    let hi = -Infinity;
    let lo = Infinity;
    for (const c of visibleCandles) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    const range = hi - lo || 1;
    hi += range * 0.06;
    lo -= range * 0.06;
    const span = hi - lo;

    const cw = plotW / visibleCandles.length;
    const bodyW = Math.max(1.5, Math.min(cw * 0.62, 14));

    const xOf = (i: number) => PAD.left + i * cw + cw / 2;
    const yOf = (p: number) => PAD.top + ((hi - p) / span) * plotH;

    ctx.font = "10px 'JetBrains Mono', monospace";

    // horizontal grid + price labels
    const gridLines = 6;
    for (let g = 0; g <= gridLines; g++) {
      const p = hi - (span * g) / gridLines;
      const y = yOf(p);
      ctx.strokeStyle = PALETTE.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = PALETTE.axis;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatPrice(p, digits), PAD.left + plotW + 6, y);
    }

    // vertical time labels
    const step = Math.max(1, Math.floor(visibleCandles.length / 7));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < visibleCandles.length; i += step) {
      const x = xOf(i);
      ctx.strokeStyle = PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH);
      ctx.stroke();
      const d = new Date(visibleCandles[i].time * 1000);
      const label =
        timeframeSeconds >= 86400
          ? `${d.getMonth() + 1}/${d.getDate()}`
          : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      ctx.fillStyle = PALETTE.axis;
      ctx.fillText(label, x, PAD.top + plotH + 6);
    }

    const rightX = PAD.left + plotW;

    // --- box zones (behind candles) ---
    // Adjust zone indices relative to visible window
    const boxZones = zones.filter((z) => {
      if (z.priceHigh == null || z.priceLow == null) return false;
      const adjEnd = z.endIndex - offset;
      return adjEnd >= 0;
    });
    for (const z of boxZones) {
      const adjStart = Math.max(0, z.startIndex - offset);
      const x1 = xOf(adjStart) - bodyW / 2;
      const yTop = yOf(z.priceHigh!);
      const yBot = yOf(z.priceLow!);
      const boxH = Math.max(2, yBot - yTop);
      let fill = PALETTE.fvg.bullish;
      let line = PALETTE.fvgLine;
      if (z.tool === "orderBlocks") {
        fill = PALETTE.ob.bullish;
        line = PALETTE.obLine;
      } else if (z.tool === "poi") {
        fill = PALETTE.poi;
        line = PALETTE.poiLine;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x1, yTop, rightX - x1, boxH);
      ctx.strokeStyle = line;
      ctx.lineWidth = z.tool === "poi" ? 1.4 : 1;
      ctx.setLineDash(z.tool === "poi" ? [4, 3] : []);
      ctx.strokeRect(x1, yTop, rightX - x1, boxH);
      ctx.setLineDash([]);
      ctx.fillStyle = line;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillText(z.label, x1 + 3, yTop - 1);
      ctx.font = "10px 'JetBrains Mono', monospace";
    }

    // --- candles ---
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const up = c.close >= c.open;
      const color = up ? PALETTE.bull : PALETTE.bear;
      const x = xOf(i);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.high));
      ctx.lineTo(x, yOf(c.low));
      ctx.stroke();
      const yO = yOf(c.open);
      const yC = yOf(c.close);
      const top = Math.min(yO, yC);
      const bh = Math.max(1, Math.abs(yC - yO));
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
    }

    // --- line zones (on top) ---
    const drawLine = (
      z: Zone,
      color: string,
      dash: number[],
      labelSide: "left" | "right",
    ) => {
      if (z.price == null) return;
      const adjStart = z.startIndex - offset;
      const adjEnd = z.endIndex - offset;
      if (adjEnd < 0) return;
      const y = yOf(z.price);
      const x1 = xOf(Math.max(0, adjStart));
      const x2 = z.tool === "liquidity" ? rightX : xOf(Math.min(visibleCandles.length - 1, adjEnd));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "9px 'JetBrains Mono', monospace";
      if (labelSide === "left") {
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x1 + 3, y - 2);
      } else {
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.label, x2 - 3, y - 2);
      }
      ctx.font = "10px 'JetBrains Mono', monospace";
    };

    zones
      .filter((z) => z.tool === "liquidity")
      .forEach((z) => drawLine(z, PALETTE.liq, [5, 4], "right"));
    zones
      .filter((z) => z.tool === "bos")
      .forEach((z) => drawLine(z, PALETTE.bos, [], "left"));
    zones
      .filter((z) => z.tool === "choch")
      .forEach((z) => drawLine(z, PALETTE.choch, [], "left"));

    // --- live price line ---
    const last = visibleCandles[visibleCandles.length - 1];
    const ly = yOf(last.close);
    ctx.strokeStyle = PALETTE.livePrice;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, ly);
    ctx.lineTo(rightX, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.livePrice;
    ctx.fillRect(rightX, ly - 8, PAD.right, 16);
    ctx.fillStyle = "#04201b";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillText(formatPrice(last.close, digits), rightX + 5, ly);

    // --- crosshair + tooltip ---
    const hv = hoverRef.current;
    if (hv && hv.x >= PAD.left && hv.x <= rightX) {
      const idx = Math.min(
        visibleCandles.length - 1,
        Math.max(0, Math.floor((hv.x - PAD.left) / cw)),
      );
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

      const c = visibleCandles[idx];
      const parts = [
        `O ${formatPrice(c.open, digits)}`,
        `H ${formatPrice(c.high, digits)}`,
        `L ${formatPrice(c.low, digits)}`,
        `C ${formatPrice(c.close, digits)}`,
      ];
      ctx.font = "10px 'JetBrains Mono', monospace";
      const tw = 128;
      const th = parts.length * 15 + 8;
      let bx = cx + 10;
      if (bx + tw > rightX) bx = cx - tw - 10;
      const by = PAD.top + 6;
      ctx.fillStyle = "rgba(15,20,30,0.92)";
      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.fillRect(bx, by, tw, th);
      ctx.strokeRect(bx, by, tw, th);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      parts.forEach((p, i) => {
        ctx.fillStyle = i === 3 ? (c.close >= c.open ? PALETTE.bull : PALETTE.bear) : PALETTE.axis;
        ctx.fillText(p, bx + 8, by + 6 + i * 15);
      });
    }
  }, [candles, zones, digits, size, timeframeSeconds, visibleCount]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          draw();
        }}
        onMouseLeave={() => {
          hoverRef.current = null;
          draw();
        }}
      />
      <div className="absolute bottom-8 right-[74px] flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          disabled={!canZoomIn}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800/90 text-slate-300 text-base font-bold transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          disabled={!canZoomOut}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800/90 text-slate-300 text-base font-bold transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom out"
        >
          −
        </button>
      </div>
    </div>
  );
}
