/**
 * /futures — MF SMC Futures
 *
 * Standalone Binance Futures chart page. No auth required (public data).
 * Structured to coexist cleanly alongside the existing Forex terminal:
 *   - All Binance/futures logic lives in src/components/FuturesChart.tsx
 *   - This route is purely layout/nav — it never imports forex code
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, LogOut, User } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

import { useAuthSession } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { FuturesChart } from "@/components/FuturesChart";

export const Route = createFileRoute("/futures")({
  head: () => ({
    meta: [
      { title: "MF SMC Futures — Crypto Futures Chart" },
      {
        name: "description",
        content:
          "Real-time Binance Futures candlestick charts with Smart Money Concept analysis. BTCUSDT, ETHUSDT and more.",
      },
    ],
  }),
  component: FuturesPage,
});

function FuturesPage() {
  const { session } = useAuthSession();
  const navigate    = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/login" });
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "#0A1428", fontFamily: "'Space Grotesk', sans-serif" }}
    >
      {/* ══ Header ═══════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between border-b border-[#1E3A6E] bg-[#091629] px-4 py-3">
        {/* Left: logo + nav tabs */}
        <div className="flex items-center gap-1">
          <Link to="/" className="mr-3 flex items-center gap-2">
            <img
              src="/logo.png"
              alt="MF SMC Trader"
              className="h-8 w-8 rounded-md object-contain"
            />
            <span className="hidden text-sm font-bold text-white sm:inline">
              MF SMC Trader
            </span>
          </Link>

          {/* Forex Terminal tab */}
          <Link
            to="/terminal"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
          >
            Forex Terminal
          </Link>

          {/* Futures tab — active */}
          <div className="rounded-md border border-[#2563EB] bg-[#1A3560] px-3 py-1.5 text-sm font-semibold text-white">
            Futures
          </div>
        </div>

        {/* Right: auth controls */}
        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#1E3A6E] bg-[#0D1F3C] px-3 py-1.5 text-sm font-medium text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
              >
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#1E3A6E] bg-[#0D1F3C] px-3 py-1.5 text-sm font-medium text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="rounded-lg border border-[#1E3A6E] bg-[#0D1F3C] px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-[#2563EB] hover:bg-[#1A3560]"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      {/* ══ Main content ═════════════════════════════════════════════════════ */}
      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* Section heading */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1E3A6E] bg-[#0D1F3C] text-[#60A5FA]">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-white">
              MF SMC Futures
            </h1>
            <p className="text-xs text-[#7BA8CC]">
              Binance Futures · Real-time candlestick data
            </p>
          </div>

          {/* Live badge */}
          <div className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </div>
        </div>

        {/* Chart — all logic is self-contained in FuturesChart */}
        <FuturesChart />

      </main>
    </div>
  );
}
