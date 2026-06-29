import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getMondaySession, markMondayConnected } from "@/lib/monday-session.server";

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

function getPublicOrigin(request: Request) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = forwardedHost || firstHeaderValue(request.headers.get("host"));
  if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return `${forwardedProto || "https"}://${host}`;
  }

  const referer = request.headers.get("referer");
  if (referer) return new URL(referer).origin;

  return new URL(request.url).origin;
}

export const Route = createFileRoute("/api/monday/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          return new Response(`Monday OAuth error: ${error}`, { status: 400 });
        }
        if (!code) {
          return new Response("Missing code", { status: 400 });
        }

        const clientId = process.env.MONDAY_CLIENT_ID;
        const clientSecret = process.env.MONDAY_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return new Response("Monday OAuth not configured", { status: 500 });
        }
        const redirectUri = `${getPublicOrigin(request)}/api/monday/callback`;

        // Exchange code for token
        const tokenRes = await fetch("https://auth.monday.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
          access_token?: string;
          token_type?: string;
          scope?: string;
          error?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          return new Response(
            `Token exchange failed: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.statusText}`,
            { status: 502 },
          );
        }
        const accessToken = tokenJson.access_token;

        const grantedScopes = new Set((tokenJson.scope ?? "").split(/[\s,]+/).filter(Boolean));
        const missingWriteScopes = ["boards:read", "boards:write"].filter((scope) => !grantedScopes.has(scope));
        if (grantedScopes.size > 0 && missingWriteScopes.length > 0) {
          return new Response(
            `Monday OAuth missing required permissions: ${missingWriteScopes.join(", ")}. Please reconnect Monday and approve board read/write access.`,
            { status: 403 },
          );
        }

        // Fetch profile (me)
        const meRes = await fetch("https://api.monday.com/v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: accessToken,
            "API-Version": "2025-04",
          },
          body: JSON.stringify({
            query: `query { me { id name email photo_thumb account { id } } }`,
          }),
        });
        const meJson = (await meRes.json().catch(() => ({}))) as {
          data?: {
            me?: {
              id?: string | number;
              name?: string;
              email?: string;
              photo_thumb?: string;
              account?: { id?: string | number };
            };
          };
          errors?: Array<{ message: string }>;
        };
        const me = meJson?.data?.me;
        if (!me?.id) {
          return new Response(
            `Failed to fetch Monday user: ${meJson?.errors?.[0]?.message ?? "unknown"}`,
            { status: 502 },
          );
        }

        const mondayUserId = String(me.id);
        const accountId = me.account?.id ? String(me.account.id) : null;

        const session = await getMondaySession();
        const appUserId = session.data.pendingAppUserId ?? null;

        // Remove any prior Monday connection for this app user (different Monday account)
        if (appUserId) {
          await supabaseAdmin
            .from("monday_users")
            .delete()
            .eq("app_user_id", appUserId)
            .neq("monday_user_id", mondayUserId);
        }

        const { error: upsertErr } = await supabaseAdmin
          .from("monday_users")
          .upsert(
            {
              monday_user_id: mondayUserId,
              app_user_id: appUserId,
              access_token: accessToken,
              token_type: tokenJson.token_type ?? "bearer",
              scope: tokenJson.scope ?? null,
              name: me.name ?? null,
              email: me.email ?? null,
              photo_url: me.photo_thumb ?? null,
              account_id: accountId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "monday_user_id" },
          );
        if (upsertErr) {
          console.error("upsert monday_users failed", upsertErr);
          return new Response("Failed to save Monday user", { status: 500 });
        }

        markMondayConnected();
        await session.update({ mondayUserId, mondayDisconnected: false, pendingAppUserId: undefined });

        const connectedUser = JSON.stringify({
          type: "monday-oauth-complete",
          user: {
            mondayUserId,
            name: me.name ?? null,
            email: me.email ?? null,
            photoUrl: me.photo_thumb ?? null,
            accountId,
          },
        }).replace(/</g, "\\u003c");

        return new Response(
          `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Monday connected</title></head><body><script>var payload=${connectedUser};try{localStorage.removeItem("qai_monday_disconnected");localStorage.setItem("qai_monday_user",JSON.stringify(payload.user));}catch(e){}try{var bc=new BroadcastChannel("monday-oauth");bc.postMessage(payload);bc.close();}catch(e){}try{if(window.opener){window.opener.postMessage(payload,window.location.origin);}}catch(e){}setTimeout(function(){try{window.close();}catch(e){}window.location.replace("/");},150);</script><p>החיבור ל-Monday הושלם. אפשר לסגור את החלון.</p></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
    },
  },
});
