/**
 * Timeframe model — client-safe (imported by both browser and server code).
 *
 * A timeframe has a canonical id built from a count + unit:
 *   unit:  m = minute, h = hour, d = day, w = week, mo = month
 *   id:    `${n}${unit}`   e.g. "1m", "15m", "4h", "1d", "1w", "1mo"
 *
 * Every timeframe is derived from Twelve Data API.  Native intervals are
 * fetched directly; non-native intervals are aggregated from a finer
 * native interval so all timeframes share the same data source.
 */

export type TfUnit = "m" | "h" | "d" | "w" | "mo";

export interface Timeframe {
  id: string;
  label: string;
  unit: TfUnit;
  count: number;
  seconds: number;
}

const UNIT_SECONDS: Record<TfUnit, number> = {
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  mo: 2_592_000,
};

function unitLabel(n: number, unit: TfUnit): string {
  switch (unit) {
    case "m":  return `${n}m`;
    case "h":  return `${n}H`;
    case "d":  return `${n}D`;
    case "w":  return `${n}W`;
    case "mo": return `${n}MN`;
  }
}

/** Parse free-form user input ("2h", "45M", "1MN", "3 days") into a Timeframe. */
export function parseTimeframe(raw: string): Timeframe | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  let m: RegExpMatchArray | null;
  let unit: TfUnit;

  if ((m = s.match(/^(\d+)(mo|mn|mon|month|months)$/))) unit = "mo";
  else if ((m = s.match(/^(\d+)(w|wk|week|weeks)$/))) unit = "w";
  else if ((m = s.match(/^(\d+)(d|day|days)$/))) unit = "d";
  else if ((m = s.match(/^(\d+)(h|hr|hour|hours)$/))) unit = "h";
  else if ((m = s.match(/^(\d+)(m|min|mins|minute|minutes)$/))) unit = "m";
  else return null;

  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0 || n > 999) return null;

  const seconds = n * UNIT_SECONDS[unit];
  return { id: `${n}${unit}`, label: unitLabel(n, unit), unit, count: n, seconds };
}

/** Canonical ids of the default timeframe bar. */
export const DEFAULT_TIMEFRAME_IDS = [
  "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo",
];

/** Suggested quick-pick custom intervals shown in the picker. */
export const QUICK_TIMEFRAME_IDS = [
  "2m", "3m", "10m", "20m", "45m", "2h", "3h", "8h", "12h", "2d", "3d",
];

export function getTimeframe(id: string): Timeframe {
  return parseTimeframe(id) ?? parseTimeframe("15m")!;
}

// ─── Twelve Data interval mapping ───────────────────────────────────────────

export interface TwelvedataPlan {
  /** Twelve Data interval string (e.g. "15min", "4h", "1day"). */
  interval: string;
  /** Number of candles to request. */
  outputsize: number;
  /** Aggregation bucket in seconds — 0 means use the native interval as-is. */
  aggregateSeconds: number;
}

/** Native Twelve Data intervals. */
const TD_NATIVE: Record<string, string> = {
  "1m":  "1min",
  "5m":  "5min",
  "15m": "15min",
  "30m": "30min",
  "45m": "45min",
  "1h":  "1h",
  "2h":  "2h",
  "4h":  "4h",
  "8h":  "8h",
  "1d":  "1day",
  "1w":  "1week",
  "1mo": "1month",
};

/**
 * Return the Twelve Data fetch plan for a timeframe id.
 * Non-native intervals aggregate from the finest suitable native interval.
 */
export function twelvedataPlan(id: string): TwelvedataPlan {
  const tf = getTimeframe(id);
  const native = TD_NATIVE[tf.id];

  if (native) {
    const outputsize =
      tf.unit === "mo" ? 100
      : tf.unit === "w" ? 200
      : 500;
    return { interval: native, outputsize, aggregateSeconds: 0 };
  }

  // Minute-based non-native: aggregate from 1min
  if (tf.unit === "m") {
    return {
      interval: "1min",
      outputsize: Math.min(500 * tf.count, 5000),
      aggregateSeconds: tf.seconds,
    };
  }

  // Hour-based non-native
  if (tf.unit === "h") {
    // Pick finest native base that divides evenly, or fall back to 1h
    if (tf.count % 4 === 0) {
      return {
        interval: "4h",
        outputsize: Math.min(500 * Math.ceil(tf.count / 4), 5000),
        aggregateSeconds: tf.seconds,
      };
    }
    if (tf.count % 2 === 0) {
      return {
        interval: "2h",
        outputsize: Math.min(500 * Math.ceil(tf.count / 2), 5000),
        aggregateSeconds: tf.seconds,
      };
    }
    return {
      interval: "1h",
      outputsize: Math.min(500 * tf.count, 5000),
      aggregateSeconds: tf.seconds,
    };
  }

  // Day-based non-native: aggregate from 1day
  if (tf.unit === "d") {
    return {
      interval: "1day",
      outputsize: Math.min(500 * tf.count, 5000),
      aggregateSeconds: tf.count * 86_400,
    };
  }

  // Fallback for exotic week/month combos
  return { interval: "1day", outputsize: 5000, aggregateSeconds: tf.seconds };
}

// ─── Candle close countdown ──────────────────────────────────────────────────

/**
 * Compute the number of seconds until the current candle of the given
 * timeframe closes, based on UTC-aligned candle boundaries.
 */
export function candleSecondsLeft(timeframeId: string): number {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const tf = getTimeframe(timeframeId);

  if (tf.unit === "mo") {
    const d = new Date(now);
    const nextClose = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + tf.count, 1);
    return Math.max(0, Math.floor((nextClose - now) / 1000));
  }

  if (tf.unit === "w") {
    // Forex week candles close at Monday 00:00 UTC
    const d = new Date(now);
    const dow = d.getUTCDay(); // 0=Sun … 6=Sat
    const daysUntilMon = ((8 - dow) % 7) || 7;
    const nextClose = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + daysUntilMon,
    );
    return Math.max(0, Math.floor((nextClose - now) / 1000));
  }

  // For d/h/m: align candle boundaries to UTC epoch multiples
  const periodSecs =
    tf.unit === "d" ? tf.count * 86_400 : tf.seconds;
  const nextClose = (Math.floor(nowSec / periodSecs) + 1) * periodSecs;
  return Math.max(0, nextClose - nowSec);
}

/**
 * Compute the UTC open timestamp (seconds) of the CURRENT candle for a
 * given timeframe.  This is the boundary where the new candle begins.
 */
export function candleOpenTime(timeframeId: string): number {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const tf = getTimeframe(timeframeId);

  if (tf.unit === "mo") {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }

  if (tf.unit === "w") {
    // Forex week candles open Monday 00:00 UTC
    const d = new Date(now);
    const dow = d.getUTCDay(); // 0=Sun … 6=Sat
    const daysFromMon = (dow + 6) % 7; // 0 on Mon, 6 on Sun
    return (
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() - daysFromMon,
      ) / 1000
    );
  }

  const periodSecs =
    tf.unit === "d" ? tf.count * 86_400 : tf.seconds;
  return Math.floor(nowSec / periodSecs) * periodSecs;
}

/** Format a seconds value as a human-readable countdown string. */
export function formatCountdown(totalSeconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (totalSeconds >= 86_400) {
    const d = Math.floor(totalSeconds / 86_400);
    const h = Math.floor((totalSeconds % 86_400) / 3_600);
    const m = Math.floor((totalSeconds % 3_600) / 60);
    const s = totalSeconds % 60;
    return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  if (totalSeconds >= 3_600) {
    const h = Math.floor(totalSeconds / 3_600);
    const m = Math.floor((totalSeconds % 3_600) / 60);
    const s = totalSeconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${pad(m)}:${pad(s)}`;
}
