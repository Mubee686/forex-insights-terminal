import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFIG, loadConfig, saveConfig, type ApiConfig } from "@/lib/config";

export function useApiConfig() {
  const [config, setConfig] = useState<ApiConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);

  // load from localStorage after mount to keep SSR/CSR markup identical
  useEffect(() => {
    setConfig(loadConfig());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<ApiConfig>) => {
    setConfig((prev) => {
      const next: ApiConfig = {
        ...prev,
        ...patch,
        rateLimit: { ...prev.rateLimit, ...(patch.rateLimit ?? {}) },
      };
      saveConfig(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    saveConfig(DEFAULT_CONFIG);
  }, []);

  return { config, update, reset, hydrated };
}
