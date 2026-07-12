export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ForexPair {
  symbol: string;
  name: string;
  base: number;
  pip: number;
  digits: number;
  vol: number;
}

export const FOREX_PAIRS: ForexPair[] = [
  { symbol: "EUR/USD", name: "Euro / US Dollar",    base: 1.085,  pip: 0.0001, digits: 5, vol: 1    },
  { symbol: "GBP/USD", name: "Pound / US Dollar",   base: 1.265,  pip: 0.0001, digits: 5, vol: 1.2  },
  { symbol: "USD/JPY", name: "US Dollar / Yen",      base: 156.2,  pip: 0.01,   digits: 3, vol: 1.1  },
  { symbol: "AUD/USD", name: "Aussie / US Dollar",   base: 0.662,  pip: 0.0001, digits: 5, vol: 1.15 },
  { symbol: "USD/CAD", name: "US Dollar / Loonie",   base: 1.372,  pip: 0.0001, digits: 5, vol: 1.05 },
  { symbol: "USD/CHF", name: "US Dollar / Franc",    base: 0.895,  pip: 0.0001, digits: 5, vol: 0.95 },
  { symbol: "NZD/USD", name: "Kiwi / US Dollar",     base: 0.608,  pip: 0.0001, digits: 5, vol: 1.25 },
  { symbol: "EUR/GBP", name: "Euro / Pound",         base: 0.857,  pip: 0.0001, digits: 5, vol: 0.85 },
  { symbol: "EUR/JPY", name: "Euro / Yen",           base: 169.5,  pip: 0.01,   digits: 3, vol: 1.3  },
  { symbol: "GBP/JPY", name: "Pound / Yen",          base: 197.8,  pip: 0.01,   digits: 3, vol: 1.6  },
  { symbol: "XAU/USD", name: "Gold / US Dollar",     base: 2350.0, pip: 0.1,    digits: 2, vol: 2.2  },
];

// ─── Timeframe ────────────────────────────────────────────────────────────────

export interface Timeframe {
  id: string;
  label: string;
  seconds: number;
  volMult: number;
  count: number;
  custom?: boolean;
}

export const DEFAULT_TIMEFRAMES: Timeframe[] = [
  { id: "1m",  label: "1m",  seconds: 60,      volMult: 0.25, count: 400 },
  { id: "5m",  label: "5m",  seconds: 300,     volMult: 0.5,  count: 400 },
  { id: "10m", label: "10m", seconds: 600,     volMult: 0.7,  count: 350 },
  { id: "15m", label: "15m", seconds: 900,     volMult: 0.9,  count: 350 },
  { id: "30m", label: "30m", seconds: 1800,    volMult: 1.1,  count: 300 },
  { id: "1h",  label: "1H",  seconds: 3600,    volMult: 1.4,  count: 300 },
  { id: "4h",  label: "4H",  seconds: 14400,   volMult: 2.4,  count: 250 },
  { id: "12h", label: "12H", seconds: 43200,   volMult: 3.2,  count: 200 },
  { id: "1d",  label: "1D",  seconds: 86400,   volMult: 4.5,  count: 200 },
  { id: "1w",  label: "1W",  seconds: 604800,  volMult: 8.0,  count: 100 },
  { id: "1M",  label: "1M",  seconds: 2592000, volMult: 14.0, count: 60  },
];

/**
 * Parse a custom timeframe string like "2h", "45m", "3d" into a Timeframe
 * object. Returns null for unrecognised formats.
 */
export function parseCustomTimeframe(id: string): Timeframe | null {
  const m = id.trim().match(/^(\d+)(m|h|d|w|M)$/);
  if (!m) return null;
  const n    = parseInt(m[1], 10);
  const unit = m[2] as "m" | "h" | "d" | "w" | "M";
  const secMap = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 } as const;
  const seconds = n * secMap[unit];
  if (seconds <= 0 || seconds > 365 * 86400) return null;

  // derive a sensible candle count from the timeframe length
  // target ~2 weeks of visible history by default
  const twoWeeks = 14 * 86400;
  const count    = Math.max(50, Math.min(500, Math.floor(twoWeeks / seconds)));

  const volMult  = Math.max(0.2, Math.min(20, seconds / 3600));
  const label    = unit === "M" ? `${n}Mo` : `${n}${unit.toUpperCase()}`;

  return { id, label, seconds, volMult, count, custom: true };
}

export function getPair(symbol: string): ForexPair {
  return FOREX_PAIRS.find((p) => p.symbol === symbol) ?? FOREX_PAIRS[0];
}

export function getTimeframe(id: string): Timeframe {
  const found = DEFAULT_TIMEFRAMES.find((t) => t.id === id);
  if (found) return found;
  return parseCustomTimeframe(id) ?? DEFAULT_TIMEFRAMES[3]; // fallback: 15m
}

export function formatPrice(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ─── Deterministic candle generator ──────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed  = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t     = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h  = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * Deterministic candle generator — produces a realistic random walk.
 * Works for any timeframe ID including custom ones.
 */
export function generateCandles(symbol: string, timeframeId: string): Candle[] {
  const pair = getPair(symbol);
  const tf   = getTimeframe(timeframeId);
  const rand = mulberry32(hashString(symbol + "|" + timeframeId));

  const step  = pair.base * 0.00045 * pair.vol * tf.volMult;
  const now   = Math.floor(Date.now() / 1000);
  const start = now - tf.seconds * (tf.count - 1);

  const candles: Candle[] = [];
  let price  = pair.base * (0.985 + rand() * 0.03);
  let drift  = (rand() - 0.5) * step * 0.4;
  let regime = 0;

  for (let i = 0; i < tf.count; i++) {
    if (regime <= 0) {
      drift  = (rand() - 0.5) * step * 0.9;
      regime = 8 + Math.floor(rand() * 22);
    }
    regime--;

    const open     = price;
    const noise    = (rand() - 0.5) * 2;
    const body     = drift + noise * step;
    let   close    = open + body;
    const wickUp   = rand() * step * 1.1;
    const wickDown = rand() * step * 1.1;
    const high     = Math.max(open, close) + wickUp;
    const low      = Math.min(open, close) - wickDown;

    if (close < pair.base * 0.9) close = open + Math.abs(body);
    if (close > pair.base * 1.1) close = open - Math.abs(body);

    candles.push({
      time:  start + i * tf.seconds,
      open:  round(open,  pair.digits),
      high:  round(high,  pair.digits),
      low:   round(low,   pair.digits),
      close: round(close, pair.digits),
    });
    price = close;
  }
  return candles;
}

/**
 * Simulate a live tick on the last (forming) candle; roll a new candle
 * when the timeframe interval elapses.
 */
export function applyTick(
  candles: Candle[],
  symbol: string,
  timeframeId: string,
): Candle[] {
  if (candles.length === 0) return candles;
  const pair = getPair(symbol);
  const tf   = getTimeframe(timeframeId);
  const step = pair.base * 0.00045 * pair.vol * tf.volMult;
  const tick = step * 0.18;

  const out  = candles.slice();
  const last = { ...out[out.length - 1] };
  const move = (Math.random() - 0.5) * 2 * tick;
  last.close = round(last.close + move, pair.digits);
  last.high  = round(Math.max(last.high, last.close), pair.digits);
  last.low   = round(Math.min(last.low,  last.close), pair.digits);

  const now = Math.floor(Date.now() / 1000);
  if (now - last.time >= tf.seconds) {
    out[out.length - 1] = last;
    const open = last.close;
    out.push({
      time:  last.time + tf.seconds,
      open,
      high:  round(open + Math.random() * tick, pair.digits),
      low:   round(open - Math.random() * tick, pair.digits),
      close: open,
    });
    if (out.length > tf.count + 40) out.shift();
  } else {
    out[out.length - 1] = last;
  }
  return out;
}

export function snapshotChange(symbol: string): number {
  const r = mulberry32(hashString(symbol + "|snap"))();
  return (r - 0.5) * 2.4;
}
