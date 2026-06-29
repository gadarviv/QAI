import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMondayUser, disconnectMondayUser } from "@/lib/monday-user.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, Loader2 } from "lucide-react";

export type MondayUser = {
  mondayUserId: string;
  name: string | null;
  email: string | null;
  photoUrl: string | null;
  accountId: string | null;
};

const MONDAY_AUTH_EVENT = "qai:monday-auth-changed";

function emitMondayAuthChange(detail: { user: MondayUser | null; disconnected?: boolean }) {
  window.dispatchEvent(new CustomEvent(MONDAY_AUTH_EVENT, { detail }));
}

export function useMondayUser() {
  const getUser = useServerFn(getCurrentMondayUser);
  const [user, setUser] = useState<MondayUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = (await getUser()) as MondayUser | null;
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [getUser]);

  const setConnectedUser = useCallback((nextUser: MondayUser) => {
    setUser(nextUser);
    setLoading(false);
    emitMondayAuthChange({ user: nextUser });
  }, []);

  const disconnectUser = useCallback(() => {
    setUser(null);
    setLoading(false);
    emitMondayAuthChange({ user: null, disconnected: true });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clear local state whenever the Supabase auth user changes
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => {
      setUser(null);
      setLoading(true);
      refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    const onAuthChange = (event: Event) => {
      const detail = (event as CustomEvent<{ user: MondayUser | null; disconnected?: boolean }>).detail;
      if (detail?.disconnected) {
        setUser(null);
        setLoading(false);
        return;
      }
      if (detail?.user?.mondayUserId) {
        setUser(detail.user);
        setLoading(false);
      }
    };
    window.addEventListener(MONDAY_AUTH_EVENT, onAuthChange);
    return () => window.removeEventListener(MONDAY_AUTH_EVENT, onAuthChange);
  }, []);

  return { user, loading, refresh, setConnectedUser, disconnectUser };
}

export function MondayAuthButton() {
  const { user, loading, refresh, setConnectedUser, disconnectUser } = useMondayUser();
  const disconnectFn = useServerFn(disconnectMondayUser);
  const [loginHref, setLoginHref] = useState<string>("/api/monday/login");

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const id = data.user?.id;
      setLoginHref(id ? `/api/monday/login?app_user=${encodeURIComponent(id)}` : "/api/monday/login");
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const applyConnectedUser = (data: unknown) => {
      const payload = data as { type?: string; user?: MondayUser };
      if (payload.type !== "monday-oauth-complete") return;
      if (payload.user?.mondayUserId) setConnectedUser(payload.user);
      else refresh();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      applyConnectedUser(event.data);
    };
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("monday-oauth");
      bc.onmessage = (e) => applyConnectedUser(e.data);
    } catch {
      // ignore
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      bc?.close();
    };
  }, [refresh, setConnectedUser]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> טוען…
      </div>
    );
  }

  const handleLogout = async () => {
    disconnectUser();
    try {
      await disconnectFn();
    } catch (err) {
      console.error("disconnect monday failed", err);
    }
  };

  if (!user) {
    return (
      <Button
        asChild
        size="sm"
        className="rounded-full"
      >
        <a href={loginHref} target="_blank" rel="noreferrer">
          <LogIn className="ml-1.5 h-4 w-4" /> התחבר ל-Monday
        </a>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs">
      {user.photoUrl ? (
        <img
          src={user.photoUrl}
          alt={user.name ?? ""}
          className="h-6 w-6 rounded-full object-cover"
        />
      ) : null}
      <span className="font-medium">{user.name ?? user.email ?? "Monday"}</span>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleLogout}
        title="התנתקות"
        className="h-6 w-6 rounded-full"
      >
        <LogOut className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
