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

  const checkAdmin = useServerFn(amIAdmin);
  const lookup = useServerFn(adminLookupUser);
  const activate = useServerFn(adminActivateMembership);

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
      // Refresh
      const r = (await lookup({ data: { code: result.profile.member_code } })) as LookupResult;
      setResult(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  if (loading || checking) {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <ShieldCheck className="mx-auto h-10 w-10 text-sky-500" />
          <h1 className="mt-3 text-xl font-semibold text-slate-800">Admin access only</h1>
          <p className="mt-1 text-sm text-slate-500">You are not authorized to view this page.</p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const m = result?.membership;

  return (
    <div className="auth-bg min-h-screen w-full text-slate-900">
      <header className="relative z-10 flex items-center justify-between border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur">
        <Link to="/dashboard" className="flex items-center gap-2 text-sky-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-100">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">MF SMC Trader · Admin</span>
        </Link>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-3 py-1.5 text-sm font-medium text-sky-700 shadow-sm border border-sky-100"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-white/60 bg-white/80 p-6 shadow-lg backdrop-blur-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Membership Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter a user's membership code to look up their account and activate their membership.
          </p>

          <form onSubmit={onSearch} className="mt-5 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MFSMC-XXXXXXXX"
                className="w-full rounded-md border border-sky-100 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-400"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-60"
            >
              {busy ? "Searching…" : "Search"}
            </button>
          </form>

          {result?.found && result.profile && (
            <div className="mt-6 rounded-xl border border-sky-100 bg-sky-50/60 p-5">
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
                  className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  Activate 1 month
                </button>
                <button
                  onClick={() => onActivate(2)}
                  disabled={busy}
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
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
    <div className="flex justify-between gap-4 border-b border-sky-100/70 py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-slate-800" : "text-slate-800"}>{value}</span>
    </div>
  );
}
