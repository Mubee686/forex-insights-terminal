import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ADMIN_EMAIL = "m62804994@gmail.com";

const payloadSchema = z.object({
  event: z.enum(["register", "login"]),
  email: z.string().email(),
  fullName: z.string().max(200).optional(),
});

export const notifyAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => payloadSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      console.warn("[notifyAdmin] LOVABLE_API_KEY not configured");
      return { sent: false, reason: "no_api_key" as const };
    }

    const { sendLovableEmail, EmailAPIError } = await import("@lovable.dev/email-js");

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { dateStyle: "full" } as Intl.DateTimeFormatOptions);
    const timeStr = now.toLocaleTimeString("en-US", { timeStyle: "long" } as Intl.DateTimeFormatOptions);

    const title = data.event === "register" ? "New user registration" : "User login";
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
        <h2 style="color:#0ea5e9;margin:0 0 12px;">${title} — MF SMC Trader</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#64748b;">Name</td><td style="padding:6px 0;">${data.fullName ?? "—"}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;">${data.email}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Date</td><td style="padding:6px 0;">${dateStr}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Time</td><td style="padding:6px 0;">${timeStr}</td></tr>
        </table>
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
          subject: `${title}: ${data.email}`,
          html,
          text: `${title}\nName: ${data.fullName ?? "—"}\nEmail: ${data.email}\nDate: ${dateStr}\nTime: ${timeStr}`,
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
