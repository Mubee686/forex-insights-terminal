/**
 * Instruments and shared candle types.
 *
 * All price data comes from Twelve Data API via the server
 * function in `market.functions.ts`.  There is no synthetic/simulated data.
 */

export interface Candle {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ForexPair {
  symbol: string;     // display symbol, e.g. "EUR/USD"
  twelvedata: string; // Twelve Data symbol, e.g. "EUR/USD"
  name: string;
  digits: number;
}

export const FOREX_PAIRS: ForexPair[] = [
  { symbol: "EUR/USD", twelvedata: "EUR/USD", name: "Euro / US Dollar",    digits: 5 },
  { symbol: "GBP/USD", twelvedata: "GBP/USD", name: "Pound / US Dollar",   digits: 5 },
  { symbol: "USD/JPY", twelvedata: "USD/JPY", name: "US Dollar / Yen",     digits: 3 },
  { symbol: "AUD/USD", twelvedata: "AUD/USD", name: "Aussie / US Dollar",  digits: 5 },
  { symbol: "USD/CAD", twelvedata: "USD/CAD", name: "US Dollar / Loonie",  digits: 5 },
  { symbol: "USD/CHF", twelvedata: "USD/CHF", name: "US Dollar / Franc",   digits: 5 },
  { symbol: "NZD/USD", twelvedata: "NZD/USD", name: "Kiwi / US Dollar",    digits: 5 },
  { symbol: "EUR/GBP", twelvedata: "EUR/GBP", name: "Euro / Pound",        digits: 5 },
  { symbol: "EUR/JPY", twelvedata: "EUR/JPY", name: "Euro / Yen",          digits: 3 },
  { symbol: "GBP/JPY", twelvedata: "GBP/JPY", name: "Pound / Yen",         digits: 3 },
  { symbol: "XAU/USD", twelvedata: "XAU/USD", name: "Gold / US Dollar",    digits: 2 },
];

export function getPair(symbol: string): ForexPair {
  return FOREX_PAIRS.find((p) => p.symbol === symbol) ?? FOREX_PAIRS[0];
}

export function formatPrice(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
