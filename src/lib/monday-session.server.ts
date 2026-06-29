// Server-only Monday session config + token lookup
import { deleteCookie, getCookie, setCookie, updateSession, useSession } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MondaySessionData = {
  mondayUserId?: string;
  mondayDisconnected?: boolean;
  pendingAppUserId?: string;
};

const MONDAY_DISCONNECTED_COOKIE = "qai_monday_disconnected";

function mondayDisconnectedCookieOptions() {
  return {
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function mondaySessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "qai_monday_session",
    maxAge: 60 * 60 * 24 * 30,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      path: "/",
    },
  };
}

export async function getMondaySession() {
  return useSession<MondaySessionData>(mondaySessionConfig());
}

export async function clearMondaySession() {
  setCookie(MONDAY_DISCONNECTED_COOKIE, "1", mondayDisconnectedCookieOptions());
  await updateSession<MondaySessionData>(mondaySessionConfig(), {
    mondayUserId: undefined,
    mondayDisconnected: true,
    pendingAppUserId: undefined,
  });
}

export function markMondayConnected() {
  deleteCookie(MONDAY_DISCONNECTED_COOKIE, { path: "/" });
}

export async function getCurrentMondayUserRowForApp(appUserId: string) {
  if (getCookie(MONDAY_DISCONNECTED_COOKIE) === "1") return null;
  const { data, error } = await supabaseAdmin
    .from("monday_users")
    .select("*")
    .eq("app_user_id", appUserId)
    .maybeSingle();
  if (error) {
    console.error("getCurrentMondayUserRowForApp error", error);
    return null;
  }
  return data;
}

export async function getCurrentMondayTokenForApp(appUserId: string): Promise<string | null> {
  const row = await getCurrentMondayUserRowForApp(appUserId);
  return row?.access_token ?? null;
}
