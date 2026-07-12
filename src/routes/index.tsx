import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Layers,
  Loader2,
  Search,
  Settings,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

import { TradingChart } from "@/components/TradingChart";
import { ApiConfigPanel } from "@/components/ApiConfigPanel";
import { useApiConfig } from "@/hooks/use-api-config";
import { useMarketData, type FeedStatus } from "@/hooks/use-market-data";
import {
  FOREX_PAIRS,
  TIMEFRAMES,
  formatPrice,
  getPair,
  getTimeframe,
  snapshotChange,
} from "@/lib/forex";
import { TOOLS, analyze, zonesForTools, type ToolId } from "@/lib/smc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MF SMC Trader — Forex SMC Analysis Platform" },
      {
        name: "description",
        content:
          "Professional forex trading terminal with live candlestick charts, multiple timeframes and Smart Money Concept tools: order blocks, FVGs, liquidity, BOS, CHoCH and POI.",
      },
      { property: "og:title", content: "MF SMC Trader — Forex SMC Analysis" },
      {
        property: "og:description",
        content:
          "Live candlestick charts with Smart Money Concept analysis: order blocks, fair value gaps, liquidity zones, BOS, CHoCH and POI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Terminal,
});

const ALL_TOOLS = new Set<ToolId>(TOOLS.map((t) => t.id));

function Terminal() {
  const [symbol, setSymbol] = useState("EUR/USD");
  const [timeframeId, setTimeframeId] = useState("15m");
  const [enabled, setEnabled] = useState<Set<ToolId>>(() => new Set(ALL_TOOLS));
  const [query, setQuery] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const { config, update, reset, hydrated } = useApiConfig();
  const { candles, status, error } = useMarketData(config, hydrated, symbol, timeframeId);

  const pair = getPair(symbol);
  const tf = getTimeframe(timeframeId);

  const analysis = useMemo(() => analyze(candles), [candles]);
  const zones = useMemo(() => zonesForTools(analysis, enabled), [analysis, enabled]);

  const last = candles[candles.length - 1];
  const first = candles[0];
  const change = last && first ? ((last.close - first.open) / first.open) * 100 : 0;
  const sessionHigh = candles.reduce((m, c) => Math.max(m, c.high), -Infinity);
  const sessionLow = candles.reduce((m, c) => Math.min(m, c.low), Infinity);

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-panel px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">MF SMC Trader</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Forex · SMC Analysis
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FeedBadge status={status} source={config.dataSource} />
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
          <button
            onClick={() => setConfigOpen(true)}
            aria-label="API configuration"
            className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">API</span>
          </button>
        </div>
      </header>

      {status === "error" && (
        <div className="flex items-center gap-2 border-b border-bear/40 bg-bear/10 px-4 py-2 text-xs text-bear">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Live feed error — showing simulated data. {error}
          </span>
          <button
            onClick={() => setConfigOpen(true)}
            className="shrink-0 rounded border border-bear/50 px-2 py-0.5 font-medium hover:bg-bear/20"
          >
            Fix
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Pairs list */}
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
              const ch = active ? change : snapshotChange(p.symbol);
              const px = active && last ? last.close : p.base;
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
                    <div className="tabular text-[11px] text-muted-foreground">
                      {formatPrice(px, p.digits)}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "tabular flex items-center gap-1 text-xs font-medium",
                      ch >= 0 ? "text-bull" : "text-bear",
                    )}
                  >
                    {ch >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {ch >= 0 ? "+" : ""}
                    {ch.toFixed(2)}%
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Chart column */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* instrument header */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-panel/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight">{pair.symbol}</span>
              <ChevronDown className="hidden h-4 w-4 text-muted-foreground" />
            </div>
            {last && (
              <div className="flex items-baseline gap-2">
                <span className="tabular text-lg font-semibold">
                  {formatPrice(last.close, pair.digits)}
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
            <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTimeframeId(t.id)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-semibold transition-colors",
                    t.id === timeframeId
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* chart */}
          <div className="min-h-0 flex-1 bg-card">
            <TradingChart
              candles={candles}
              zones={zones}
              digits={pair.digits}
              timeframeSeconds={tf.seconds}
            />
          </div>
        </main>

        {/* Tools panel — opened via the SMC Tools button */}
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
                      style={{ backgroundColor: on ? t.color : "transparent", border: `1px solid ${t.color}` }}
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
                  <p className="text-xs text-muted-foreground">No active zones. Enable a tool.</p>
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
                              : `${formatPrice(z.priceLow!, pair.digits)}`}
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

      {configOpen && (
        <ApiConfigPanel
          config={config}
          update={update}
          reset={reset}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

const FEED_META: Record<FeedStatus, { label: string; dot: string; pulse: boolean }> = {
  live: { label: "Live", dot: "bg-bull", pulse: true },
  simulated: { label: "Simulated", dot: "bg-primary", pulse: false },
  connecting: { label: "Connecting", dot: "bg-primary", pulse: true },
  error: { label: "Feed error", dot: "bg-bear", pulse: false },
};

function FeedBadge({ status, source }: { status: FeedStatus; source: string }) {
  const meta = FEED_META[status];
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5">
      {status === "connecting" ? (
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
      ) : (
        <span className={cn("h-2 w-2 rounded-full", meta.dot, meta.pulse && "live-dot")} />
      )}
      <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 sm:inline">
        {source === "live" ? "LIVE" : "SIM"}
      </span>
    </div>
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
