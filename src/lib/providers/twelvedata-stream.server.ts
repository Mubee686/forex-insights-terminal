/**
 * Twelve Data live-price bridge — SERVER-ONLY singleton.
 *
 * Twelve Data's real-time WebSocket requires a paid (Pro) plan, so this
 * bridge uses the REST /price endpoint on a shared polling loop that works
 * on every plan tier. It keeps ONE poll loop per symbol regardless of how
 * many SSE clients are connected (ref-counted), which keeps request volume
 * within the free-tier quota (8 req/min).
 *
 * Prices are REAL spot quotes from Twelve Data — never synthetic. The client
 * applies each tick to the currently-forming candle (see use-market-data.ts).
 *
 * Stored on globalThis so Vite dev-server HMR reuses the same loops instead
 * of leaking a new timer per reload.
 */
import { fetchLatestPrice, resolveSymbol } from "./twelvedata.server";

export interface Tick {
  symbol: string;
  price: number;
  timestamp: number; // ms
}

type Listener = (tick: Tick) => void;

interface SymbolState {
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<Listener>;
}

interface StreamState {
  symbols: Map<string, SymbolState>; // resolved symbol -> state
  lastTick: Map<string, Tick>;
}

const GLOBAL_KEY = "__twelveDataStreamState__";
// Free tier allows 8 requests/min. One symbol polled every 8s = 7.5/min.
const POLL_INTERVAL_MS = 8_000;

function getState(): StreamState {
  const g = globalThis as unknown as Record<string, StreamState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { symbols: new Map(), lastTick: new Map() };
  }
  return g[GLOBAL_KEY]!;
}

async function pollOnce(resolved: string) {
  const state = getState();
  const entry = state.symbols.get(resolved);
  if (!entry || entry.listeners.size === 0) return;
  try {
    const price = await fetchLatestPrice(resolved);
    if (price == null) return;
    const tick: Tick = { symbol: resolved, price, timestamp: Date.now() };
    state.lastTick.set(resolved, tick);
    for (const fn of entry.listeners) fn(tick);
  } catch {
    // Transient failure — the next interval tick will retry.
  }
}

/**
 * Subscribe to live ticks for a display symbol (e.g. "EUR/USD").
 * Returns an unsubscribe function. Starts the shared poll loop for that
 * symbol on the first subscriber and stops it when the last leaves.
 */
export function subscribeTicks(pairSymbol: string, onTick: Listener): () => void {
  const state = getState();
  const resolved = resolveSymbol(pairSymbol);

  let entry = state.symbols.get(resolved);
  if (!entry) {
    entry = { timer: null, listeners: new Set() };
    state.symbols.set(resolved, entry);
  }
  entry.listeners.add(onTick);

  if (!entry.timer) {
    // Kick off an immediate poll so the first subscriber isn't left waiting
    // a full interval for the opening tick.
    void pollOnce(resolved);
    entry.timer = setInterval(() => void pollOnce(resolved), POLL_INTERVAL_MS);
  }

  return () => {
    entry!.listeners.delete(onTick);
    if (entry!.listeners.size === 0) {
      if (entry!.timer) clearInterval(entry!.timer);
      state.symbols.delete(resolved);
    }
  };
}

/** Latest known tick for a display symbol, if any — seeds a new SSE client instantly. */
export function getLastTick(pairSymbol: string): Tick | null {
  return getState().lastTick.get(resolveSymbol(pairSymbol)) ?? null;
}
