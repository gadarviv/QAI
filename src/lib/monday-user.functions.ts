import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCurrentMondayUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getCurrentMondayUserRowForApp } = await import("./monday-session.server");
    const row = await getCurrentMondayUserRowForApp(context.userId);
    if (!row) return null;
    return {
      mondayUserId: row.monday_user_id,
      name: row.name,
      email: row.email,
      photoUrl: row.photo_url,
      accountId: row.account_id,
    };
  });

export const disconnectMondayUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("monday_users").delete().eq("app_user_id", context.userId);
    const { clearMondaySession } = await import("./monday-session.server");
    await clearMondaySession();
    return { ok: true };
  });
