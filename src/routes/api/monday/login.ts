import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/monday/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.MONDAY_CLIENT_ID;
        if (!clientId) {
          return new Response("MONDAY_CLIENT_ID is not set", { status: 500 });
        }
        const url = new URL(request.url);
        const appUserId = url.searchParams.get("app_user") ?? "";
        const redirectUri = `${getPublicOrigin(request)}/api/monday/callback`;

        if (appUserId) {
          const { getMondaySession } = await import("@/lib/monday-session.server");
          const session = await getMondaySession();
          await session.update({ pendingAppUserId: appUserId });
        }

        const authorize = new URL("https://auth.monday.com/oauth2/authorize");
        authorize.searchParams.set("client_id", clientId);
        authorize.searchParams.set("redirect_uri", redirectUri);
        authorize.searchParams.set("response_type", "code");

        return Response.redirect(authorize.toString(), 302);
      },
    },
  },
});
