import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, LogOut, LineChart, Copy, ShieldCheck, Mail } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";
import { ADMIN_EMAIL, ADMIN_NOTIFICATIONS_CHANNEL } from "@/lib/admin-config";
import { getMyMembership } from "@/lib/membership.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — MF SMC Trader" },
      { name: "description", content: "Your MF SMC Trader membership dashboard." },
    ],
  }),
  component: Dashboard,
});

interface Membership {
  status: string;
  start_date: string | null;
  end_date: string | null;
  duration_months: number | null;
}

function Dashboard() {
  const { session, loading } = useAuthSession();
  const navigate = useNavigate();
  const isAdmin = session?.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const fetchMembership = useServerFn(getMyMembership);

  const [code, setCode] = useState<string | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!session) return;
    fetchMembership()
      .then((r: { profile: { full_name: string | null; member_code: string } | null; membership: Membership | null }) => {
        setCode(r.profile?.member_code ?? null);
        setName(r.profile?.full_name ?? null);
        setMembership(r.membership);
      })
      .catch((err: Error) => toast.error(err.message));
  }, [session, fetchMembership]);

  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel(ADMIN_NOTIFICATIONS_CHANNEL)
      .on(
        "broadcast",
        { event: "new-registration" },
        ({ payload }: { payload: { email: string; location?: string } }) => {
          toast.success(`New user registered: ${payload.email}`, {
            description: payload.location ? `Approx. location: ${payload.location}` : undefined,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/login" });
  }

  function copyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast.success("Code copied");
  }

  const displayName = name ?? session?.user?.email;
  const status = membership?.status ?? "inactive";
  const statusColor =
    status === "active"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : status === "expired"
        ? "bg-rose-100 text-rose-700 border-rose-200"
        : "bg-amber-100 text-amber-700 border-amber-200";

  return (
    <div className="auth-bg min-h-screen w-full text-slate-900">
      <header className="relative z-10 flex items-center justify-between border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-sky-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-100">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">MF SMC Trader</span>
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-sky-600"
            >
              <ShieldCheck className="h-4 w-4" /> Admin
            </Link>
          )}
          <button
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-3 py-1.5 text-sm font-medium text-sky-700 shadow-sm border border-sky-100"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <div className="auth-fade-up rounded-2xl border border-white/60 bg-white/80 p-8 shadow-[0_25px_60px_-20px_rgba(56,189,248,0.35)] backdrop-blur-xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome{displayName ? `, ${displayName}` : ""} 👋
          </h1>
          <p className="mt-2 text-slate-500">Your permanent membership code and status.</p>

          <div className="mt-6 rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-blue-50 p-5">
            <div className="text-xs font-medium uppercase tracking-widest text-sky-600">
              Your unique membership code
            </div>
            <div className="mt-2 flex items-center gap-3">
              <code className="flex-1 rounded-md bg-white/90 px-4 py-3 text-lg font-mono font-semibold tracking-widest text-sky-800 shadow-inner">
                {code ?? "…"}
              </code>
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-sky-600"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
            </div>
            <p className="mt-3 text-xs text-sky-700/80">
              This code is fixed to your account — it never changes.
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between rounded-xl border border-sky-100 bg-white/70 p-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-slate-500">
                Membership status
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColor}`}>
                  {status}
                </span>
                {membership?.end_date && (
                  <span className="text-xs text-slate-500">
                    until {new Date(membership.end_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-white/80 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
            >
              <LineChart className="h-4 w-4" /> Open Terminal
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/60 bg-white/80 p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <Mail className="h-5 w-5 text-sky-500" /> How to activate your membership
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm text-slate-600">
            <li>Copy your unique code above.</li>
            <li>
              Contact us on WhatsApp / Email:{" "}
              <a
                href={`mailto:${ADMIN_EMAIL}`}
                className="font-medium text-sky-600 hover:underline"
              >
                {ADMIN_EMAIL}
              </a>
            </li>
            <li>Share your code with us to activate your membership.</li>
            <li>Your status here will update automatically once activated.</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
