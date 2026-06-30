// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      "process.env.SUPABASE_PROJECT_ID": JSON.stringify("swyddxzpulyqfmgtwdno"),
      "process.env.SUPABASE_URL": JSON.stringify("https://swyddxzpulyqfmgtwdno.supabase.co"),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3eWRkeHpwdWx5cWZtZ3R3ZG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Mjg2MzQsImV4cCI6MjA5NDIwNDYzNH0.A45vzBkNUzxqv1X6ZwKLNSwEZ_XMalJBVeRqLd56cCs"),
      "process.env.LOVABLE_API_KEY": JSON.stringify("true")
    }
  }
});