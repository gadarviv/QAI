import { createServerFn } from "@tanstack/start";

export const generateScenariosServer = createServerFn("POST", async (payload: { specContent: string; specName: string; system: string; images: string[] }) => {
  const { generateScenarios } = await import("@/lib/scenarios.functions");
  return generateScenarios(payload);
});

export const analyzeChangesServer = createServerFn("POST", async (payload: { specContent: string; specName: string; existingScenarios: any[] }) => {
  const { analyzeChanges } = await import("@/lib/scenarios.functions");
  return analyzeChanges(payload);
});

export const getAppDataServer = createServerFn("GET", async () => {
  const { getAppData } = await import("@/lib/app-data.functions");
  return getAppData();
});
