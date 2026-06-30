import { createServerFn } from "@tanstack/react-start";
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

// פונקציית העזר לקריאה ל-Cloudflare Workers AI
async function callAI(messages: Array<{ role: string; content: string }>, schema: object) {
  // גישה ל-AI Binding של Cloudflare מתוך ה-Global Context של השרת
  const env = (globalThis as any).process?.env || (globalThis as any);
  const aiBinding = env.AI;

  if (!aiBinding) {
    throw new Error("רכיב Cloudflare Workers AI אינו מוגדר או אינו מקושר כראוי ב-wrangler.jsonc");
  }

  // הוספת הנחיה קשיחה למערכת שיחזיר אך ורק JSON תקין התואם לפורמט הנדרש
  const systemMessage = messages.find(m => m.role === "system");
  if (systemMessage) {
    systemMessage.content += `\n\nCRITICAL: You must respond ONLY with a valid JSON object matching this schema: ${JSON.stringify(schema)}. Do not include any markdown formatting like \`\`\`json or regular text wrapper. Just the raw JSON object.`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    // הפעלת מודל Llama 3.1 8B Instruct החינמי והחזק בתוך Cloudflare
    const aiResponse = await aiBinding.run("@cf/meta/llama-3.1-8b-instruct", {
      messages,
    });

    clearTimeout(timeout);

    if (!aiResponse || !aiResponse.response) {
      throw new Error("לא התקבלה תגובה משרת ה-AI של Cloudflare");
    }

    let rawText = aiResponse.response.trim();
    
    // ניקוי תגיות קוד Markdown במידה והמודל בכל זאת הוסיף אותן
    if (rawText.startsWith("```json")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```/, "").replace(/```$/, "").trim();
    }

    return JSON.parse(rawText);

  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === "AbortError")
      throw new Error("פעולת ה-AI ארכה יותר מדי. נסה לקצר את האפיון או לפצל אותו.");
    if (e instanceof SyntaxError) {
      throw new Error("ה-AI החזיר מבנה נתונים שאינו JSON תקין. נסה שוב.");
    }
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
          title: { type: "string", description: "כותרת קצרה ותיאורית של התסריט" },
          area: { type: "string", description: "אזור פונקציונלי / מודול" },
          preconditions: { type: "string", description: "תנאים מקדימים לביצוע" },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "צעדי ביצוע מפורטים וניתנים לביצוע (לפחות 4)",
          },
          expected_result: { type: "string", description: "התוצאה הצפויה" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          type: {
            type: "string",
            enum: ["functional", "ui", "negative", "integration", "performance", "security"],
          },
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

    const userText = `שם האפיון: ${data.specName}\n\n${trimmed ? `תוכן האפיון המלא:\n${trimmed}\n\n` : ""}${images.length ? `מצורפות ${images.length} תמונות (צילומי מסך / סקיצות / תרשימים) - נתח אותן בקפידה והפק תסריטי בדיקה גם על בסיסן.\n\n` : ""}צור תסריטי בדיקה מקיפים ומפורטים בעברית. אל תדלג על אף דרישה או זרימה באפיון.`;

    // מודלים של טקסט ב-Workers AI רצים על קלט טקסטואלי. 
    // אם יש תמונות, מומלץ להשתמש במודל מולטימודלי כמו llama-3.2-11b-vision-instruct, 
    // אך לצורך פירוט הטקסט והנחיות המבנה המורכבות נשמור על זרימת הטקסט המאוחדת:
    const userContent = userText;

    const basePrompt = `אתה מומחה QA בכיר. קבל אפיון פונקציונלי/טכני וייצר 10-40 תסריטי בדיקה מקיפים ומפורטים בעברית. עבור על כל סעיף, דרישה, מסך וזרימה באפיון וכסה אותם. כסה: זרימות חיוביות (happy path), זרימות שליליות, מקרי קצה, ולידציות של שדות, הרשאות, ביצועים, אינטגרציות, וטיפול בשגיאות. כל תסריט חייב לכלול לפחות 4 צעדים מפורטים, ספציפיים וניתנים לביצוע (לא צעדים גנריים).

*** חוק קריטי לקבצי Excel: כאשר באפיון מופיעות מספר לשוניות (מסומנות בכותרת "### גיליון: <שם>"), חובה לעבור על כל הלשוניות ללא יוצא מן הכלל ולייצר תסריטים שמכסים את התוכן של כל אחת ואחת. אסור להתעלם מלשונית כלשהי גם אם נראית משנית. ציין בכל תסריט מאיזו לשונית הוא נגזר (בשדה "תיאור צעדי בדיקה"). ***`;

    const fhirPrompt = isFhir
      ? `
*** הקשר מערכות: BAPI / BAPI NMR הוא טרנזקציה ב-SAP שמבצעת המרה מ-SAP ל-FHIR. SAP/BAPI = מערכת מקור, FHIR = מערכת יעד. כשמופיע באפיון "BAPI" או "BAPI NMR" — התייחס אליו כשלב המרה ולא כ-endpoint עצמאי לקריאה. ***
*** חוק קריטי לבדיקות API/FHIR: צור אך ורק תסריטי GET (קריאה בלבד). אסור לייצר תסריטי POST / PUT / PATCH / DELETE — לא ב-Happy Path, לא בשליליים, לא במקרי קצה... ***` 
      : `
*** הקשר מערכות: BAPI / BAPI NMR הוא טרנזקציה ב-SAP... ***
*** הוראות לתסריטי SAP/נמ"ר — חובה לייצר תסריטים מפורטים ומקיפים... ***`;

    const systemContent = basePrompt + fhirPrompt + "\n\nאל תקצר ואל תדלג. אסור להחזיר מערך ריק.";

    const result = await callAI(
      [
        {
          role: "system",
          content: systemContent,
        },
        { role: "user", content: userContent },
      ],
      scenarioSchema,
    );
    
    const scenarios = normalizeScenarios(result);
    if (scenarios.length === 0)
      throw new Error("ה-AI לא הצליח לייצר תסריטים מהאפיון. נסו אפיון מפורט יותר.");
    return scenarios;
  });

const changesSchema = {