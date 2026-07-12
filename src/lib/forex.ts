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
  vol: number; // relative volatility
}

export const FOREX_PAIRS: ForexPair[] = [
  { symbol: "EUR/USD", name: "Euro / US Dollar", base: 1.085, pip: 0.0001, digits: 5, vol: 1 },
  { symbol: "GBP/USD", name: "Pound / US Dollar", base: 1.265, pip: 0.0001, digits: 5, vol: 1.2 },
  { symbol: "USD/JPY", name: "US Dollar / Yen", base: 156.2, pip: 0.01, digits: 3, vol: 1.1 },
  { symbol: "AUD/USD", name: "Aussie / US Dollar", base: 0.662, pip: 0.0001, digits: 5, vol: 1.15 },
  { symbol: "USD/CAD", name: "US Dollar / Loonie", base: 1.372, pip: 0.0001, digits: 5, vol: 1.05 },
  { symbol: "USD/CHF", name: "US Dollar / Franc", base: 0.895, pip: 0.0001, digits: 5, vol: 0.95 },
  { symbol: "NZD/USD", name: "Kiwi / US Dollar", base: 0.608, pip: 0.0001, digits: 5, vol: 1.25 },
  { symbol: "EUR/GBP", name: "Euro / Pound", base: 0.857, pip: 0.0001, digits: 5, vol: 0.85 },
  { symbol: "EUR/JPY", name: "Euro / Yen", base: 169.5, pip: 0.01, digits: 3, vol: 1.3 },
  { symbol: "GBP/JPY", name: "Pound / Yen", base: 197.8, pip: 0.01, digits: 3, vol: 1.6 },
  { symbol: "XAU/USD", name: "Gold / US Dollar", base: 2350.0, pip: 0.1, digits: 2, vol: 2.2 },
];

export interface Timeframe {
  id: string;
  label: string;
  seconds: number;
  volMult: number;
  count: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m", label: "1M", seconds: 60, volMult: 0.35, count: 140 },
  { id: "5m", label: "5M", seconds: 300, volMult: 0.6, count: 140 },
  { id: "15m", label: "15M", seconds: 900, volMult: 0.9, count: 150 },
  { id: "1h", label: "1H", seconds: 3600, volMult: 1.4, count: 150 },
  { id: "4h", label: "4H", seconds: 14400, volMult: 2.4, count: 140 },
  { id: "1d", label: "1D", seconds: 86400, volMult: 4.5, count: 120 },
];

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getPair(symbol: string): ForexPair {
  return FOREX_PAIRS.find((p) => p.symbol === symbol) ?? FOREX_PAIRS[0];
}

export function getTimeframe(id: string): Timeframe {
  return TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[2];
}

export function formatPrice(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Deterministic candle generator so switching pairs / timeframes is stable.
 * Produces a realistic random walk with trending regimes.
 */
export function generateCandles(symbol: string, timeframeId: string): Candle[] {
  const pair = getPair(symbol);
  const tf = getTimeframe(timeframeId);
  const rand = mulberry32(hashString(symbol + "|" + timeframeId));

  const step = pair.base * 0.00045 * pair.vol * tf.volMult;
  const now = Math.floor(Date.now() / 1000);
  const start = now - tf.seconds * (tf.count - 1);

  const candles: Candle[] = [];
  let price = pair.base * (0.985 + rand() * 0.03);
  let drift = (rand() - 0.5) * step * 0.4;
  let regime = 0;

  for (let i = 0; i < tf.count; i++) {
    // occasionally flip the trend regime
    if (regime <= 0) {
      drift = (rand() - 0.5) * step * 0.9;
      regime = 8 + Math.floor(rand() * 22);
    }
    regime--;

    const open = price;
    const noise = (rand() - 0.5) * 2;
    const body = drift + noise * step;
    let close = open + body;

    const wickUp = rand() * step * 1.1;
    const wickDown = rand() * step * 1.1;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;

    if (close < pair.base * 0.9) close = open + Math.abs(body);
    if (close > pair.base * 1.1) close = open - Math.abs(body);

    candles.push({
      time: start + i * tf.seconds,
      open: round(open, pair.digits),
      high: round(high, pair.digits),
      low: round(low, pair.digits),
      close: round(close, pair.digits),
    });
    price = close;
  }
  return candles;
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * Simulate a live tick: mutate the last (forming) candle and roll a new one
 * when the timeframe interval elapses.
 */
export function applyTick(candles: Candle[], symbol: string, timeframeId: string): Candle[] {
  if (candles.length === 0) return candles;
  const pair = getPair(symbol);
  const tf = getTimeframe(timeframeId);
  const step = pair.base * 0.00045 * pair.vol * tf.volMult;
  const tick = step * 0.18;

  const out = candles.slice();
  const last = { ...out[out.length - 1] };
  const move = (Math.random() - 0.5) * 2 * tick;
  last.close = round(last.close + move, pair.digits);
  last.high = round(Math.max(last.high, last.close), pair.digits);
  last.low = round(Math.min(last.low, last.close), pair.digits);

  const now = Math.floor(Date.now() / 1000);
  if (now - last.time >= tf.seconds) {
    out[out.length - 1] = last;
    const open = last.close;
    out.push({
      time: last.time + tf.seconds,
      open,
      high: round(open + Math.random() * tick, pair.digits),
      low: round(open - Math.random() * tick, pair.digits),
      close: open,
    });
    if (out.length > tf.count + 40) out.shift();
  } else {
    out[out.length - 1] = last;
  }
  return out;
}

/** Stable pseudo daily change for the pair list snapshot. */
export function snapshotChange(symbol: string): number {
  const r = mulberry32(hashString(symbol + "|snap"))();
  return (r - 0.5) * 2.4;
}
