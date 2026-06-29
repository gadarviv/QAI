import { createFileRoute } from "@tanstack/react-router";

// One-shot bootstrap to create the initial superuser.
// Refuses to do anything once any admin already exists.
// Usage: POST /api/public/bootstrap-admin  body: { email, password }
// The handle_new_user DB trigger auto-grants admin to gad.arviv@moh.go.il;
// for any other email this route also grants the admin role explicitly.

export const Route = createFileRoute("/api/public/bootstrap-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: existingAdmins, error: e0 } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin")
          .limit(1);
        if (e0) return Response.json({ error: e0.message }, { status: 500 });
        if (existingAdmins && existingAdmins.length > 0) {
          return Response.json({ error: "Admin already exists. Bootstrap disabled." }, { status: 403 });
        }

        let body: { email?: string; password?: string };
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const email = (body.email ?? "").trim().toLowerCase();
        const password = body.password ?? "";
        if (!email || password.length < 8) {
          return Response.json({ error: "email and password (>=8 chars) required" }, { status: 400 });
        }

        const { data: created, error: e1 } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (e1 || !created.user) return Response.json({ error: e1?.message ?? "Failed" }, { status: 500 });

        await supabaseAdmin.from("user_roles").upsert({ user_id: created.user.id, role: "admin" });

        return Response.json({ ok: true, user_id: created.user.id });
      },
    },
  },
});
