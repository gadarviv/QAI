import { createServerFn } from "@tanstack/react-start";
import { getWebRequestContext } from "@tanstack/react-start/server";
import { z } from "zod";

const MAX_SPEC_CHARS = 50_000;
const MAX_IMAGE_DATA_URL_CHARS = 1_500_000;

type ScenarioResult = {
  title: string;
  area?: string;
  preconditions?: string;
  steps: string[];
  expected_result: string;
  priority: string;
  type: string;
};

async function callAI(messages: Array<{ role: string; content: string }>, schema: object) {
  // שליפת ה-Context של הבקשה הנוכחית
  const requestContext = getWebRequestContext() as any;
  
  // בדיקה מקיפה בכל המיקומים האפשריים שבהם Cloudflare/Nitro חושפים את ה-Bindings
  const aiBinding = 
    requestContext?.cloudflare?.env?.AI || 
    requestContext?.env?.AI ||
    requestContext?.context?.cloudflare?.env?.AI ||
    (globalThis as any).process?.env?.AI ||
    (globalThis as any).AI;

  if (!aiBinding) {
    console.error("DEBUG - Request Context structure:", JSON.stringify(requestContext));
    throw new Error("מנגנון ה-AI של Cloudflare לא נמצא ב-Bindings של השרת. ודא שהגדרת את ה-binding ב-wrangler.jsonc תחת השם AI באותיות גדולות.");
  }

  const modifiedMessages = [
    ...messages,
    {
      role: "system",
      content: `CRITICAL: You must respond ONLY with a valid JSON object strictly matching the structure expected by the application. Do not surround with markdown blocks. JSON structure schema: ${JSON.stringify(schema)}`
    }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  
  try {
    const aiResponse = await aiBinding.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: modifiedMessages,
    });

    clearTimeout(timeout);

    if (!aiResponse || !aiResponse.response) {
      throw new Error("לא התקבלה תשובה משרת ה-AI");
    }

    const content = aiResponse.response.trim();
    
    let cleanJson = content;
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```/, "").replace(/```$/, "").trim();
    }

    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return JSON.parse(cleanJson);

  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === "AbortError")
      throw new Error("פעולת ה-AI ארכה יותר מדי. נסה לקצר את האפיון או לפצל אותו.");
    throw e;
  }
}

function normalizeScenarios(result: unknown): ScenarioResult[] {
  const raw = (result as { scenarios?: unknown })?.scenarios;
  if (!Array.isArray(raw)) return [];

  return raw.reduce<ScenarioResult[]>((scenarios, item, index) => {
    const r = item as Record<string, unknown>;
    const steps = Array.isArray(r.steps)
      ? r.steps.map((step) => String(step ?? "").trim()).filter(Boolean)
      : [];
    const title = String(r.title ?? `תסריט בדיקה ${index + 1}`).trim();
    const expected = String(r.expected_result ?? "").trim();
    if (!title || steps.length === 0) return scenarios;

    const priority = ["low", "medium", "high", "critical"].includes(String(r.priority))
      ? String(r.priority)
      : "medium";
    const type = [
      "functional",
      "ui",
      "negative",
      "integration",
      "performance",
      "security",
    ].includes(String(r.type))
      ? String(r.type)
      : "functional";

    scenarios.push({
      title,
      area: String(r.area ?? "").trim() || undefined,
      preconditions: String(r.preconditions ?? "").trim() || undefined,
      steps,
      expected_result: expected || "המערכת פועלת בהתאם לדרישות האפיון",
      priority,
      type,
    });
    return scenarios;
  }, []);
}

const scenarioSchema = {
  type: "object",
  properties: {
    scenarios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          area: { type: "string" },
          preconditions: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          expected_result: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          type: { type: "string", enum: ["functional", "ui", "negative", "integration", "performance", "security"] },
        },
        required: ["title", "steps", "expected_result", "priority", "type"],
      },
    },
  },
  required: ["scenarios"],
};

export const generateScenarios = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        specContent: z.string().max(200000).optional().default(""),
        specName: z.string(),
        system: z.string().optional().default(""),
        images: z.array(z.string().max(MAX_IMAGE_DATA_URL_CHARS)).max(4).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const trimmed = (data.specContent ?? "").slice(0, MAX_SPEC_CHARS);
    const images = (data.images ?? []).filter((image) =>
      /^data:image\/(png|jpe?g|webp);base64,/i.test(image),
    );
    if (!trimmed.trim() && images.length === 0) {
      throw new Error("יש לספק תוכן אפיון או תמונות");
    }

    const system = (data.system ?? "").trim();
    const isFhir = system === "FHIR";

    const userText = `שם האפיון: ${data.specName}\n\n${trimmed ? `תוכן האפיון המלא:\n${trimmed}\n\n` : ""}${images.length ? `מצורפות ${images.length} תמונות.\n\n` : ""}צור תסריטי בדיקה מקיפים ומפורטים בעברית. אל תדלג על אף דרישה או זרימה באפיון.`;

    const basePrompt = `אתה מומחה QA בכיר. קבל אפיון פונקציונלי/טכני וייצר 10-40 תסריטי בדיקה מקיפים ומפורטים בעברית לפי המבנה הנדרש.`;
    const systemContent = basePrompt + "\n\nאל תקצר ואל תדלג. אסור להחזיר מערך ריק.";

    const result = await callAI(
      [
        { role: "system", content: systemContent },
        { role: "user", content: userText },
      ],
      scenarioSchema,
    );
    const scenarios = normalizeScenarios(result);
    if (scenarios.length === 0)
      throw new Error("ה-AI לא הצליח לייצר תסריטים מהאפיון.");
    return scenarios;
  });

const changesSchema = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scenario_id: { type: "string" },
          reason: { type: "string" },
          updated: {
            type: "object",
            properties: {
              title: { type: "string" },
              area: { type: "string" },
              preconditions: { type: "string" },
              steps: { type: "array", items: { type: "string" } },
              expected_result: { type: "string" },
              priority: { type: "string" },
              type: { type: "string" },
            },
            required: ["title", "steps", "expected_result", "priority", "type"],
          },
        },
        required: ["scenario_id", "reason", "updated"],
      },
    },
    new_scenarios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          area: { type: "string" },
          preconditions: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          expected_result: { type: "string" },
          priority: { type: "string" },
          type: { type: "string" },
        },
        required: ["title", "steps", "expected_result", "priority", "type"],
      },
    },
  },
  required: ["changes", "new_scenarios"],
};

export const analyzeChanges = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        specContent: z.string().min(10).max(200000),
        specName: z.string(),
        existingScenarios: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            area: z.string().nullable().optional(),
            preconditions: z.string().nullable().optional(),
            steps: z.array(z.string()),
            expected_result: z.string().nullable().optional(),
            priority: z.string(),
            type: z.string(),
          }),
        ),
      })
      .