/**
 * Timeframe model — client-safe (imported by both browser and server code).
 *
 * A timeframe has a canonical id built from a count + unit:
 *   unit:  m = minute, h = hour, d = day, w = week, mo = month
 *   id:    `${n}${unit}`   e.g. "1m", "15m", "4h", "1d", "1w", "1mo"
 *
 * Every timeframe is derived from ONE market feed (Yahoo Finance).  Native
 * Yahoo intervals are fetched directly; everything else is aggregated on the
 * server from a finer native interval so all timeframes share the same feed.
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
  "1m", "5m", "10m", "15m", "30m", "1h", "4h", "12h", "1d", "1w", "1mo",
];

/** Suggested quick-pick custom intervals shown in the picker. */
export const QUICK_TIMEFRAME_IDS = [
  "2m", "3m", "20m", "45m", "2h", "3h", "6h", "8h", "2d", "3d",
];

export function getTimeframe(id: string): Timeframe {
  return parseTimeframe(id) ?? parseTimeframe("15m")!;
}

// ─── Yahoo Finance mapping ──────────────────────────────────────────────────

export interface YahooPlan {
  /** Yahoo interval string to request. */
  interval: string;
  /** Yahoo range string to request. */
  range: string;
  /** Target aggregation bucket in seconds (0 = use the native interval as-is). */
  aggregateSeconds: number;
}

const NATIVE: Record<string, string> = {
  "1m":  "1m",
  "5m":  "5m",
  "15m": "15m",
  "30m": "30m",
  "1h":  "60m",
  "1d":  "1d",
  "1w":  "1wk",
  "1mo": "1mo",
};

/**
 * Decide which native Yahoo interval to fetch and whether to aggregate.
 * Guarantees every timeframe is built from the same underlying feed.
 */
export function yahooPlan(id: string): YahooPlan {
  const tf = getTimeframe(id);

  // Native intervals — fetch directly, no aggregation.
  const native = NATIVE[tf.id];
  if (native) {
    const range =
      tf.seconds < 300 ? "7d"
      : tf.seconds < 3_600 ? "60d"
      : tf.seconds < 86_400 ? "730d"
      : tf.seconds < 604_800 ? "10y"
      : "max";
    return { interval: native, range, aggregateSeconds: 0 };
  }

  // Non-native — pick the finest base that covers enough history, then aggregate.
  if (tf.seconds < 300)     return { interval: "1m",  range: "7d",   aggregateSeconds: tf.seconds };
  if (tf.seconds < 3_600)   return { interval: "5m",  range: "60d",  aggregateSeconds: tf.seconds };
  if (tf.seconds < 86_400)  return { interval: "60m", range: "730d", aggregateSeconds: tf.seconds };
  if (tf.seconds < 604_800) return { interval: "1d",  range: "10y",  aggregateSeconds: tf.seconds };
  if (tf.seconds < 2_592_000) return { interval: "1wk", range: "max", aggregateSeconds: tf.seconds };
  return { interval: "1mo", range: "max", aggregateSeconds: tf.seconds };
}
