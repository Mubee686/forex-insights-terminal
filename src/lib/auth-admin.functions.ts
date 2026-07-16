/**
 * Admin-only auth helpers that need the Supabase service role key.
 * Only import from server functions / *.server.ts modules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const confirmSchema = z.object({
  userId: z.string().uuid(),
});

const confirmByEmailSchema = z.object({
  email: z.string().email(),
});

/**
 * Immediately confirms a freshly-registered user's email server-side.
 *
 * Supabase Auth requires email confirmation by default: `signUp` succeeds
 * but `signInWithPassword` then fails with `email_not_confirmed` until the
 * user clicks the confirmation link in their inbox. That confirmation step
 * is invisible to the client, so it read to users/testers as a mysterious
 * "email not found" style failure right after registering.
 *
 * We skip that friction by confirming the email ourselves via the admin
 * API the moment registration completes, so the same credentials can log
 * in right away.
 */
/**
 * Confirms a user's email by looking them up by email address.
 * Used as a fallback on login when a pre-existing account was registered
 * before the service role key was set (so auto-confirm silently failed).
 */
export const autoConfirmByEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => confirmByEmailSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    // Find the user's id via the profiles table (service role bypasses RLS)
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("email", data.email.trim().toLowerCase())
      .maybeSingle();
    if (!profile?.id) return { confirmed: false, reason: "not_found" as const };
    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      email_confirm: true,
    });
    if (error) return { confirmed: false, reason: error.message };
    return { confirmed: true };
  });

export const confirmUserEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => confirmSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email_confirm: true,
    });
    if (error) {
      console.warn("[confirmUserEmail] failed", error.message);
      return { confirmed: false, reason: error.message };
    }
    return { confirmed: true };
  });
