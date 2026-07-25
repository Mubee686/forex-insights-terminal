import { createFileRoute } from "@tanstack/react-router";

import { ADMIN_EMAIL } from "@/lib/admin-config";

/**
 * Cron target: finds memberships expiring in the next 3 days that have
 * not yet been notified, and emails the admin. Also flips clearly-expired
 * rows to 'expired'. Public route (bypasses site auth) — safe because it
 * only mutates internal bookkeeping and only ever emails the admin.
 */
export const Route = createFileRoute("/api/public/hooks/membership-expiry-check")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = supabaseAdmin as any;

        const now = new Date();
        const threshold = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

        const { data: rows, error } = await admin
          .from("memberships")
          .select("user_id, end_date, status, expiry_notified_at, duration_months")
          .eq("status", "active")
          .is("expiry_notified_at", null)
          .gte("end_date", now.toISOString())
          .lte("end_date", threshold.toISOString());

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (!rows || rows.length === 0) {
          // Still flip clearly-expired ones.
          await admin
            .from("memberships")
            .update({ status: "expired" })
            .eq("status", "active")
            .lt("end_date", now.toISOString());
          return Response.json({ ok: true, notified: 0 });
        }

        const ids = rows.map((r: { user_id: string }) => r.user_id);
        const { data: profiles } = await admin
          .from("profiles")
          .select("id, full_name, email, member_code")
          .in("id", ids);
        const byId = new Map(
          ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null; member_code: string }>).map(
            (p) => [p.id, p],
          ),
        );

        const apiKey = process.env.LOVABLE_API_KEY;
        let sent = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let sendLovableEmail: ((payload: any, opts: any) => Promise<void>) | null = null;
        if (apiKey) {
          try {
            const mod = await import("@lovable.dev/email-js" as string);
            sendLovableEmail = mod.sendLovableEmail;
          } catch {
            console.warn("[expiry-check] @lovable.dev/email-js not available — skipping email");
          }
        }

        if (apiKey && sendLovableEmail) {
          const senderDomain = process.env.LOVABLE_SENDER_DOMAIN;
          const from = senderDomain
            ? `MF SMC Trader <notify@${senderDomain}>`
            : "MF SMC Trader <notify@lovable.app>";

          for (const row of rows as Array<{ user_id: string; end_date: string | null }>) {
            const p = byId.get(row.user_id);
            const endStr = row.end_date ? new Date(row.end_date).toLocaleString() : "—";
            const html = `
              <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
                <h2 style="color:#0ea5e9;margin:0 0 12px;">Membership expiring soon</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <tr><td style="padding:6px 0;color:#64748b;">Name</td><td>${p?.full_name ?? "—"}</td></tr>
                  <tr><td style="padding:6px 0;color:#64748b;">Email</td><td>${p?.email ?? "—"}</td></tr>
                  <tr><td style="padding:6px 0;color:#64748b;">Code</td><td>${p?.member_code ?? "—"}</td></tr>
                  <tr><td style="padding:6px 0;color:#64748b;">Expires</td><td>${endStr}</td></tr>
                </table>
              </div>`;
            try {
              await sendLovableEmail(
                {
                  to: ADMIN_EMAIL,
                  from,
                  sender_domain: senderDomain,
                  subject: `Membership expiring: ${p?.email ?? row.user_id}`,
                  html,
                  text: `Membership expiring for ${p?.email ?? row.user_id} on ${endStr}`,
                },
                { apiKey },
              );
              sent++;
            } catch (err) {
              console.warn("[expiry-check] email failed", err);
            }
          }
        }

        await admin
          .from("memberships")
          .update({ expiry_notified_at: now.toISOString() })
          .in("user_id", ids);

        await admin
          .from("memberships")
          .update({ status: "expired" })
          .eq("status", "active")
          .lt("end_date", now.toISOString());

        return Response.json({ ok: true, checked: rows.length, sent });
      },
    },
  },
});
