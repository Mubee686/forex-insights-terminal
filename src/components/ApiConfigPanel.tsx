import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  PROVIDERS,
  clamp,
  getProvider,
  isLiveReady,
  isValidUrl,
  sourceForEnvironment,
  type ApiConfig,
  type DataSource,
  type Environment,
} from "@/lib/config";
import { fetchLiveCandles, getQuota } from "@/lib/live-data";
import { cn } from "@/lib/utils";

interface Props {
  config: ApiConfig;
  update: (patch: Partial<ApiConfig>) => void;
  reset: () => void;
  onClose: () => void;
}

type TestState = { kind: "idle" | "loading" | "ok" | "error"; message?: string };

export function ApiConfigPanel({ config, update, reset, onClose }: Props) {
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [quota, setQuota] = useState(getQuota());
  const provider = getProvider(config.provider);

  useEffect(() => {
    const id = setInterval(() => setQuota(getQuota()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setEnvironment = (env: Environment) =>
    update({ environment: env, dataSource: sourceForEnvironment(env) });

  const setSource = (src: DataSource) => update({ dataSource: src });

  const runTest = async () => {
    setTest({ kind: "loading" });
    try {
      await fetchLiveCandles(config, "EUR/USD", "15m");
      setTest({ kind: "ok", message: "Connected — live data received." });
    } catch (e) {
      setTest({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const live = isLiveReady(config);
  const badUrl = config.baseUrl.length > 0 && !isValidUrl(config.baseUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-label="API configuration"
        className="scroll-thin my-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
      >
        {/* header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-3.5 backdrop-blur">
          <div>
            <h2 className="text-sm font-semibold">API Configuration</h2>
            <p className="text-[11px] text-muted-foreground">Data source, keys & rate limits</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {/* Environment */}
          <Section title="Environment" hint="Switches the default data source">
            <div className="grid grid-cols-2 gap-2">
              {(["development", "production"] as Environment[]).map((env) => (
                <button
                  key={env}
                  onClick={() => setEnvironment(env)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    config.environment === env
                      ? "border-primary/50 bg-primary/10"
                      : "border-border hover:bg-secondary/50",
                  )}
                >
                  <div className="text-sm font-semibold capitalize">{env}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {env === "production" ? "Live market data" : "Simulated feed"}
                  </div>
                </button>
              ))}
            </div>
          </Section>

          {/* Data source */}
          <Section title="Data Source" hint="Override the effective feed">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
              {(["simulated", "live"] as DataSource[]).map((src) => (
                <button
                  key={src}
                  onClick={() => setSource(src)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-2 text-xs font-semibold capitalize transition-colors",
                    config.dataSource === src
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {src}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  live ? "bg-bull" : config.dataSource === "live" ? "bg-bear" : "bg-muted-foreground",
                )}
              />
              <span className="text-muted-foreground">
                {config.dataSource === "simulated"
                  ? "Using deterministic simulated feed."
                  : live
                    ? "Live feed active — requires a valid key."
                    : "Live selected but incomplete — add a valid API key to activate."}
              </span>
            </div>
          </Section>

          {/* Provider + key */}
          <Section title="Data Provider">
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Provider
            </label>
            <select
              value={config.provider}
              onChange={(e) => {
                const p = getProvider(e.target.value);
                update({ provider: p.id, baseUrl: p.baseUrl });
              }}
              className="mb-3 w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-ring"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.freeLimit}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Base URL
            </label>
            <input
              value={config.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="https://api.provider.com"
              className={cn(
                "mb-1 w-full rounded-md border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-ring",
                badUrl ? "border-bear" : "border-border",
              )}
            />
            {badUrl && <p className="mb-2 text-[11px] text-bear">Enter a valid http(s) URL.</p>}

            <label className="mb-1 mt-2 block text-[11px] font-medium text-muted-foreground">
              API Key
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type={showKey ? "text" : "password"}
                value={config.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="Paste your provider API key"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-secondary/40 py-2 pl-8 pr-9 text-sm outline-none focus:border-ring"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Get a free {provider.name} key <ExternalLink className="h-3 w-3" />
            </a>
          </Section>

          {/* Rate limiting */}
          <Section title="Rate-limit Handling" hint="Self-throttle to respect provider quotas">
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Max requests / minute
                </label>
                <span className="tabular text-xs font-semibold">{config.rateLimit.maxPerMinute}</span>
              </div>
              <input
                type="range"
                min={1}
                max={60}
                value={config.rateLimit.maxPerMinute}
                onChange={(e) =>
                  update({ rateLimit: { ...config.rateLimit, maxPerMinute: Number(e.target.value) } })
                }
                className="w-full accent-primary"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (quota.used / Math.max(1, quota.max)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="tabular text-[11px] text-muted-foreground">
                  {quota.used}/{quota.max} used
                </span>
              </div>
            </div>

            <ToggleRow
              label="Retry on rate limit"
              description="Queue & retry with exponential backoff on 429"
              checked={config.rateLimit.retryOnLimit}
              onChange={(v) => update({ rateLimit: { ...config.rateLimit, retryOnLimit: v } })}
            />

            <div className="mt-3 flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground">Max retries</label>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => update({ rateLimit: { ...config.rateLimit, maxRetries: clamp(n, 0, 6) } })}
                    className={cn(
                      "tabular h-7 w-7 rounded-md border text-xs font-semibold transition-colors",
                      config.rateLimit.maxRetries === n
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* Test connection */}
          <div>
            <button
              onClick={runTest}
              disabled={!isLiveReady({ ...config, dataSource: "live" }) || test.kind === "loading"}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {test.kind === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Test connection
            </button>
            {test.kind === "ok" && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-bull">
                <Check className="h-3.5 w-3.5" /> {test.message}
              </p>
            )}
            {test.kind === "error" && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-bear">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {test.message}
              </p>
            )}
          </div>

          {/* security note */}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-3">
            <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Your API key is stored only in this browser (localStorage) and sent directly to the
              provider — never to Aperture's servers. For production deployments, proxy live
              requests through a server function so the key stays private.
            </p>
          </div>
        </div>

        {/* footer */}
        <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 p-3 text-left"
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      <span
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-primary" : "bg-secondary",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full bg-background transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}
