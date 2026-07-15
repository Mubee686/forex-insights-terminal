import { supabaseAdmin } from "./src/integrations/supabase/client.server.ts";

const userId = process.argv[2];
const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
  email_confirm: true,
});
console.log("ERROR OBJ:", JSON.stringify(error, null, 2));
console.log("KEY PREFIX:", (process.env.SUPABASE_SERVICE_ROLE_KEY || "").slice(0, 12));
console.log("KEY LEN:", (process.env.SUPABASE_SERVICE_ROLE_KEY || "").length);
