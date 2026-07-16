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
 * Confirms a user's email by looking them up directly via the Auth admin API.
 *
 * Supabase requires email confirmation by default: `signUp` succeeds but
 * `signInWithPassword` fails with `email_not_confirmed` until confirmed.
 * We bypass this by force-confirming via the service-role admin API.
 *
 * Uses `listUsers` (direct auth.users lookup) instead of the `profiles`
 * table so it works even if the DB trigger hasn't run yet (race condition).
 */
export const autoConfirmByEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => confirmByEmailSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const targetEmail = data.email.trim().toLowerCase();

    // Query auth.users directly via the admin API — reliable even when the
    // profiles trigger hasn't fired yet (avoids "not_found" race condition).
    const { data: listData, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) {
      console.warn("[autoConfirmByEmail] listUsers failed:", listError.message);
      return { confirmed: false, reason: listError.message };
    }

    const user = listData?.users?.find(
      (u) => u.email?.toLowerCase() === targetEmail,
    );
    if (!user?.id) {
      console.warn("[autoConfirmByEmail] user not found in auth for:", targetEmail);
      return { confirmed: false, reason: "not_found" as const };
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    });
    if (error) {
      console.warn("[autoConfirmByEmail] updateUserById failed:", error.message);
      return { confirmed: false, reason: error.message };
    }
    console.log("[autoConfirmByEmail] confirmed:", targetEmail);
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

/**
 * Bulk-confirms every unconfirmed user in the project.
 * Call this once from the admin page to fix all pre-existing accounts.
 */
export const confirmAllUnconfirmedUsers = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: listData, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return { fixed: 0, error: listError.message };

    const unconfirmed = (listData?.users ?? []).filter(
      (u) => !u.email_confirmed_at,
    );

    let fixed = 0;
    for (const u of unconfirmed) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(u.id, {
        email_confirm: true,
      });
      if (!error) {
        fixed++;
        console.log("[confirmAllUnconfirmed] confirmed:", u.email);
      } else {
        console.warn("[confirmAllUnconfirmed] failed for", u.email, error.message);
      }
    }
    return { fixed, total: unconfirmed.length };
  });
