import { supabaseAdmin } from "./src/integrations/supabase/client.server.ts";

const userId = process.argv[2];
const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
  email_confirm: true,
});
if (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
console.log("CONFIRMED:", data.user?.email, data.user?.email_confirmed_at);
