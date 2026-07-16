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
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : status === "expired"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-amber-500/15 text-amber-400 border-amber-500/30";

  return (
    <div className="auth-bg min-h-screen w-full">
      <header className="relative z-10 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-primary">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">MF SMC Trader</span>
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
            >
              <ShieldCheck className="h-4 w-4" /> Admin
            </Link>
          )}
          <button
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <div className="auth-fade-up rounded-2xl border border-border bg-card p-8 shadow-[0_25px_60px_-20px_oklch(0.78_0.13_195/0.15)]">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Welcome{displayName ? `, ${displayName}` : ""} 👋
          </h1>
          <p className="mt-2 text-muted-foreground">Your permanent membership code and status.</p>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-5">
            <div className="text-xs font-medium uppercase tracking-widest text-primary">
              Your unique membership code
            </div>
            <div className="mt-2 flex items-center gap-3">
              <code className="flex-1 rounded-md bg-secondary px-4 py-3 text-lg font-mono font-semibold tracking-widest text-primary border border-border">
                {code ?? "…"}
              </code>
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              This code is fixed to your account — it never changes.
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-secondary/50 p-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Membership status
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColor}`}>
                  {status}
                </span>
                {membership?.end_date && (
                  <span className="text-xs text-muted-foreground">
                    until {new Date(membership.end_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <LineChart className="h-4 w-4" /> Open Terminal
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Mail className="h-5 w-5 text-primary" /> How to activate your membership
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm text-muted-foreground">
            <li>Copy your unique code above.</li>
            <li>
              Contact us on WhatsApp / Email:{" "}
              <a
                href={`mailto:${ADMIN_EMAIL}`}
                className="font-medium text-primary hover:underline"
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
