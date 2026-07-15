import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { ADMIN_EMAIL, ADMIN_NOTIFICATIONS_CHANNEL } from "@/lib/admin-config";

const payloadSchema = z.object({
  email: z.string().email(),
  fullName: z.string().max(200).optional(),
});

interface GeoInfo {
  label: string;
  city?: string;
  country?: string;
}

/** Best-effort IP → city/country lookup via the free ipapi.co API. Never throws. */
async function lookupGeo(ip: string | null): Promise<GeoInfo> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return { label: "Unknown location" };
  }
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "mf-smc-trader/1.0" },
    });
    if (!res.ok) return { label: "Unknown location" };
    const json = (await res.json()) as { city?: string; country_name?: string; error?: boolean; reason?: string };
    if (json.error) return { label: "Unknown location" };
    const parts = [json.city, json.country_name].filter(Boolean);
    return {
      label: parts.length ? parts.join(", ") : "Unknown location",
      city: json.city,
      country: json.country_name,
    };
  } catch {
    return { label: "Unknown location" };
  }
}

/** Extracts the client's public IP from standard proxy headers. */
function extractClientIp(): string | null {
  try {
    const request = getRequest();
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    return request.headers.get("x-real-ip");
  } catch {
    return null;
  }
}

/**
 * Fired once, right after a new user successfully registers. Sends the
 * admin an email with the registrant's email, approximate location (from
 * their IP, via ipapi.co), and the registration timestamp — deliberately
 * never the password, which only ever exists hashed in Supabase Auth. Also
 * broadcasts the same event over Supabase Realtime so it can pop up as a
 * live toast on the admin's dashboard.
 */
export const notifyAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => payloadSchema.parse(data))
  .handler(async ({ data }) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { dateStyle: "full" } as Intl.DateTimeFormatOptions);
    const timeStr = now.toLocaleTimeString("en-US", { timeStyle: "long" } as Intl.DateTimeFormatOptions);
    const geo = await lookupGeo(extractClientIp());

    // Broadcast to any admin dashboard listening in real time — independent
    // of whether the email below succeeds, since this is the "live" path.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const channel = supabaseAdmin.channel(ADMIN_NOTIFICATIONS_CHANNEL);
      await channel.send({
        type: "broadcast",
        event: "new-registration",
        payload: {
          email: data.email,
          fullName: data.fullName ?? null,
          location: geo.label,
          registeredAt: now.toISOString(),
        },
      });
      await channel.unsubscribe();
    } catch (err) {
      console.warn("[notifyAdmin] realtime broadcast failed", err);
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      console.warn("[notifyAdmin] LOVABLE_API_KEY not configured, skipping email");
      return { sent: false, reason: "no_api_key" as const };
    }

    const { sendLovableEmail, EmailAPIError } = await import("@lovable.dev/email-js");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
        <h2 style="color:#0ea5e9;margin:0 0 12px;">New user registration — MF SMC Trader</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#64748b;">Name</td><td style="padding:6px 0;">${data.fullName ?? "—"}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;">${data.email}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Approximate location</td><td style="padding:6px 0;">${geo.label}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Date</td><td style="padding:6px 0;">${dateStr}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Time</td><td style="padding:6px 0;">${timeStr}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:12px;color:#94a3b8;">
          The password is never included here — it is stored only as a secure hash in Supabase Auth.
        </p>
      </div>`;

    try {
      const senderDomain = process.env.LOVABLE_SENDER_DOMAIN;
      const from = senderDomain
        ? `MF SMC Trader <notify@${senderDomain}>`
        : "MF SMC Trader <notify@lovable.app>";
      await sendLovableEmail(
        {
          to: ADMIN_EMAIL,
          from,
          sender_domain: senderDomain,
          subject: `New user registration: ${data.email}`,
          html,
          text: `New user registration\nName: ${data.fullName ?? "—"}\nEmail: ${data.email}\nLocation: ${geo.label}\nDate: ${dateStr}\nTime: ${timeStr}`,
        },
        { apiKey },
      );
      return { sent: true };
    } catch (err) {
      if (err instanceof EmailAPIError) {
        console.warn("[notifyAdmin] EmailAPIError", err.code, err.message);
        return { sent: false, reason: err.code ?? "email_api_error" };
      }
      console.warn("[notifyAdmin] failed", err);
      return { sent: false, reason: "unknown_error" };
    }
  });
