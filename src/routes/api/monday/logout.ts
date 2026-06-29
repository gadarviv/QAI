import { createFileRoute } from "@tanstack/react-router";
import { handleLogout } from "../public/monday/logout";

export const Route = createFileRoute("/api/monday/logout")({
  server: {
    handlers: {
      GET: async ({ request }) => handleLogout(request),
      POST: async ({ request }) => handleLogout(request),
    },
  },
});