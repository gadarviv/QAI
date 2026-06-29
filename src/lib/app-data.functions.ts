import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAppData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check admin
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    let allowedSystemIds: string[] | null = null;
    let allowedSystemNames: string[] | null = null;

    if (!isAdmin) {
      const { data: us } = await supabaseAdmin
        .from("user_systems")
        .select("system_id, systems(name)")
        .eq("user_id", context.userId);
      allowedSystemIds = (us ?? []).map((u: any) => u.system_id);
      allowedSystemNames = (us ?? []).map((u: any) => u.systems?.name).filter(Boolean);
    }

    let specsQuery = supabaseAdmin.from("specs").select("*").order("created_at", { ascending: false });
    if (!isAdmin) {
      if (!allowedSystemIds || allowedSystemIds.length === 0) {
        // No systems assigned -> no data
        return { specs: [], scenarios: [], changes: [] };
      }
      // Match by system_id OR by system name (legacy rows)
      const idList = `(${allowedSystemIds.join(",")})`;
      const nameList = `(${(allowedSystemNames ?? []).map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})`;
      specsQuery = specsQuery.or(`system_id.in.${idList},system.in.${nameList}`);
    }

    const { data: specsData, error: specsErr } = await specsQuery;
    if (specsErr) throw specsErr;

    const specIds = (specsData ?? []).map((s: any) => s.id);

    let scenariosData: any[] = [];
    let changesData: any[] = [];

    if (isAdmin) {
      const [sc, ch] = await Promise.all([
        supabaseAdmin.from("scenarios").select("*").order("created_at", { ascending: false }),
        supabaseAdmin
          .from("scenario_changes")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ]);
      if (sc.error) throw sc.error;
      if (ch.error) throw ch.error;
      scenariosData = sc.data ?? [];
      changesData = ch.data ?? [];
    } else if (specIds.length > 0) {
      const { data: sc, error: scErr } = await supabaseAdmin
        .from("scenarios")
        .select("*")
        .in("spec_id", specIds)
        .order("created_at", { ascending: false });
      if (scErr) throw scErr;
      scenariosData = sc ?? [];

      const scenarioIds = scenariosData.map((s: any) => s.id);
      if (scenarioIds.length > 0) {
        const { data: ch, error: chErr } = await supabaseAdmin
          .from("scenario_changes")
          .select("*")
          .eq("status", "pending")
          .in("scenario_id", scenarioIds)
          .order("created_at", { ascending: false });
        if (chErr) throw chErr;
        changesData = ch ?? [];
      }
    }

    return {
      specs: specsData ?? [],
      scenarios: scenariosData,
      changes: changesData,
    };
  });
