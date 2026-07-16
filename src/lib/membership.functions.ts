import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Current user's profile (with member_code) + membership record. */
export const getMyMembership = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profileRes, memRes] = await Promise.all([
      supabase.from("profiles").select("full_name, email, member_code, created_at").eq("id", userId).maybeSingle(),
      supabase.from("memberships").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    return {
      profile: profileRes.data,
      membership: memRes.data,
    };
  });

/** Is the current user an admin? Used to gate the /admin page. */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

const lookupSchema = z.object({ code: z.string().trim().min(3).max(64) });

/** Admin: find a user by their member_code and return full account info. */
export const adminLookupUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => lookupSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { data: isAdmin } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, member_code, created_at")
      .eq("member_code", data.code.trim().toUpperCase())
      .maybeSingle();

    if (!profile) return { found: false as const };

    const { data: membership } = await supabaseAdmin
      .from("memberships")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle();

    return { found: true as const, profile, membership };
  });

const activateSchema = z.object({
  userId: z.string().uuid(),
  months: z.union([z.literal(1), z.literal(2)]),
});

/** Admin: manually activate a user's membership for 1 or 2 months. */
export const adminActivateMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => activateSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { data: isAdmin } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + data.months);

    const { error } = await supabaseAdmin.from("memberships").upsert(
      {
        user_id: data.userId,
        status: "active",
        duration_months: data.months,
        start_date: now.toISOString(),
        end_date: end.toISOString(),
        activated_by: context.userId,
        activated_at: now.toISOString(),
        expiry_notified_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) throw new Error(error.message);
    return { ok: true, start: now.toISOString(), end: end.toISOString() };
  });
