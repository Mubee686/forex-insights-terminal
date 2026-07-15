/**
 * Shared, client-safe admin configuration. No secrets live here —
 * just the email address that identifies the admin account, used to:
 *  - gate the real-time "new registration" toast on the dashboard
 *  - address the registration notification email sent by
 *    `notifyAdmin` (src/lib/auth-notifications.functions.ts)
 */
export const ADMIN_EMAIL = "m62804994@gmail.com";

/** Name of the Supabase Realtime broadcast channel used for admin notifications. */
export const ADMIN_NOTIFICATIONS_CHANNEL = "admin-notifications";
