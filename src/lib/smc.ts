import type { Candle } from "./forex";

export type ToolId = "orderBlocks" | "fvg" | "liquidity" | "bos" | "choch" | "poi" | "idm";

export type ZoneKind = "bullish" | "bearish" | "neutral";

export interface Zone {
  id: string;
  tool: ToolId;
  kind: ZoneKind;
  startIndex: number;
  endIndex: number;
  // box zones
  priceHigh?: number;
  priceLow?: number;
  // line zones
  price?: number;
  label: string;
  detail: string;
}

export interface ToolMeta {
  id: ToolId;
  name: string;
  short: string;
  color: string; // representative colour for legend / chip
  description: string;
  tier: "free" | "premium";
}

export const TOOLS: ToolMeta[] = [
  {
    id: "idm",
    name: "Inducement",
    short: "IDM",
    color: "#fb923c",
    tier: "free",
    description: "Minor liquidity swing used to lure traders before the real move.",
  },
  {
    id: "bos",
    name: "Break of Structure",
    short: "BOS",
    color: "#34d399",
    tier: "free",
    description: "Trend continuation break of a prior swing point.",
  },
  {
    id: "orderBlocks",
    name: "Order Blocks",
    short: "OB",
    color: "#38bdf8",
    tier: "premium",
    description: "Last opposing candle before an impulsive structure break.",
  },
  {
    id: "poi",
    name: "Points of Interest",
    short: "POI",
    color: "#ec4899",
    tier: "premium",
    description: "High-probability order blocks confluent with an FVG.",
  },
  {
    id: "liquidity",
    name: "Liquidity Zones",
    short: "LQ",
    color: "#f59e0b",
    tier: "premium",
    description: "Equal highs / lows resting liquidity (BSL & SSL).",
  },
  {
    id: "choch",
    name: "Change of Character",
    short: "CHoCH",
    color: "#facc15",
    tier: "premium",
    description: "First counter-trend break signalling a reversal.",
  },
  {
    id: "fvg",
    name: "Fair Value Gaps",
    short: "FVG",
    color: "#a78bfa",
    tier: "premium",
    description: "Three-candle imbalance where price left an inefficiency.",
  },
];

interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

function findSwings(candles: Candle[], span = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow) swings.push({ index: i, price: candles[i].low, type: "low" });
  }
  return swings.sort((a, b) => a.index - b.index);
}

function detectFVG(candles: Candle[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const a = candles[i - 1];
    const c = candles[i + 1];
    if (a.high < c.low) {
      zones.push({
        id: `fvg-${i}`,
        tool: "fvg",
        kind: "bullish",
        startIndex: i,
        endIndex: lastIndex,
        priceHigh: c.low,
        priceLow: a.high,
        label: "FVG",
        detail: "Bullish imbalance",
      });
    } else if (a.low > c.high) {
      zones.push({
        id: `fvg-${i}`,
        tool: "fvg",
        kind: "bearish",
        startIndex: i,
        endIndex: lastIndex,
        priceHigh: a.low,
        priceLow: c.high,
        label: "FVG",
        detail: "Bearish imbalance",
      });
    }
  }
  return zones.slice(-6);
}

interface StructureResult {
  bos: Zone[];
  choch: Zone[];
  obSeeds: { index: number; kind: ZoneKind; breakIndex: number }[];
}

function detectStructure(candles: Candle[], swings: Swing[]): StructureResult {
  const bos: Zone[] = [];
  const choch: Zone[] = [];
  const obSeeds: { index: number; kind: ZoneKind; breakIndex: number }[] = [];

  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let trend: "up" | "down" | null = null;

  const swingAt = (idx: number) => swings.filter((s) => s.index <= idx);

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const priorSwings = swingAt(i - 1);
    lastHigh = [...priorSwings].reverse().find((s) => s.type === "high") ?? lastHigh;
    lastLow = [...priorSwings].reverse().find((s) => s.type === "low") ?? lastLow;

    if (lastHigh && c.close > lastHigh.price) {
      const kind: ZoneKind = "bullish";
      const isChoch = trend === "down";
      const zone: Zone = {
        id: `${isChoch ? "choch" : "bos"}-b-${i}`,
        tool: isChoch ? "choch" : "bos",
        kind,
        startIndex: lastHigh.index,
        endIndex: i,
        price: lastHigh.price,
        label: isChoch ? "CHoCH" : "BOS",
        detail: isChoch ? "Bullish reversal" : "Bullish continuation",
      };
      (isChoch ? choch : bos).push(zone);
      obSeeds.push({ index: lastHigh.index, kind: "bullish", breakIndex: i });
      trend = "up";
      lastHigh = null;
    } else if (lastLow && c.close < lastLow.price) {
      const kind: ZoneKind = "bearish";
      const isChoch = trend === "up";
      const zone: Zone = {
        id: `${isChoch ? "choch" : "bos"}-s-${i}`,
        tool: isChoch ? "choch" : "bos",
        kind,
        startIndex: lastLow.index,
        endIndex: i,
        price: lastLow.price,
        label: isChoch ? "CHoCH" : "BOS",
        detail: isChoch ? "Bearish reversal" : "Bearish continuation",
      };
      (isChoch ? choch : bos).push(zone);
      obSeeds.push({ index: lastLow.index, kind: "bearish", breakIndex: i });
      trend = "down";
      lastLow = null;
    }
  }

  return { bos: bos.slice(-4), choch: choch.slice(-4), obSeeds };
}

function detectOrderBlocks(
  candles: Candle[],
  seeds: StructureResult["obSeeds"],
  lastIndex: number,
): Zone[] {
  const zones: Zone[] = [];
  for (const seed of seeds) {
    // find the last opposing candle before the break move
    let obIndex = -1;
    for (let i = seed.breakIndex - 1; i >= Math.max(0, seed.breakIndex - 12); i--) {
      const bearish = candles[i].close < candles[i].open;
      const bullish = candles[i].close > candles[i].open;
      if (seed.kind === "bullish" && bearish) {
        obIndex = i;
        break;
      }
      if (seed.kind === "bearish" && bullish) {
        obIndex = i;
        break;
      }
    }
    if (obIndex < 0) continue;
    const c = candles[obIndex];
    zones.push({
      id: `ob-${obIndex}`,
      tool: "orderBlocks",
      kind: seed.kind,
      startIndex: obIndex,
      endIndex: lastIndex,
      priceHigh: c.high,
      priceLow: c.low,
      label: seed.kind === "bullish" ? "Bull OB" : "Bear OB",
      detail: seed.kind === "bullish" ? "Demand order block" : "Supply order block",
    });
  }
  // dedupe by index, keep most recent
  const map = new Map<number, Zone>();
  for (const z of zones) map.set(z.startIndex, z);
  return Array.from(map.values()).slice(-5);
}

function detectLiquidity(candles: Candle[], swings: Swing[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  const tol =
    (candles.reduce((s, c) => s + (c.high - c.low), 0) / candles.length) * 0.35 || 0.0001;

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  const cluster = (points: Swing[], kind: "buy" | "sell") => {
    const used = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      const group = [points[i]];
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(points[j].price - points[i].price) <= tol) {
          group.push(points[j]);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        const price = group.reduce((s, g) => s + g.price, 0) / group.length;
        const start = Math.min(...group.map((g) => g.index));
        zones.push({
          id: `lq-${kind}-${start}`,
          tool: "liquidity",
          kind: kind === "buy" ? "bullish" : "bearish",
          startIndex: start,
          endIndex: lastIndex,
          price,
          label: kind === "buy" ? "BSL" : "SSL",
          detail: kind === "buy" ? "Buy-side liquidity" : "Sell-side liquidity",
        });
      }
    }
  };

  cluster(highs, "buy");
  cluster(lows, "sell");
  return zones.slice(-6);
}

function detectIDM(candles: Candle[], swings: Swing[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  // Bearish IDM: a swing high that sits below the previous swing high
  // (minor liquidity planted to lure buyers before a downward sweep)
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price < highs[i - 1].price) {
      zones.push({
        id: `idm-h-${highs[i].index}`,
        tool: "idm",
        kind: "bearish",
        startIndex: highs[i].index,
        endIndex: lastIndex,
        price: highs[i].price,
        label: "IDM",
        detail: "Bearish inducement — minor high below prior high",
      });
    }
  }

  // Bullish IDM: a swing low that sits above the previous swing low
  // (minor liquidity planted to lure sellers before an upward sweep)
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) {
      zones.push({
        id: `idm-l-${lows[i].index}`,
        tool: "idm",
        kind: "bullish",
        startIndex: lows[i].index,
        endIndex: lastIndex,
        price: lows[i].price,
        label: "IDM",
        detail: "Bullish inducement — minor low above prior low",
      });
    }
  }

  return zones
    .sort((a, b) => a.startIndex - b.startIndex)
    .slice(-6);
}

function detectPOI(orderBlocks: Zone[], fvgs: Zone[]): Zone[] {
  const zones: Zone[] = [];
  for (const ob of orderBlocks) {
    if (ob.priceHigh == null || ob.priceLow == null) continue;
    const overlap = fvgs.find(
      (f) =>
        f.priceHigh != null &&
        f.priceLow != null &&
        f.priceLow <= ob.priceHigh! &&
        f.priceHigh >= ob.priceLow!,
    );
    if (overlap) {
      zones.push({
        id: `poi-${ob.startIndex}`,
        tool: "poi",
        kind: ob.kind,
        startIndex: Math.min(ob.startIndex, overlap.startIndex),
        endIndex: ob.endIndex,
        priceHigh: Math.max(ob.priceHigh!, overlap.priceHigh!),
        priceLow: Math.min(ob.priceLow!, overlap.priceLow!),
        label: "POI",
        detail: "OB + FVG confluence",
      });
    }
  }
  return zones.slice(-4);
}

export interface AnalysisResult {
  orderBlocks: Zone[];
  fvg: Zone[];
  liquidity: Zone[];
  bos: Zone[];
  choch: Zone[];
  poi: Zone[];
  idm: Zone[];
}

export function analyze(candles: Candle[]): AnalysisResult {
  const empty: AnalysisResult = {
    orderBlocks: [],
    fvg: [],
    liquidity: [],
    bos: [],
    choch: [],
    poi: [],
    idm: [],
  };
  if (candles.length < 10) return empty;

  const lastIndex = candles.length - 1;
  const swings = findSwings(candles, 2);
  const fvg = detectFVG(candles, lastIndex);
  const structure = detectStructure(candles, swings);
  const orderBlocks = detectOrderBlocks(candles, structure.obSeeds, lastIndex);
  const liquidity = detectLiquidity(candles, swings, lastIndex);
  const poi = detectPOI(orderBlocks, fvg);
  const idm = detectIDM(candles, swings, lastIndex);

  return {
    orderBlocks,
    fvg,
    liquidity,
    bos: structure.bos,
    choch: structure.choch,
    poi,
    idm,
  };
}

export function zonesForTools(result: AnalysisResult, enabled: Set<ToolId>): Zone[] {
  const out: Zone[] = [];
  (Object.keys(result) as ToolId[]).forEach((k) => {
    if (enabled.has(k)) out.push(...result[k]);
  });
  return out;
}
