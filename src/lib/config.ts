export type Environment = "development" | "production";
export type DataSource = "simulated" | "live";

export interface RateLimitConfig {
  maxPerMinute: number;
  retryOnLimit: boolean;
  maxRetries: number;
}

export interface ApiConfig {
  environment: Environment;
  dataSource: DataSource;
  provider: string;
  baseUrl: string;
  apiKey: string;
  rateLimit: RateLimitConfig;
}

export interface ProviderMeta {
  id: string;
  name: string;
  baseUrl: string;
  docsUrl: string;
  keyUrl: string;
  freeLimit: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "twelvedata",
    name: "Twelve Data",
    baseUrl: "https://api.twelvedata.com",
    docsUrl: "https://twelvedata.com/docs",
    keyUrl: "https://twelvedata.com/apikey",
    freeLimit: "8 requests / min · 800 / day",
  },
];

export const DEFAULT_CONFIG: ApiConfig = {
  environment: "development",
  dataSource: "simulated",
  provider: "twelvedata",
  baseUrl: "https://api.twelvedata.com",
  apiKey: "",
  rateLimit: {
    maxPerMinute: 8,
    retryOnLimit: true,
    maxRetries: 3,
  },
};

export const STORAGE_KEY = "aperture.apiconfig.v1";

export function getProvider(id: string): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** Environment-based default: development → simulated, production → live. */
export function sourceForEnvironment(env: Environment): DataSource {
  return env === "production" ? "live" : "simulated";
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Live mode is only truly active with a provider key and a valid endpoint. */
export function isLiveReady(config: ApiConfig): boolean {
  return (
    config.dataSource === "live" &&
    config.apiKey.trim().length > 0 &&
    isValidUrl(config.baseUrl)
  );
}

export function loadConfig(): ApiConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ApiConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...(parsed.rateLimit ?? {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: ApiConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
