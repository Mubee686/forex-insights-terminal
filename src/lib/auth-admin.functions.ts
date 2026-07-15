/**
 * Admin-only auth helpers that need the Supabase service role key.
 * Only import from server functions / *.server.ts modules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const confirmSchema = z.object({
  userId: z.string().uuid(),
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
