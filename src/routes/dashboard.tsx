import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Activity, LogOut, LineChart } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — MF SMC Trader" },
      { name: "description", content: "Your MF SMC Trader dashboard." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session, loading } = useAuthSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/login" });
  }

  const fullName =
    (session?.user?.user_metadata?.full_name as string | undefined) ?? session?.user?.email;

  return (
    <div className="auth-bg min-h-screen w-full text-slate-900">
      <header className="relative z-10 flex items-center justify-between border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-sky-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-100">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">MF SMC Trader</span>
        </Link>
        <button
          onClick={signOut}
          className="btn-glow inline-flex items-center gap-1.5 rounded-md bg-white/80 px-3 py-1.5 text-sm font-medium text-sky-700 shadow-sm border border-sky-100"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="auth-fade-up rounded-2xl border border-white/60 bg-white/80 p-8 shadow-[0_25px_60px_-20px_rgba(56,189,248,0.35)] backdrop-blur-xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome{fullName ? `, ${fullName}` : ""} 👋
          </h1>
          <p className="mt-2 text-slate-500">You are signed in to MF SMC Trader.</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link
              to="/"
              className="btn-glow flex items-center gap-3 rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-blue-50 p-4 text-sky-700"
            >
              <LineChart className="h-5 w-5" />
              <div>
                <div className="text-sm font-semibold">Open Trading Terminal</div>
                <div className="text-xs text-sky-600/80">Live charts & SMC tools</div>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
