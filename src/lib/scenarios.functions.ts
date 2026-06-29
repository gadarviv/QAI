import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-3-flash-preview";
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
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  let res: Response;
  try {
    res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        tools: [
          {
            type: "function",
            function: {
              name: "submit",
              description: "Submit structured result",
              parameters: schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit" } },
      }),
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === "AbortError")
      throw new Error("פעולת ה-AI ארכה יותר מדי. נסה לקצר את האפיון או לפצל אותו.");
    throw e;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("יותר מדי בקשות, נסה שוב בעוד רגע");
    if (res.status === 402) throw new Error("נגמרו הקרדיטים ל-AI. יש להוסיף בהגדרות.");
    if (res.status === 400)
      throw new Error("ה-AI דחה את הקלט. נסה להעלות תמונת JPG/PNG קטנה יותר או אפיון קצר יותר.");
    throw new Error(`AI error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments;
  if (args) return typeof args === "string" ? JSON.parse(args) : args;

  const content = message?.content;
  const jsonMatch = typeof content === "string" ? content.match(/\{[\s\S]*\}/) : null;
  if (jsonMatch) return JSON.parse(jsonMatch[0]);

  throw new Error("לא התקבלה תשובה מובנית מה-AI");
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

    const userContent: any =
      images.length === 0
        ? userText
        : [
            { type: "text", text: userText },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ];

    const basePrompt = `אתה מומחה QA בכיר. קבל אפיון פונקציונלי/טכני ו/או תמונות וייצר 10-40 תסריטי בדיקה מקיפים ומפורטים בעברית. עבור על כל סעיף, דרישה, מסך וזרימה באפיון וכסה אותם. כסה: זרימות חיוביות (happy path), זרימות שליליות, מקרי קצה, ולידציות של שדות, הרשאות, ביצועים, אינטגרציות, וטיפול בשגיאות. כל תסריט חייב לכלול לפחות 4 צעדים מפורטים, ספציפיים וניתנים לביצוע (לא צעדים גנריים).

*** חוק קריטי לקבצי Excel: כאשר באפיון מופיעות מספר לשוניות (מסומנות בכותרת "### גיליון: <שם>"), חובה לעבור על כל הלשוניות ללא יוצא מן הכלל ולייצר תסריטים שמכסים את התוכן של כל אחת ואחת. אסור להתעלם מלשונית כלשהי גם אם נראית משנית. ציין בכל תסריט מאיזו לשונית הוא נגזר (בשדה "תיאור צעדי בדיקה"). ***`;

    const fhirPrompt = isFhir
      ? `

*** הקשר מערכות: BAPI / BAPI NMR הוא טרנזקציה ב-SAP שמבצעת המרה מ-SAP ל-FHIR. SAP/BAPI = מערכת מקור, FHIR = מערכת יעד. כשמופיע באפיון "BAPI" או "BAPI NMR" — התייחס אליו כשלב המרה ולא כ-endpoint עצמאי לקריאה. ***

*** חוק קריטי לבדיקות API/FHIR: צור אך ורק תסריטי GET (קריאה בלבד). אסור לייצר תסריטי POST / PUT / PATCH / DELETE — לא ב-Happy Path, לא בשליליים, לא במקרי קצה. אם נדרש לבדוק יצירה/עדכון/מחיקה — נסח את התסריט כ-GET שמאמת את מצב המשאב הקיים ב-QA (למשל GET Patient/<id> ובדיקה ששדות מסוימים תואמים את האפיון). כל URL חייב להיות GET. ***

*** מודל הדומיין - מקרים ותנועות (Encounter): ***
• מקרה = Encounter ראשי. מזהה NMR.<num> (NMR.31635886).
• תנועה = Encounter בן (קבלה/אשפוז/ביקור/שחרור). מזהה NMR.<num>.<seq> (NMR.31635886.1, .2, .3).
• כל תנועה חייבת partOf.reference=Encounter/NMR.<num>.
• subject.reference=Patient/<PatientId> בכל מקרה ותנועה.
• מקרה נסגר (status=finished) בשחרור/פטירה; הגעה הבאה=מקרה חדש.
• meta.profile חובה: il-core-encounter, ולתנועות גם dgmc-encounter-movement.
• identifier: nmr-movement-number (ערך 31635886.1), nmr2cml-identifier.
• location.identifier.system=nmr-ou-text עם ערך עברי.
• למשיכת כל תנועות מקרה: Encounter?part-of=Encounter/NMR.<num>.


*** מודל מסמך דימות (DiagnosticReport): ***
• נוצר רק לאחר אישור הזמנת דימות ב-SAP. אם אין ServiceRequest מאושר אסור שייווצר DiagnosticReport.
• id בפורמט IMGFIND.DOCNUM.VER (לדוגמה IMGFIND.0000000000000010018111709.01).
• meta.profile חובה: dgmc-imaging-interpretation + il-core-diagnostic-report.
• identifier: nmr-img-doc-ver (עם גרסה), nmr-img-doc (ללא גרסה).
• basedOn[] חובה: רשימת reference ל-ServiceRequest/IMG.NUM שאושרו ב-SAP. בלי basedOn לפחות אחד - ולידציה נכשלת.
• status=final, _status.extension עם valueCode (FR=סופי) לפי שלב המסמך.
• category=Imaging (SNOMED 363679005), code=Imaging report (SNOMED 4201000179104).
• subject.reference=Patient/PAT.NUM, encounter.reference=Encounter/NMR.NUM (חובה לקשר למקרה הפעיל).
• performer=Organization/ORG.NUM (היחידה המבצעת), resultsInterpreter.identifier.value=קוד משתמש SAP (VMA, למשל ADI).
• בדיקות חובה: יצירת DiagnosticReport ללא ServiceRequest מאושר נכשלת; כל basedOn[] חייב להצביע על ServiceRequest קיים ב-SAP; encounter.reference חייב להצביע על Encounter פעיל; versionId עולה בכל עדכון; שינוי status בלי הרשאה SAP מתאימה נכשל.

*** מודל מטופל (Patient): ***
• מייצג את פרטי המטופל (דמוגרפיה, שם, מין, כתובת, קופ"ח, שפה).
• id בפורמט PAT.<num> (PAT.2195471). subject.reference של כל המשאבים חייב להצביע ל-Patient/PAT.<num> קיים.
• meta.profile חובה: il-core-patient + dgmc-patient.
• meta.security: patientDemographics (system il-hdp-information-buckets).
• identifier חובה: nmr-pat-int-num (ערך זהה למספר ב-id, למשל 2195471).
• extension ext-il-hmo: valueCodeableConcept עם שני coding - paying-entity-moh (קוד 4 ספרות לקופה, למשל 101=כללית) + nmr-hmo-code (קוד פנימי, למשל 10=כללית). שני הקודים חייבים להיות עקביים.
• name[].family, name[].given עם extension language=he עבור עברית.
• gender: male/female/other/unknown.
• birthDate או _birthDate.extension data-absent-reason=unknown כשלא ידוע.
• deceasedBoolean=false כשחי; deceasedDateTime כשנפטר (אז גם מקרה פעיל ייסגר).
• address[]._city.extension ext-city-code עם coding מ-city-symbol (0=לא רשום).
• communication[].language.coding.system=urn:ietf:bcp:47, code=he/ar/en.
• בדיקות חובה: id תואם ל-identifier.value; פרופילים חובה קיימים; coding של קופ"ח עקבי בין שתי המערכות; gender ערך חוקי; כאשר deceasedBoolean=true אסור שיהיו מקרים פעילים (status!=finished); subject.reference במשאבים אחרים מצביע ל-Patient קיים.

*** מודל הזמנת דימות (ServiceRequest): ***
• מייצג הזמנת בדיקת דימות שנוצרה ב-SAP. זהו ה-basedOn של DiagnosticReport.
• id בפורמט IMG.<orderNum>.<lineNum> (IMG.02337023.4897). requisition.value=מספר ההזמנה הראשי (02337023) - כל ההזמנות מאותו סבב חולקות אותו.
• meta.profile חובה: il-core-service-request + dgmc-imaging-request.
• identifier חובה (שניים): type=PGN (Placer Group Number) עם system nmr-img-order-service-uri וערך זהה ל-orderNum.lineNum; type=ACSN (Accession ID) עם system img-accession-number (מזהה DICOM ייחודי, 16 ספרות).
• status: draft/active/completed/revoked/cancelled. _status.extension nmr-service-status-code עם valueCode (PRF=בוצע, ORD=הוזמן, CNL=בוטל) - חייב להיות עקבי עם status.
• intent=filler-order (תמיד עבור הזמנות דימות פנימיות).
• category[] חובה שני קודים: SNOMED 363679005 (Imaging) + nmr-imaging-unit-category (קוד עברי כמו "מכרנט4") + coview-imaging-unit-category-uri (קוד מספרי כמו 1=Xray, 2=CT, 3=US, 4=MRI).
• code.coding חייב שלושה systems: nmr-img-service-group-code (קוד פנימי B0322), img-service-single-code (קוד מפורט 10 ספרות), medical-service-moh (קוד משרד הבריאות 5 ספרות).
• subject.reference=Patient/PAT.NUM, encounter.reference=Encounter/NMR.NUM (חייב מקרה פעיל באותו זמן).
• occurrenceDateTime=זמן ביצוע מתוכנן, authoredOn=זמן יצירת ההזמנה.
• requester=Organization/ORG.NUM (המחלקה המזמינה) + identifier nmr-ou-text עם שם עברי. performer[]=Organization/ORG.NUM (היחידה המבצעת, למשל מכ-רנטג).
• בדיקות חובה: ServiceRequest חייב להתקיים לפני יצירת DiagnosticReport מתאים (basedOn מצביע ל-IMG.<orderNum>.<lineNum>); status=completed דרוש לפני שניתן לסגור DiagnosticReport כ-final; ACSN ייחודי במערכת; subject/encounter מצביעים למשאבים קיימים ופעילים; הזמנה עם status=cancelled לא יכולה לייצר DiagnosticReport; שינוי category/code לאחר status=completed נכשל; versionId עולה בכל עדכון.


*** הוראות חובה לתסריטי FHIR — התסריטים נטענים לבורד Monday מספר 6897491336 ולכן חייבים להיות ממופים בדיוק לעמודות הבורד הבאות: ***
1. שדה area יוגדר כ-"FHIR".
2. שדה title יתחיל במספר מקרה רץ ובפורמט: "FHIR-### | <Resource>/<Method> | <תיאור קצר>" (לדוגמה: "FHIR-001 | Patient/POST | יצירת מטופל חדש").

*** חילוץ מזהים מהאפיון — חובה: ***
סרוק את האפיון וחלץ ממנו את כל המזהים הקונקרטיים (Patient ID, Encounter ID וכו) בפורמט PREFIX.NUMBER (למשל NMR.31635886, MZR.12345678). השתמש בדיוק במזהים שמופיעים באפיון — אל תמציא מזהים חדשים. אם האפיון מציין מספר Encounter, השתמש בו ב-URL של תסריטי Encounter. אם מציין מספר Patient, השתמש בו ב-URL של תסריטי Patient וכ-search param בתסריטי משאבים תלויים (Encounter?patient=..., Observation?patient=..., Condition?patient=...). אם האפיון לא מציין מזהה למשאב מסוים — השתמש ב-NMR.000000 כדוגמה והוסף הערה ב-"תיאור צעדי בדיקה" שיש להחליף ל-id אמיתי לפני ההרצה.

3. שדה steps יכיל בדיוק את הסעיפים הבאים, כל אחד כפריט נפרד במערך, באותו סדר ועם אותן תוויות בעברית:
   - "סטרקטורה/פרוצדורה: <שם Resource או Operation, למשל Patient, Observation, Encounter, $validate>"
   - "GET POSTMAN: <Method> https://iris-qa.fhir.dev.idgmc.org/csp/healthshare/bneizion/fhir/r4/<Resource>[/<id>][?<query>] — כתובת הבסיס קבועה, אחריה שם ה-Resource לפי האפיון, ועבור GET/PUT/DELETE/PATCH על משאב ספציפי הוסף לוכסן ואת ה-id שחולץ מהאפיון בפורמט PREFIX.NUMBER (לדוגמה: Encounter/NMR.31635886). עבור חיפוש השתמש ב-search params עם המזהים מהאפיון (Encounter?patient=NMR.12345678). עבור POST הכתובת מסתיימת בשם ה-Resource בלי id. לא להשתמש ב-hapi.fhir.org"
   - "תיאור צעדי בדיקה: <תיאור מילולי מסודר של הצעדים שהבודק מבצע ב-Postman, כולל Headers ו-Authorization>"
   - "JSON: <גוף הבקשה JSON תקין ומלא של אותו Resource, או 'לא רלוונטי' עבור GET>"
   - "BAPI/פרמטרים: <פרמטרים נשלחים ל-BAPI/לשכבת ה-Backend, או 'לא רלוונטי'>"
   - "Cardinality: <בדיקות 0..1 / 1..1 / 0..* / 1..* לשדות החובה והאופציונליים>"
   - "בדיקות המרה: <איך מומר השדה בין FHIR לבין מערכת המקור/יעד>"
   - "HL7: <ההודעת HL7 v2 המקבילה או הסגמנט הרלוונטי, או 'לא רלוונטי'>"
4. שדה expected_result הוא לב הבדיקה — הוא משווה בין מה שמצוין באפיון לבין ה-JSON שמתקבל מהשרת. הוא חייב לפתוח בשורה "תוצאה צפויה במערכת FHIR:" ולכלול: HTTP status code מדויק (200/201/400/401/403/404/422/500); רשימה מפורטת של שדות JSON שחייבים להופיע בתגובה עם הערך הצפוי מהאפיון, בפורמט נתיב=ערך (לדוגמה: resourceType=Encounter, id=NMR.31635886, status=finished, subject.reference=Patient/NMR.12345678, period.start=2024-01-15T08:00:00Z); לכל שדה ציין את הנתיב המלא ב-JSON (dot notation) ואת הערך הצפוי לפי האפיון; שדות חובה שאסור שיהיו חסרים, ושדות אסורים שאסור שיופיעו. ולאחריו שורה "תוצאה במטפל:" עם מה שאמור להתעדכן במערכת המטפל/הליבה.
5. עבור כל Resource חובה לכלול גם תסריטים שליליים: גוף לא תקין, טוקן פג/חסר, משאב לא קיים, ולידציה כשלה, הפרת Cardinality.
6. כסה Capability Statement, חיפוש (_search params), bundle/transaction, $validate, ו-conformance ל-StructureDefinition.`
      : `

*** הקשר מערכות: BAPI / BAPI NMR הוא טרנזקציה ב-SAP שמבצעת המרה מ-SAP ל-FHIR. SAP/BAPI = מערכת מקור, FHIR = מערכת יעד. כשמופיע באפיון "BAPI" או "BAPI NMR" — התייחס אליו כשלב המרה ולא כ-endpoint עצמאי לקריאה. ***

*** הוראות לתסריטי SAP/נמ"ר — חובה לייצר תסריטים מפורטים ומקיפים: ***
• כמות: ייצר 25-50 תסריטים (לא פחות מ-25). כסה כל מסך, כל שדה, כל כפתור וכל זרימה שמופיעים באפיון. אל תדלג על שום סעיף.
• עומק: כל תסריט חייב לכלול לפחות 6-10 צעדים מפורטים, ספציפיים, וניתנים לביצוע במערכת נמ"ר/SAP. אל תכתוב צעדים גנריים כמו "היכנס למערכת" בלי לפרט את שם הטרנזקציה, המסך, או השדה.
• כיסוי חובה לכל תהליך באפיון: (1) זרימה חיובית מלאה end-to-end, (2) ולידציות של כל שדה חובה בנפרד (שדה ריק, ערך לא תקין, אורך חריג, פורמט שגוי), (3) הרשאות (משתמש ללא הרשאה, משתמש עם הרשאה חלקית), (4) מקרי קצה (כפילויות, רשומה קיימת, רשומה נעולה ע"י משתמש אחר), (5) ביטול/חזרה אחורה, (6) שמירה חלקית והמשך, (7) אינטגרציות יוצאות (BAPI ל-FHIR, ממשקים נוספים) — וידוא שההמרה רצה והנתון נשלח, (8) הודעות שגיאה ספציפיות שמופיעות באפיון.
• area יוגדר לפי המודול או האזור הפונקציונלי באפיון (למשל "אדמיניסטרציה", "התחשבנות", "ממשקים", "קליטת מטופל", "שחרור").
• title יתחיל במספר רץ תלת-ספרתי: "### | <תיאור קצר וממוקד>" (לדוגמה: "001 | קליטת מטופל חדש — זרימה חיובית מלאה").
• steps: כל צעד יציין במפורש את שם הטרנזקציה ב-SAP (למשל ZNMR_PAT01), שם המסך/הטאב, שם השדה המדויק, הערך שמוקלד, הכפתור שנלחץ, וההודעה הצפויה. לדוגמה: "1. הקלד בשורת הפקודה את הטרנזקציה ZNMR_PAT01 ולחץ Enter. 2. במסך 'קליטת מטופל' בשדה 'ת.ז.' הזן 123456789. 3. לחץ על כפתור 'בדיקה'. 4. וודא שמופיעה הודעה 'מטופל חדש — לא קיים במערכת'."
• expected_result יתאר במפורט: (א) ההודעה המדויקת שמופיעה בסטטוס בר של SAP, (ב) הטבלאות/השדות שמתעדכנים (שם טבלה SAP אם ידוע), (ג) הרשומה שנוצרת/מתעדכנת ומזהה ייחודי, (ד) אם רלוונטי — שההמרה ל-FHIR (BAPI) רצה והמשאב המתאים נוצר במערכת היעד. אל תייצר URLs של FHIR או קריאות POSTMAN בשדה זה — תאר במונחי SAP בלבד.
• prerequisites: ציין נתוני בסיס נדרשים (משתמש, הרשאות, מטופל קיים, מקרה פתוח, נתוני אב).
• אסור להחזיר תסריטים קצרים או שטחיים. תסריט עם פחות מ-6 צעדים ייחשב לא תקין.`;


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
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scenario_id: { type: "string", description: "מזהה התסריט שיש לעדכן" },
          reason: { type: "string", description: "הסבר קצר למה התסריט דורש עדכון לפי האפיון החדש" },
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
      .parse(d),
  )
  .handler(async ({ data }) => {
    const summary = data.existingScenarios
      .map(
        (s) =>
          `--- מזהה: ${s.id}\nכותרת: ${s.title}\nאזור: ${s.area ?? ""}\nעדיפות: ${s.priority}\nסוג: ${s.type}\nתנאים מקדימים: ${s.preconditions ?? ""}\nצעדים:\n${s.steps.map((st, i) => `${i + 1}. ${st}`).join("\n")}\nתוצאה צפויה: ${s.expected_result ?? ""}`,
      )
      .join("\n\n");

    const result = await callAI(
      [
        {
          role: "system",
          content:
            "אתה מומחה QA לתחזוקת תסריטי בדיקה. בהינתן אפיון חדש ורשימת תסריטים קיימים, זהה אילו תסריטים דורשים עדכון בעקבות האפיון החדש, וגם הצע תסריטים חדשים אם נדרש. החזר רק תסריטים שבאמת השתנו או נדרשים. הסבר בעברית מה השתנה.",
        },
        {
          role: "user",
          content: `אפיון חדש (${data.specName}):\n${data.specContent.slice(0, 30000)}\n\nתסריטים קיימים:\n${summary.slice(0, 30000)}`,
        },
      ],
      changesSchema,
    );
    return result as {
      changes: Array<{ scenario_id: string; reason: string; updated: any }>;
      new_scenarios: Array<any>;
    };
  });
