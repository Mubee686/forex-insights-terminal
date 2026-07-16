import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// The generated types.ts doesn't yet include the new tables (profiles.member_code,
// user_roles, memberships). Cast the client to `any` locally so the queries type-check
// while runtime behaviour stays fully typed at the SQL layer via RLS + zod validation.
type AnyClient = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function requireAdmin(sb: AnyClient, userId: string) {
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

/** Current user's profile (with member_code) + membership record. */
export const getMyMembership = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as AnyClient;
    const [profileRes, memRes] = await Promise.all([
      sb.from("profiles").select("full_name, email, member_code, created_at").eq("id", context.userId).maybeSingle(),
      sb.from("memberships").select("*").eq("user_id", context.userId).maybeSingle(),
    ]);
    return { profile: profileRes.data, membership: memRes.data };
  });

/** Is the current user an admin? */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as AnyClient;
    const { data } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

const lookupSchema = z.object({ code: z.string().trim().min(3).max(64) });

export const adminLookupUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => lookupSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase as AnyClient, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AnyClient;

    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, email, member_code, created_at")
      .eq("member_code", data.code.trim().toUpperCase())
      .maybeSingle();

    if (!profile) return { found: false as const };

    const { data: membership } = await admin
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

export const adminActivateMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => activateSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase as AnyClient, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AnyClient;

    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + data.months);

    const { error } = await admin.from("memberships").upsert(
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
