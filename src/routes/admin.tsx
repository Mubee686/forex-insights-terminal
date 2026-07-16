import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, LogOut, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";
import {
  amIAdmin,
  adminLookupUser,
  adminActivateMembership,
} from "@/lib/membership.functions";
import { confirmAllUnconfirmedUsers } from "@/lib/auth-admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — MF SMC Trader" },
      { name: "description", content: "Membership management (admin only)." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

interface LookupResult {
  found: boolean;
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
    member_code: string;
    created_at: string;
  };
  membership?: {
    status: string;
    duration_months: number | null;
    start_date: string | null;
    end_date: string | null;
    activated_at: string | null;
  } | null;
}

function AdminPage() {
  const { session, loading } = useAuthSession();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);

  const [bulkFixing, setBulkFixing] = useState(false);

  const checkAdmin = useServerFn(amIAdmin);
  const lookup = useServerFn(adminLookupUser);
  const activate = useServerFn(adminActivateMembership);
  const bulkConfirm = useServerFn(confirmAllUnconfirmedUsers);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ to: "/login" });
      return;
    }
    checkAdmin()
      .then((r) => setIsAdmin(r.isAdmin))
      .finally(() => setChecking(false));
  }, [loading, session, navigate, checkAdmin]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = (await lookup({ data: { code: code.trim() } })) as LookupResult;
      setResult(r);
      if (!r.found) toast.error("No user found for that code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  async function onActivate(months: 1 | 2) {
    if (!result?.profile) return;
    setBusy(true);
    try {
      await activate({ data: { userId: result.profile.id, months } });
      toast.success(`Membership activated for ${months} month${months > 1 ? "s" : ""}`);
      const r = (await lookup({ data: { code: result.profile.member_code } })) as LookupResult;
      setResult(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setBusy(false);
    }
  }

  async function onBulkFix() {
    setBulkFixing(true);
    try {
      const r = await bulkConfirm();
      if (r.total === 0) {
        toast.success("All accounts are already confirmed — no action needed.");
      } else {
        toast.success(`Fixed ${r.fixed} of ${r.total} unconfirmed account(s).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk fix failed");
    } finally {
      setBulkFixing(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  if (loading || checking) {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 text-xl font-semibold text-foreground">Admin access only</h1>
          <p className="mt-1 text-sm text-muted-foreground">You are not authorized to view this page.</p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const m = result?.membership;

  return (
    <div className="auth-bg min-h-screen w-full">
      <header className="relative z-10 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <Link to="/dashboard" className="flex items-center gap-2 text-primary">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">MF SMC Trader · Admin</span>
        </Link>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_25px_60px_-20px_oklch(0.78_0.13_195/0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Membership Management</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter a user's membership code to look up their account and activate their membership.
              </p>
            </div>
            <button
              onClick={onBulkFix}
              disabled={bulkFixing}
              title="Force-confirm all unconfirmed email addresses so every registered user can log in"
              className="shrink-0 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              {bulkFixing ? "Fixing…" : "Fix unconfirmed accounts"}
            </button>
          </div>

          <form onSubmit={onSearch} className="mt-5 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MFSMC-XXXXXXXX"
                className="w-full rounded-md border border-border bg-secondary py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Searching…" : "Search"}
            </button>
          </form>

          {result?.found && result.profile && (
            <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-5">
              <div className="grid gap-2 text-sm">
                <Row label="Name" value={result.profile.full_name ?? "—"} />
                <Row label="Email" value={result.profile.email ?? "—"} />
                <Row label="Member code" value={result.profile.member_code} mono />
                <Row
                  label="Registered"
                  value={new Date(result.profile.created_at).toLocaleString()}
                />
                <Row label="Status" value={m?.status ?? "inactive"} />
                {m?.start_date && (
                  <Row label="Start" value={new Date(m.start_date).toLocaleString()} />
                )}
                {m?.end_date && (
                  <Row label="Ends" value={new Date(m.end_date).toLocaleString()} />
                )}
                {m?.duration_months != null && (
                  <Row label="Duration" value={`${m.duration_months} month(s)`} />
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => onActivate(1)}
                  disabled={busy}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  Activate 1 month
                </button>
                <button
                  onClick={() => onActivate(2)}
                  disabled={busy}
                  className="rounded-md bg-primary/80 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/70 disabled:opacity-60"
                >
                  Activate 2 months
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}
