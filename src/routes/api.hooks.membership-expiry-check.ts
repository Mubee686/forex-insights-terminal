import { createFileRoute } from "@tanstack/react-router";

import { ADMIN_EMAIL } from "@/lib/admin-config";

/**
 * Cron target: finds memberships expiring in the next 3 days that have not
 * yet been notified, and emails the admin. Marks each row so the same
 * membership is not re-notified.
 *
 * Public route (no auth); safe because it only reads/marks internal rows
 * and only ever emails the admin address. Callable via the standard
 * Supabase `apikey` header from pg_cron.
 */
export const Route = createFileRoute("/api/public/hooks/membership-expiry-check")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = new Date();
        const threshold = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

        const { data: rows, error } = await supabaseAdmin
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
          return Response.json({ ok: true, notified: 0 });
        }

        // Pull profile info for each expiring membership.
        const ids = rows.map((r) => r.user_id);
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, member_code")
          .in("id", ids);
        const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

        const apiKey = process.env.LOVABLE_API_KEY;
        let sent = 0;

        if (apiKey) {
          const { sendLovableEmail } = await import("@lovable.dev/email-js");
          const senderDomain = process.env.LOVABLE_SENDER_DOMAIN;
          const from = senderDomain
            ? `MF SMC Trader <notify@${senderDomain}>`
            : "MF SMC Trader <notify@lovable.app>";

          for (const row of rows) {
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

        // Mark all as notified so we don't spam.
        await supabaseAdmin
          .from("memberships")
          .update({ expiry_notified_at: now.toISOString() })
          .in("user_id", ids);

        // Also flip clearly-expired rows to 'expired'.
        await supabaseAdmin
          .from("memberships")
          .update({ status: "expired" })
          .eq("status", "active")
          .lt("end_date", now.toISOString());

        return Response.json({ ok: true, checked: rows.length, sent });
      },
    },
  },
});
