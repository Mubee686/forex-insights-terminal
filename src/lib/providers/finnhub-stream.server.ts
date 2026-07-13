/**
 * Finnhub live-tick bridge — SERVER-ONLY singleton.
 *
 * Keeps exactly ONE upstream Finnhub WebSocket connection open (Finnhub
 * allows only one connection per API key) and fans ticks out to any number
 * of local subscribers (SSE clients). Subscriptions are ref-counted so we
 * only send `subscribe`/`unsubscribe` to Finnhub when the first listener
 * arrives / the last one leaves.
 *
 * Auto-reconnects with exponential backoff on drop or error — callers never
 * need to know the upstream connection blipped; they just keep receiving
 * ticks once it's back.
 *
 * Stored on `globalThis` so Vite's dev-server HMR (which re-evaluates this
 * module on every edit) reuses the same live connection instead of leaking
 * a new one per reload.
 */
import { WebSocket } from "ws";
import { finnhubApiKey } from "./finnhub.server";

export interface Tick {
  symbol: string;
  price: number;
  timestamp: number; // ms
}

type Listener = (tick: Tick) => void;

interface StreamState {
  ws: WebSocket | null;
  connecting: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  listeners: Map<string, Set<Listener>>; // finnhubSymbol -> listeners
  lastTick: Map<string, Tick>;
}

const GLOBAL_KEY = "__finnhubStreamState__";

function getState(): StreamState {
  const g = globalThis as unknown as Record<string, StreamState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      ws: null,
      connecting: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
      listeners: new Map(),
      lastTick: new Map(),
    };
  }
  return g[GLOBAL_KEY]!;
}

function scheduleReconnect() {
  const state = getState();
  if (state.reconnectTimer) return;
  const delay = Math.min(30_000, 1_000 * 2 ** state.reconnectAttempt);
  state.reconnectAttempt++;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  const state = getState();
  if (state.connecting || state.ws) return;
  state.connecting = true;

  const ws = new WebSocket(`wss://ws.finnhub.io?token=${finnhubApiKey()}`);

  ws.addEventListener("open", () => {
    state.connecting = false;
    state.reconnectAttempt = 0;
    // Re-subscribe to every symbol that has active listeners (covers reconnects).
    for (const symbol of state.listeners.keys()) {
      ws.send(JSON.stringify({ type: "subscribe", symbol }));
    }
  });

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        type: string;
        data?: { s: string; p: number; t: number }[];
      };
      if (msg.type !== "trade" || !msg.data) return;
      for (const t of msg.data) {
        const tick: Tick = { symbol: t.s, price: t.p, timestamp: t.t };
        state.lastTick.set(t.s, tick);
        const subs = state.listeners.get(t.s);
        if (subs) for (const fn of subs) fn(tick);
      }
    } catch {
      // Ignore malformed frames — never crash the stream on a bad message.
    }
  });

  const onDown = () => {
    state.connecting = false;
    state.ws = null;
    scheduleReconnect();
  };
  ws.addEventListener("close", onDown);
  ws.addEventListener("error", onDown);

  state.ws = ws;
}

/**
 * Subscribe to live ticks for a Finnhub symbol (e.g. "OANDA:EUR_USD").
 * Returns an unsubscribe function. Lazily starts the upstream connection
 * on first subscriber; tears down the upstream subscription when the last
 * local listener for that symbol unsubscribes.
 */
export function subscribeTicks(finnhubSymbol: string, onTick: Listener): () => void {
  const state = getState();

  if (!state.listeners.has(finnhubSymbol)) {
    state.listeners.set(finnhubSymbol, new Set());
  }
  const set = state.listeners.get(finnhubSymbol)!;
  set.add(onTick);

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "subscribe", symbol: finnhubSymbol }));
  } else {
    connect();
  }

  return () => {
    set.delete(onTick);
    if (set.size === 0) {
      state.listeners.delete(finnhubSymbol);
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: "unsubscribe", symbol: finnhubSymbol }));
      }
    }
  };
}

/** Latest known tick for a symbol, if any — used to seed a new SSE client instantly. */
export function getLastTick(finnhubSymbol: string): Tick | null {
  return getState().lastTick.get(finnhubSymbol) ?? null;
}
