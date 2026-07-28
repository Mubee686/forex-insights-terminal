/**
 * Lightweight client-side error reporting helper.
 *
 * Drop-in replacement for the former Lovable-specific bridge. Logs to the
 * console in development; wire up a real error-tracking SDK (Sentry, etc.)
 * here if you need production telemetry.
 */

type ErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

export function reportError(
  error: unknown,
  context: Record<string, unknown> = {},
  _options: ErrorOptions = {},
) {
  if (typeof window === "undefined") return;
  const message = error instanceof Error ? error.message : String(error);
  console.error("[error-reporting]", message, {
    route: window.location.pathname,
    ...context,
  });
}

// Back-compat alias so any existing call-sites keep working without a rename.
export const reportLovableError = reportError;
