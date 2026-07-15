import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CandlestickChart,
  Layers,
  LineChart,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Timer,
  Trash2,
  ArrowLeft,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

import { TradingChart, type ChartType } from "@/components/TradingChart";
import { useMarketData, type FeedStatus } from "@/hooks/use-market-data";
import { useCandleTimer } from "@/hooks/use-candle-timer";
import { useTimeframeBar } from "@/hooks/use-timeframes";
import { FOREX_PAIRS, formatPrice, getPair } from "@/lib/forex";
import {
  DEFAULT_TIMEFRAME_IDS,
  QUICK_TIMEFRAME_IDS,
  getTimeframe,
  parseTimeframe,
} from "@/lib/timeframes";
import { TOOLS, analyze, zonesForTools, type ToolId } from "@/lib/smc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MF SMC Trader — Live Forex SMC Analysis Terminal" },
      {
        name: "description",
        content:
          "Professional forex trading terminal with live market data, TradingView-style candlestick charts, custom timeframes and Smart Money Concept analysis tools.",
      },
    ],
  }),
  component: Terminal,
});

const ALL_TOOLS = new Set<ToolId>(TOOLS.map((t) => t.id));

interface MenuState {
  id: string;
  x: number;
  y: number;
}

function Terminal() {
  const [symbol, setSymbol] = useState("EUR/USD");
  const [timeframeId, setTimeframeId] = useState("15m");
  const [enabled, setEnabled] = useState<Set<ToolId>>(() => new Set(ALL_TOOLS));
  const [query, setQuery] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("candlestick");

  const bar = useTimeframeBar();
  const { formattedTime, epoch } = useCandleTimer(timeframeId);

  // Timeframe-bar management UI state
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [customError, setCustomError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { candles, price, prevClose, status, error, isLoading, refresh } = useMarketData(
    symbol,
    timeframeId,
    epoch,
  );

  const pair = getPair(symbol);
  const tf = getTimeframe(timeframeId);

  const analysis = useMemo(() => analyze(candles), [candles]);
  const zones = useMemo(() => zonesForTools(analysis, enabled), [analysis, enabled]);

  const last = candles[candles.length - 1];
  const livePrice = price ?? last?.close ?? null;
  const change =
    livePrice != null && prevClose != null && prevClose !== 0
      ? ((livePrice - prevClose) / prevClose) * 100
      : 0;

  // ── Price flash: briefly color the price green/red on every tick ────────
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  useEffect(() => {
    if (livePrice == null) return;
    const prev = prevPriceRef.current;
    if (prev != null && livePrice !== prev) {
      setFlash(livePrice > prev ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 700);
      prevPriceRef.current = livePrice;
      return () => clearTimeout(t);
    }
    prevPriceRef.current = livePrice;
  }, [livePrice]);
  const sessionHigh = candles.length
    ? candles.reduce((m, c) => Math.max(m, c.high), -Infinity)
    : NaN;
  const sessionLow = candles.length ? candles.reduce((m, c) => Math.min(m, c.low), Infinity) : NaN;

  const toggle = (id: ToolId) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const filteredPairs = FOREX_PAIRS.filter(
    (p) =>
      p.symbol.toLowerCase().includes(query.toLowerCase()) ||
      p.name.toLowerCase().includes(query.toLowerCase()),
  );

  const zoneCount = (tool: ToolId) => analysis[tool].length;

  // If the selected timeframe gets removed from the bar, pick another.
  useEffect(() => {
    if (bar.hydrated && bar.ids.length && !bar.ids.includes(timeframeId)) {
      setTimeframeId(bar.ids[0]);
    }
  }, [bar.hydrated, bar.ids, timeframeId]);

  // ── Timeframe bar interactions ────────────────────────────────────────────
  function openMenu(id: string, x: number, y: number) {
    const menuW = 176;
    const clampedX = Math.min(x, window.innerWidth - menuW - 8);
    setMenu({ id, x: Math.max(8, clampedX), y });
    setPickerOpen(false);
  }

  function startLongPress(id: string, e: React.TouchEvent) {
    const t = e.touches[0];
    const x = t.clientX;
    const y = t.clientY;
    longPress.current = setTimeout(() => openMenu(id, x, y), 480);
  }
  function cancelLongPress() {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  function addCustom() {
    const id = bar.add(customInput);
    if (!id) {
      setCustomError("Invalid format. Try 2m, 45m, 3h, 2d");
      return;
    }
    setTimeframeId(id);
    setCustomInput("");
    setCustomError("");
    setPickerOpen(false);
  }

  function commitEdit() {
    if (!editId) return;
    const id = bar.edit(editId, editInput);
    if (!id) {
      setCustomError("Invalid format. Try 2m, 45m, 3h, 2d");
      return;
    }
    if (timeframeId === editId) setTimeframeId(id);
    setEditId(null);
    setEditInput("");
    setCustomError("");
  }

  // timeframes available to pin (not already on the bar)
  const pinnable = [...DEFAULT_TIMEFRAME_IDS, ...QUICK_TIMEFRAME_IDS].filter(
    (id) => !bar.ids.includes(id),
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-panel px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">MF SMC Trader</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Live Forex · SMC Analysis
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FeedBadge status={status} onRetry={refresh} />
          <button
            onClick={() => setToolsOpen((v) => !v)}
            aria-label="SMC analysis tools"
            aria-pressed={toolsOpen}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              toolsOpen
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-secondary/50 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">SMC Tools</span>
            <span className="tabular rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {enabled.size}
            </span>
          </button>
          <Link
            to="/login"
            className="flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-400/20"
          >
            Login
          </Link>
        </div>
      </header>

      {error && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-bear/40 bg-bear/10 px-4 py-1.5 text-xs text-bear">
          <span>Market feed error: {error}</span>
          <button
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-bear/40 px-2 py-0.5 font-medium hover:bg-bear/20"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── Pairs sidebar ────────────────────────────────────────────── */}
        <aside className="flex shrink-0 flex-col border-b border-border bg-panel lg:w-72 lg:border-b-0 lg:border-r">
          <div className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pairs…"
                className="w-full rounded-md border border-border bg-secondary/40 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
          </div>

          <div className="scroll-thin flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:px-2">
            {filteredPairs.map((p) => {
              const active = p.symbol === symbol;
              return (
                <button
                  key={p.symbol}
                  onClick={() => setSymbol(p.symbol)}
                  className={cn(
                    "group flex min-w-[150px] shrink-0 items-center justify-between rounded-md border px-3 py-2 text-left transition-colors lg:min-w-0",
                    active
                      ? "border-primary/40 bg-primary/10"
                      : "border-transparent hover:bg-secondary/50",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{p.symbol}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {active && livePrice != null ? formatPrice(livePrice, p.digits) : p.name}
                    </div>
                  </div>
                  {active && (
                    <div
                      className={cn(
                        "tabular flex items-center gap-1 text-xs font-medium",
                        change >= 0 ? "text-bull" : "text-bear",
                      )}
                    >
                      {change >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(2)}%
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Chart column ─────────────────────────────────────────────── */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Instrument header */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-panel/60 px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight">{pair.symbol}</span>
              <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {tf.label}
              </span>
              <span className="flex items-center gap-1 rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                <Timer className="h-2.5 w-2.5 shrink-0" />
                {formattedTime}
              </span>
            </div>

            {livePrice != null && (
              <div className="flex items-baseline gap-2">
                <span
                  key={flash}
                  className={cn(
                    "tabular text-lg font-semibold transition-smooth",
                    flash === "up" && "price-flash-up",
                    flash === "down" && "price-flash-down",
                  )}
                >
                  {formatPrice(livePrice, pair.digits)}
                </span>
                <span
                  className={cn(
                    "tabular text-sm font-medium",
                    change >= 0 ? "text-bull" : "text-bear",
                  )}
                >
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              </div>
            )}

            <Stat label="High" value={formatPrice(sessionHigh, pair.digits)} />
            <Stat label="Low" value={formatPrice(sessionLow, pair.digits)} />

            {/* ── Chart type + timeframe bar ──────────────────────────── */}
            <div className="ml-auto flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/40 p-0.5">
                <button
                  onClick={() => setChartType("candlestick")}
                  aria-label="Candlestick chart"
                  aria-pressed={chartType === "candlestick"}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                    chartType === "candlestick"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CandlestickChart className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setChartType("line")}
                  aria-label="Line chart"
                  aria-pressed={chartType === "line"}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                    chartType === "line"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LineChart className="h-3 w-3" />
                </button>
              </div>

              <div className="scroll-thin flex max-w-[60vw] items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-secondary/40 p-0.5 lg:max-w-none">
                {bar.items.map((t) => {
                  const isActive = t.id === timeframeId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTimeframeId(t.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openMenu(t.id, e.clientX, e.clientY);
                      }}
                      onTouchStart={(e) => startLongPress(t.id, e)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      className={cn(
                        "shrink-0 select-none rounded px-2 py-1 text-xs font-semibold transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Add / pin timeframe */}
              <div className="relative">
                <button
                  onClick={() => {
                    setPickerOpen((v) => !v);
                    setMenu(null);
                    setCustomError("");
                  }}
                  aria-label="Add timeframe"
                  className={cn(
                    "flex items-center rounded border border-border p-1.5 text-xs transition-colors",
                    pickerOpen
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>

                {pickerOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-panel shadow-2xl">
                    <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Pin a timeframe
                    </div>
                    <div className="grid grid-cols-5 gap-1 p-3">
                      {pinnable.length === 0 && (
                        <span className="col-span-5 text-[11px] text-muted-foreground">
                          All presets pinned.
                        </span>
                      )}
                      {pinnable.map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            bar.pin(id);
                            setTimeframeId(id);
                            setPickerOpen(false);
                          }}
                          className="rounded bg-secondary/50 px-1.5 py-1 text-center text-xs font-medium text-muted-foreground hover:bg-primary/20 hover:text-primary"
                        >
                          {getTimeframe(id).label}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border px-3 py-2.5">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          addCustom();
                        }}
                        className="flex gap-2"
                      >
                        <input
                          value={customInput}
                          onChange={(e) => {
                            setCustomInput(e.target.value);
                            setCustomError("");
                          }}
                          placeholder="Custom e.g. 6h, 45m, 2d"
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-primary"
                        />
                        <button
                          type="submit"
                          className="shrink-0 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                          Add
                        </button>
                      </form>
                      {customError && <p className="mt-1 text-[10px] text-bear">{customError}</p>}
                      <p className="mt-1 text-[10px] text-muted-foreground/60">
                        Units: <code>m h d w mo</code> · long-press a chip to manage it
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="min-h-0 flex-1 bg-card">
            <TradingChart
              candles={candles}
              zones={zones}
              digits={pair.digits}
              resetKey={`${symbol}|${timeframeId}`}
              isLoading={isLoading}
              chartType={chartType}
            />
          </div>
        </main>

        {/* ── SMC Tools panel ─────────────────────────────────────────── */}
        {toolsOpen && (
          <>
            <div
              onClick={() => setToolsOpen(false)}
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            />
            <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-panel shadow-2xl">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">SMC Analysis</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Toggle tools to plot detected zones
                  </p>
                </div>
                <button
                  onClick={() => setToolsOpen(false)}
                  aria-label="Close SMC tools"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="scroll-thin flex-1 overflow-y-auto p-3">
                <div className="space-y-2">
                  {TOOLS.map((t) => {
                    const on = enabled.has(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => toggle(t.id)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                          on ? "border-border bg-secondary/40" : "border-border/50 bg-transparent",
                        )}
                      >
                        <span
                          className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                          style={{
                            backgroundColor: on ? t.color : "transparent",
                            border: `1px solid ${t.color}`,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">{t.name}</span>
                            <span className="tabular rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {zoneCount(t.id)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {t.description}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
                            on ? "bg-primary" : "bg-secondary",
                          )}
                        >
                          <span
                            className={cn(
                              "h-3 w-3 rounded-full bg-background transition-transform",
                              on && "translate-x-3",
                            )}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Detected zones
                  </div>
                  <div className="scroll-thin max-h-56 space-y-1 overflow-y-auto">
                    {zones.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No active zones. Enable a tool.
                      </p>
                    ) : (
                      zones
                        .slice()
                        .reverse()
                        .map((z) => {
                          const meta = TOOLS.find((t) => t.id === z.tool)!;
                          return (
                            <div
                              key={z.id}
                              className="flex items-center gap-2 rounded-md bg-background/50 px-2 py-1.5"
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: meta.color }}
                              />
                              <span className="text-xs font-medium">{z.label}</span>
                              <span className="tabular ml-auto text-[11px] text-muted-foreground">
                                {z.price != null
                                  ? formatPrice(z.price, pair.digits)
                                  : formatPrice(z.priceLow!, pair.digits)}
                              </span>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ── Timeframe context menu (long-press / right-click) ──────────── */}
      {menu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} />
          <div
            className="fixed z-[61] w-44 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-2xl"
            style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 220) }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {getTimeframe(menu.id).label} timeframe
            </div>
            <MenuItem
              icon={<ArrowLeft className="h-3.5 w-3.5" />}
              label="Move left"
              onClick={() => {
                bar.moveLeft(menu.id);
                setMenu(null);
              }}
            />
            <MenuItem
              icon={<ArrowRight className="h-3.5 w-3.5" />}
              label="Move right"
              onClick={() => {
                bar.moveRight(menu.id);
                setMenu(null);
              }}
            />
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Edit"
              onClick={() => {
                setEditId(menu.id);
                setEditInput(menu.id);
                setCustomError("");
                setMenu(null);
              }}
            />
            <MenuItem
              icon={<PinOff className="h-3.5 w-3.5" />}
              label="Unpin"
              onClick={() => {
                bar.unpin(menu.id);
                setMenu(null);
              }}
            />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete"
              danger
              onClick={() => {
                bar.unpin(menu.id);
                setMenu(null);
              }}
            />
          </div>
        </>
      )}

      {/* ── Edit timeframe dialog ──────────────────────────────────────── */}
      {editId && (
        <>
          <div
            className="fixed inset-0 z-[70] bg-background/60 backdrop-blur-sm"
            onClick={() => setEditId(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-[71] w-72 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Pin className="h-4 w-4 text-primary" /> Edit timeframe
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitEdit();
              }}
            >
              <input
                autoFocus
                value={editInput}
                onChange={(e) => {
                  setEditInput(e.target.value);
                  setCustomError("");
                }}
                placeholder="e.g. 2h, 45m, 3d"
                className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
              />
              {customError && <p className="mt-1 text-[11px] text-bear">{customError}</p>}
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Preview:{" "}
                <span className="font-semibold text-foreground">
                  {parseTimeframe(editInput)?.label ?? "—"}
                </span>
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditId(null)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-secondary/60",
        danger ? "text-bear" : "text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

const FEED_META: Record<FeedStatus, { label: string; dot: string; pulse: boolean }> = {
  live: { label: "Live", dot: "bg-bull", pulse: true },
  connecting: { label: "Connecting", dot: "bg-primary", pulse: true },
  partial: { label: "Live (no history)", dot: "bg-amber-500", pulse: true },
  error: { label: "Error", dot: "bg-bear", pulse: false },
};

function FeedBadge({ status, onRetry }: { status: FeedStatus; onRetry: () => void }) {
  const meta = FEED_META[status];
  return (
    <button
      onClick={status === "error" || status === "partial" ? onRetry : undefined}
      title={
        status === "partial"
          ? "Live ticks are streaming, but historical bars need a Finnhub plan upgrade"
          : undefined
      }
      className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1"
    >
      {status === "connecting" ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
      ) : (
        <span className={cn("h-2 w-2 rounded-full", meta.dot, meta.pulse && "live-dot")} />
      )}
      <span className="text-[11px] font-medium text-muted-foreground">{meta.label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden flex-col sm:flex">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="tabular text-sm font-medium">{value}</span>
    </div>
  );
}
