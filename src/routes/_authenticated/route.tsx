import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Shield } from "lucide-react";
import { getMe } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const meFn = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{email}</span>
            {me?.is_admin && (
              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-semibold">
                מנהל-על
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {me?.is_admin && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin">
                  <Shield className="ml-1 h-4 w-4" /> ניהול
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="ml-1 h-4 w-4" /> התנתק
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
    </div>
  );
}
