/**
 * Instruments and shared candle types.
 *
 * All price data comes from ONE live feed (Yahoo Finance) via the server
 * function in `market.functions.ts`.  There is no synthetic/simulated data.
 */

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ForexPair {
  symbol: string; // display symbol, e.g. "EUR/USD"
  yahoo: string;  // Yahoo Finance symbol, e.g. "EURUSD=X"
  name: string;
  digits: number;
}

export const FOREX_PAIRS: ForexPair[] = [
  { symbol: "EUR/USD", yahoo: "EURUSD=X", name: "Euro / US Dollar",    digits: 5 },
  { symbol: "GBP/USD", yahoo: "GBPUSD=X", name: "Pound / US Dollar",   digits: 5 },
  { symbol: "USD/JPY", yahoo: "USDJPY=X", name: "US Dollar / Yen",     digits: 3 },
  { symbol: "AUD/USD", yahoo: "AUDUSD=X", name: "Aussie / US Dollar",  digits: 5 },
  { symbol: "USD/CAD", yahoo: "USDCAD=X", name: "US Dollar / Loonie",  digits: 5 },
  { symbol: "USD/CHF", yahoo: "USDCHF=X", name: "US Dollar / Franc",   digits: 5 },
  { symbol: "NZD/USD", yahoo: "NZDUSD=X", name: "Kiwi / US Dollar",    digits: 5 },
  { symbol: "EUR/GBP", yahoo: "EURGBP=X", name: "Euro / Pound",        digits: 5 },
  { symbol: "EUR/JPY", yahoo: "EURJPY=X", name: "Euro / Yen",          digits: 3 },
  { symbol: "GBP/JPY", yahoo: "GBPJPY=X", name: "Pound / Yen",         digits: 3 },
  { symbol: "XAU/USD", yahoo: "GC=F",     name: "Gold / US Dollar",    digits: 2 },
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
