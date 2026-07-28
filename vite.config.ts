import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tanstackStart({
      serverFns: { disableCsrfMiddlewareWarning: true },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": `${process.cwd()}/src`,
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    ignoreOutdatedRequests: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    watch: {
      ignored: ["**/.cache/**", "**/node_modules/**", "**/.git/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy libraries that are only needed on specific routes so the
        // landing page doesn't have to download them on first visit.
        manualChunks(id) {
          // lightweight-charts: only used in TradingChart → terminal route.
          // Keeping it in its own chunk means the landing page never loads it.
          if (id.includes("lightweight-charts")) return "vendor-charts";
          // recharts + D3: only used in terminal/dashboard charts.
          if (
            id.includes("recharts") ||
            id.includes("/d3-") ||
            id.includes("/d3/") ||
            id.includes("victory-vendor")
          )
            return "vendor-recharts";
          // Supabase is large and only needed when auth is involved (login,
          // dashboard, terminal) — not on the unauthenticated landing page.
          if (id.includes("@supabase")) return "vendor-supabase";
          // Bundle remaining node_modules into a single shared vendor chunk
          // so they're cached across all pages.
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
