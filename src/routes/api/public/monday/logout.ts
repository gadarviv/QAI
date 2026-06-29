import { createFileRoute } from "@tanstack/react-router";
import { clearMondaySession, mondaySessionConfig } from "@/lib/monday-session.server";

async function handleLogout(request: Request) {
  const url = new URL(request.url);
  try {
    await clearMondaySession();
  } catch (err) {
    console.error("monday logout error", err);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: `${url.origin}/` },
  });
}

export { handleLogout, mondaySessionConfig };

export const Route = createFileRoute("/api/public/monday/logout")({
  server: {
    handlers: {
      GET: async ({ request }) => handleLogout(request),
      POST: async ({ request }) => handleLogout(request),
    },
  },
});
