import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MONDAY_URL = "https://api.monday.com/v2";

type MondayAuth = { token: string; scope: string | null; source: "oauth" | "env" };

async function resolveMondayAuth(appUserId: string): Promise<MondayAuth> {
  const { getCurrentMondayUserRowForApp } = await import("./monday-session.server");
  const userRow = await getCurrentMondayUserRowForApp(appUserId);
  if (userRow?.access_token) {
    return { token: userRow.access_token, scope: userRow.scope ?? null, source: "oauth" };
  }
  throw new Error("לא מחובר ל-Monday. יש להתחבר עם חשבון Monday כדי לבצע פעולה זו.");
}

function assertMondayWriteScopes(auth: MondayAuth) {
  if (auth.scope === null) return;
  const scopes = new Set(auth.scope.split(/[\s,]+/).filter(Boolean));
  const missing = ["boards:read", "boards:write"].filter((scope) => !scopes.has(scope));
  if (missing.length > 0) {
    throw new Error(
      `החיבור ל-Monday חסר הרשאות כתיבה ללוחות (${missing.join(", ")}). יש להתנתק מ-Monday, להתחבר מחדש ולאשר הרשאות קריאה וכתיבה ללוחות.`,
    );
  }
}

async function resolveMondayToken(appUserId: string): Promise<string> {
  return (await resolveMondayAuth(appUserId)).token;
}


const PRIORITY_HE: Record<string, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
  critical: "קריטית",
};
const TYPE_HE: Record<string, string> = {
  functional: "פונקציונלי",
  ui: "ממשק",
  negative: "שלילי",
  integration: "אינטגרציה",
  performance: "ביצועים",
  security: "אבטחה",
};

const scenarioInput = z.object({
  title: z.string(),
  area: z.string().nullable().optional(),
  preconditions: z.string().nullable().optional(),
  steps: z.array(z.string()),
  expected_result: z.string().nullable().optional(),
  priority: z.string(),
  type: z.string(),
});

const groupInput = z.object({
  specTitle: z.string().min(1),
  system: z.string().nullable().optional(),
  scenarios: z.array(scenarioInput).min(1),
});

// מיפוי בורדים לפי מערכת: מערכת -> Board ID ייעודי
const BOARD_BY_SYSTEM: Record<string, string> = {
  "מזור": "4429586627",
};

async function mondayFetch(token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(MONDAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2025-04",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    if (res.status === 401) {
      throw new Error("Monday API: Token לא תקף או חסר הרשאות (401). יש לעדכן את MONDAY_API_TOKEN.");
    }
    const msg = json.errors?.[0]?.message || json.error_message || `HTTP ${res.status}`;
    if (String(msg).includes("Unauthorized field or type")) {
      throw new Error(
        "Monday API: חסרה הרשאת כתיבה ללוח. יש לוודא שבאפליקציית Monday שמחוברת לפרויקט מוגדרת הרשאת boards:write, ואז להתנתק ולהתחבר מחדש.",
      );
    }
    throw new Error(`Monday API: ${msg}`);
  }
  return json.data;
}

export const exportScenariosToMonday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        boardId: z.string().regex(/^\d+$/, "Board ID חייב להיות מספרי"),
        groupId: z.string().optional(),
        groups: z.array(groupInput).min(1).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const mondayAuth = await resolveMondayAuth(context.userId);
    assertMondayWriteScopes(mondayAuth);
    const apiToken = mondayAuth.token;


    let itemsCreated = 0;
    let subitemsCreated = 0;
    let skippedGroups = 0;
    let skippedScenarios = 0;
    const skipped: string[] = [];
    const totalScenarios = data.groups.reduce((n, g) => n + g.scenarios.length, 0);
    const errors: string[] = [];

    const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

    // Get current Monday user (the token owner) for "בודק" people column
    let currentUserId: number | null = null;
    try {
      const me_res = await mondayFetch(apiToken, `query { me { id } }`, {});
      const idStr = me_res?.me?.id;
      if (idStr) currentUserId = Number(idStr);
    } catch {
      // non-fatal
    }

    const PRIORITY_LABEL: Record<string, string> = {
      low: "Low",
      medium: "Medium",
      high: "High",
      critical: "Critical",
    };

    const todayISO = new Date().toISOString().slice(0, 10);

    // מטמון לכל בורד: רשימת פריטים קיימים + עמודת סטטוס של פריט-אב
    type BoardState = {
      existingItems: Map<string, string>;
      parentStatusColumnId: string | null;
      parentStatusWorkingLabel: string | null;
    };
    const boardStateCache = new Map<string, BoardState>();

    async function getBoardState(boardId: string): Promise<BoardState> {
      const cached = boardStateCache.get(boardId);
      if (cached) return cached;

      const existingItems = new Map<string, string>();
      try {
        let cursor: string | null = null;
        for (let page = 0; page < 20; page++) {
          const q: string = cursor
            ? `query ($cursor: String!) { next_items_page(cursor: $cursor, limit: 500) { cursor items { id name } } }`
            : `query ($boardId: [ID!]) { boards(ids: $boardId) { items_page(limit: 500) { cursor items { id name } } } }`;
          const vars: Record<string, unknown> = cursor ? { cursor } : { boardId: [boardId] };
          const r = await mondayFetch(apiToken, q, vars);
          const pageData: { cursor: string | null; items: Array<{ id: string; name: string }> } | undefined =
            cursor ? r?.next_items_page : r?.boards?.[0]?.items_page;
          const items: Array<{ id: string; name: string }> = pageData?.items ?? [];
          for (const it of items) {
            if (it?.name) existingItems.set(norm(it.name), it.id);
          }
          cursor = pageData?.cursor ?? null;
          if (!cursor) break;
        }
      } catch {
        // non-fatal
      }

      let parentStatusColumnId: string | null = null;
      let parentStatusWorkingLabel: string | null = null;
      try {
        const board_res = await mondayFetch(
          apiToken,
          `query ($boardId: [ID!]) { boards(ids: $boardId) { columns { id title type settings_str } } }`,
          { boardId: [boardId] },
        );
        const cols: Array<{ id: string; title: string; type: string; settings_str?: string }> =
          board_res?.boards?.[0]?.columns ?? [];
        const statusTitles = ["Status", "סטטוס", "סטטוס בדיקה"];
        const statusCol =
          cols.find((c) => statusTitles.includes(c.title?.trim()) && c.type === "status") ??
          cols.find((c) => statusTitles.includes(c.title?.trim()));
        if (statusCol) {
          parentStatusColumnId = statusCol.id;
          try {
            const parsed = JSON.parse(statusCol.settings_str ?? "{}");
            const labels: Record<string, string> = parsed?.labels ?? {};
            const allLabels = Object.values(labels).filter(Boolean) as string[];
            parentStatusWorkingLabel =
              allLabels.find((l) => l.includes("בעבודה")) ??
              allLabels.find((l) => l.toLowerCase().includes("working")) ??
              "Working on it";
          } catch {
            parentStatusWorkingLabel = "Working on it";
          }
        }
      } catch {
        // non-fatal
      }

      const state: BoardState = { existingItems, parentStatusColumnId, parentStatusWorkingLabel };
      boardStateCache.set(boardId, state);
      return state;
    }

    for (const group of data.groups) {
      // ניתוב בורד לפי מערכת (לדוגמה: מזור -> בורד ייעודי)
      const effectiveBoardId =
        (group.system && BOARD_BY_SYSTEM[group.system.trim()]) || data.boardId;

      const boardState = await getBoardState(effectiveBoardId);
      const { existingItems, parentStatusColumnId, parentStatusWorkingLabel } = boardState;

      let itemId: string | null = existingItems.get(norm(group.specTitle)) ?? null;
      const existingGoals = new Set<string>();
      let reusedExistingItem = false;

      if (itemId) {
        reusedExistingItem = true;
        try {
          const sub_res = await mondayFetch(
            apiToken,
            `query ($ids: [ID!]) {
               items(ids: $ids) {
                 subitems { id name column_values { id text } }
               }
             }`,
            { ids: [itemId] },
          );
          const subitems: Array<{ name: string; column_values: Array<{ id: string; text: string }> }> =
            sub_res?.items?.[0]?.subitems ?? [];
          for (const si of subitems) {
            for (const cv of si.column_values ?? []) {
              const t = norm(cv?.text ?? "");
              if (t) existingGoals.add(t);
            }
            const n = norm(si?.name ?? "");
            if (n) existingGoals.add(n);
          }
        } catch {
          // non-fatal
        }
      } else {
        try {
          const created_res = await mondayFetch(
            apiToken,
            `mutation ($boardId: ID!, $groupId: String, $name: String!) {
               create_item(board_id: $boardId, group_id: $groupId, item_name: $name) { id }
             }`,
            {
              boardId: effectiveBoardId,
              groupId: effectiveBoardId === data.boardId ? (data.groupId || null) : null,
              name: group.specTitle.slice(0, 255),
            },
          );
          itemId = created_res?.create_item?.id ?? null;
          if (!itemId) throw new Error("יצירת פריט נכשלה");
          itemsCreated++;
          existingItems.set(norm(group.specTitle), itemId);

          if (parentStatusColumnId && parentStatusWorkingLabel) {
            try {
              await mondayFetch(
                apiToken,
                `mutation ($boardId: ID!, $itemId: ID!, $vals: JSON!) {
                   change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $vals) { id }
                 }`,
                {
                  boardId: effectiveBoardId,
                  itemId,
                  vals: JSON.stringify({
                    [parentStatusColumnId]: { label: parentStatusWorkingLabel },
                  }),
                },
              );
            } catch {
              // non-fatal
            }
          }
        } catch (e: any) {
          errors.push(`אפיון "${group.specTitle}": ${e?.message ?? "שגיאה"}`);
          continue;
        }
      }

      // Column ids resolved per subitem board (cached after first subitem)
      let stepsColumnId: string | null = null;
      let expectedColumnId: string | null = null;
      let priorityColumnId: string | null = null;
      let testerColumnId: string | null = null;
      let dateColumnId: string | null = null;
      let goalColumnId: string | null = null;
      let transactionColumnId: string | null = null;

      let typeColumnId: string | null = null;
      let statusColumnId: string | null = null;
      let statusWorkingLabel: string | null = null;
      let subColumnsCache: Array<{ id: string; title: string; type: string; settings_str?: string }> = [];
      let priorityLabelMap: Record<string, string> = {};
      let typeLabelMap: Record<string, string> = {};

      let scenarioIndex = reusedExistingItem ? existingGoals.size : 0;
      for (const s of group.scenarios) {
        const titleKey = norm(s.title);
        if (titleKey && existingGoals.has(titleKey)) {
          skippedScenarios++;
          skipped.push(`${group.specTitle} › ${s.title}`);
          continue;
        }
        scenarioIndex++;
        // שם ה-subitem = מטרת התסריט (כמו במבנה הקיים בבורד מזור).
        // נופלים חזרה ל"בדיקה N" רק אם אין כותרת.
        const rawTitle = (s.title ?? "").trim();
        const subitemName = (rawTitle || `בדיקה ${scenarioIndex}`).slice(0, 255);
        try {
          const sub_res = await mondayFetch(
            apiToken,
            `mutation ($parentId: ID!, $name: String!) {
               create_subitem(parent_item_id: $parentId, item_name: $name) {
                 id
                 board { id columns { id title type settings_str } }
               }
             }`,
            { parentId: itemId, name: subitemName },
          );

          const subId = sub_res?.create_subitem?.id;
          const subBoardId = sub_res?.create_subitem?.board?.id;
          const subColumns: Array<{ id: string; title: string; type: string; settings_str?: string }> =
            sub_res?.create_subitem?.board?.columns ?? [];
          if (!subId) throw new Error("יצירת subitem נכשלה");
          subitemsCreated++;
          if (titleKey) existingGoals.add(titleKey);

          if (subColumnsCache.length === 0) {
            subColumnsCache = subColumns;
            // התאמה גמישה: מקבל רשימת כותרות אפשריות
            const findCol = (titles: string[], types?: string[]) => {
              for (const title of titles) {
                const t = title.trim();
                const byTypeAndTitle = subColumns.find(
                  (c) => c.title?.trim() === t && (!types || types.includes(c.type)),
                );
                if (byTypeAndTitle) return byTypeAndTitle.id;
              }
              for (const title of titles) {
                const t = title.trim();
                const anyMatch = subColumns.find((c) => c.title?.trim() === t);
                if (anyMatch) return anyMatch.id;
              }
              return null;
            };

            stepsColumnId = findCol(["שלבי בדיקה", "שלבים"], ["long_text", "text"]);
            expectedColumnId = findCol(["תגובה צפויה", "תוצאה צפויה"], ["long_text", "text"]);
            goalColumnId = findCol(["מטרת התסריט", "תרחיש", "תרחישים", "מטרה"], ["long_text", "text"]);
            transactionColumnId = findCol(["טרנזקציה", "טרנזקציות", "Transaction"], ["text", "long_text"]);

            priorityColumnId = findCol(["Priority", "חומרה", "עדיפות"], ["status"]);
            typeColumnId = findCol(["סוג בדיקה", "סוג", "Type"], ["status"]);
            testerColumnId = findCol(["בודק", "מבצע הבדיקה", "מבצע"], ["people"]);
            dateColumnId = findCol(["Date", "תאריך ביצוע", "תאריך"], ["date"]);
            statusColumnId = findCol(["Status", "סטטוס בדיקה", "סטטוס"], ["status"]);

            // Resolve actual priority labels
            if (priorityColumnId) {
              const priorityCol = subColumns.find((c) => c.id === priorityColumnId);
              const settings = priorityCol?.settings_str;
              if (settings) {
                try {
                  const parsed = JSON.parse(settings);
                  const labels: Record<string, string> = parsed?.labels ?? {};
                  const allLabels = Object.values(labels).filter(Boolean) as string[];
                  const match = (needles: string[]) =>
                    allLabels.find((l) =>
                      needles.some((n) => l.toLowerCase().includes(n.toLowerCase())),
                    ) ?? null;
                  priorityLabelMap = {
                    low: match(["low", "נמוכה"]) ?? "Low",
                    medium: match(["medium", "בינונית"]) ?? "Medium",
                    high: match(["high", "גבוהה"]) ?? "High",
                    critical: match(["critical", "urgent", "קריטית"]) ?? "Critical",
                  };
                } catch {
                  // fall back
                }
              }
            }

            // Resolve test-type labels
            if (typeColumnId) {
              const typeCol = subColumns.find((c) => c.id === typeColumnId);
              const settings = typeCol?.settings_str;
              if (settings) {
                try {
                  const parsed = JSON.parse(settings);
                  const labels: Record<string, string> = parsed?.labels ?? {};
                  const allLabels = Object.values(labels).filter(Boolean) as string[];
                  const match = (needles: string[]) =>
                    allLabels.find((l) =>
                      needles.some((n) => l.toLowerCase().includes(n.toLowerCase())),
                    ) ?? null;
                  typeLabelMap = {
                    functional: match(["פונקציונלי", "functional"]) ?? "פונקציונלי",
                    ui: match(["ממשק", "ui"]) ?? "ממשק",
                    negative: match(["שלילי", "negative"]) ?? "שלילי",
                    integration: match(["אינטגרציה", "integration"]) ?? "אינטגרציה",
                    performance: match(["ביצועים", "performance"]) ?? "ביצועים",
                    security: match(["אבטחה", "security"]) ?? "אבטחה",
                  };
                } catch {
                  // fall back
                }
              }
            }

            // Resolve "Working on it" / "בעבודה"
            if (statusColumnId) {
              const statusCol = subColumns.find((c) => c.id === statusColumnId);
              const settings = statusCol?.settings_str;
              if (settings) {
                try {
                  const parsed = JSON.parse(settings);
                  const labels: Record<string, string> = parsed?.labels ?? {};
                  const allLabels = Object.values(labels).filter(Boolean) as string[];
                  statusWorkingLabel =
                    allLabels.find((l) => l.includes("בעבודה")) ??
                    allLabels.find((l) => l.toLowerCase().includes("working")) ??
                    "Working on it";
                } catch {
                  statusWorkingLabel = "Working on it";
                }
              } else {
                statusWorkingLabel = "Working on it";
              }
            }
          }

          const steps = (s.steps ?? []).map((st) => String(st ?? "").trim()).filter(Boolean);
          const stepsText =
            steps.length > 0
              ? steps.map((st, i) => `${i + 1}. ${st}`).join("\n")
              : (s.preconditions?.trim() || "—");

          const goalText =
            (s.title?.trim() || s.area?.trim() || subitemName).slice(0, 1900);
          const expectedText =
            (s.expected_result?.trim() || "המערכת פועלת בהתאם לדרישות האפיון").slice(0, 1900);

          const columnValues: Record<string, unknown> = {};

          if (goalColumnId) {
            const colType = subColumnsCache.find((c) => c.id === goalColumnId)?.type;
            columnValues[goalColumnId] =
              colType === "long_text" ? { text: goalText } : goalText;
          }

          if (stepsColumnId) {
            const colType = subColumnsCache.find((c) => c.id === stepsColumnId)?.type;
            columnValues[stepsColumnId] =
              colType === "long_text" ? { text: stepsText } : stepsText;
          }

          if (expectedColumnId) {
            const colType = subColumnsCache.find((c) => c.id === expectedColumnId)?.type;
            columnValues[expectedColumnId] =
              colType === "long_text" ? { text: expectedText } : expectedText;
          }

          // זיהוי טרנזקציה (SAP / מזור) מתוך טקסט התסריט. דוגמאות: MIGO, GFQ201, ZMZ_MM_PO_DATA_NEW, MB52.
          if (transactionColumnId) {
            const haystack = [
              s.title,
              s.area,
              s.preconditions,
              s.expected_result,
              ...(s.steps ?? []),
            ]
              .filter(Boolean)
              .join(" \n ");
            // Match Latin uppercase codes 3-30 chars, may contain digits/underscore, must have at least one letter
            const matches = haystack.match(/\b[A-Z][A-Z0-9_]{2,29}\b/g) ?? [];
            const STOP = new Set([
              "SAP","HTTP","HTTPS","URL","API","UI","QA","OK","ID","PDF","CSV","XML","JSON","SQL","ERP","CRM","UAT","DEV","PRD","PROD","TEST","GUI",
            ]);
            const seen = new Set<string>();
            const transactions: string[] = [];
            for (const m of matches) {
              if (STOP.has(m)) continue;
              if (seen.has(m)) continue;
              seen.add(m);
              transactions.push(m);
              if (transactions.length >= 5) break;
            }
            if (transactions.length > 0) {
              const colType = subColumnsCache.find((c) => c.id === transactionColumnId)?.type;
              const value = transactions.join(", ");
              columnValues[transactionColumnId] =
                colType === "long_text" ? { text: value } : value;
            }
          }





          if (priorityColumnId) {
            const label =
              priorityLabelMap[s.priority] ?? PRIORITY_LABEL[s.priority] ?? "Medium";
            columnValues[priorityColumnId] = { label };
          }

          if (typeColumnId) {
            const label = typeLabelMap[s.type] ?? TYPE_HE[s.type] ?? s.type;
            if (label) columnValues[typeColumnId] = { label };
          }

          if (testerColumnId && currentUserId) {
            columnValues[testerColumnId] = {
              personsAndTeams: [{ id: currentUserId, kind: "person" }],
            };
          }

          if (dateColumnId) {
            columnValues[dateColumnId] = { date: todayISO };
          }

          if (statusColumnId && statusWorkingLabel) {
            columnValues[statusColumnId] = { label: statusWorkingLabel };
          }

          if (subBoardId && Object.keys(columnValues).length > 0) {
            try {
              await mondayFetch(
                apiToken,
                `mutation ($boardId: ID!, $itemId: ID!, $vals: JSON!) {
                   change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $vals) { id }
                 }`,
                {
                  boardId: subBoardId,
                  itemId: subId,
                  vals: JSON.stringify(columnValues),
                },
              );
            } catch (colErr: any) {
              errors.push(`${group.specTitle} › ${s.title} - עדכון עמודות: ${colErr?.message ?? "שגיאה"}`);
            }
          }

          // לא כותבים לחלונית ה-Updates של ה-subitem (לבקשת המשתמש).

        } catch (e: any) {
          errors.push(`${group.specTitle} › ${s.title}: ${e?.message ?? "שגיאה"}`);
        }
      }
    }


    return {
      itemsCreated,
      subitemsCreated,
      totalGroups: data.groups.length,
      totalScenarios,
      skippedGroups,
      skippedScenarios,
      skipped,
      errors,
    };
  });

// ============================================================
// Import specs FROM Monday: scan a board, find items in a given status,
// return file attachments (name + signed url) for client-side parsing.
// ============================================================

const importInput = z.object({
  boardId: z.string().regex(/^\d+$/, "Board ID חייב להיות מספרי"),
  statusLabel: z.string().min(1).max(200),
});

export const listMondayFileSpecs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => importInput.parse(d))
  .handler(async ({ data, context }) => {
    const token: string = await resolveMondayToken(context.userId);


    // 1) Find the status column on this board
    const board_res = await mondayFetch(
      token,
      `query ($boardId: [ID!]) { boards(ids: $boardId) { columns { id title type settings_str } } }`,
      { boardId: [data.boardId] },
    );
    const cols: Array<{ id: string; title: string; type: string; settings_str?: string }> =
      board_res?.boards?.[0]?.columns ?? [];
    const statusCols = cols.filter((c) => c.type === "status");
    if (statusCols.length === 0) throw new Error("לא נמצאה עמודת סטטוס בבורד");

    const wanted = data.statusLabel.trim().toLowerCase();
    let chosenColId: string | null = null;
    let chosenIndex: number | null = null;
    for (const c of statusCols) {
      try {
        const parsed = JSON.parse(c.settings_str ?? "{}");
        const labels: Record<string, string> = parsed?.labels ?? {};
        for (const [idx, label] of Object.entries(labels)) {
          if (String(label).trim().toLowerCase() === wanted) {
            chosenColId = c.id;
            chosenIndex = Number(idx);
            break;
          }
        }
        if (chosenColId) break;
      } catch {
        // ignore
      }
    }
    if (!chosenColId || chosenIndex === null) {
      const all = statusCols
        .flatMap((c) => {
          try {
            const p = JSON.parse(c.settings_str ?? "{}");
            return Object.values(p?.labels ?? {}) as string[];
          } catch {
            return [];
          }
        })
        .filter(Boolean);
      throw new Error(
        `סטטוס "${data.statusLabel}" לא נמצא. סטטוסים זמינים: ${all.join(", ") || "—"}`,
      );
    }

    // 2) Page through items, filter by status, collect file assets
    type Asset = {
      id: string;
      name: string;
      url: string;
      public_url: string;
      file_extension: string;
    };
    type Match = { itemId: string; itemName: string; assets: Asset[] };
    const matches: Match[] = [];

    let cursor: string | null = null;
    for (let page = 0; page < 30; page++) {
      const q: string = cursor
        ? `query ($cursor: String!) {
             next_items_page(cursor: $cursor, limit: 200) {
               cursor
               items {
                 id name
                 column_values { id text value type }
                 assets { id name url public_url file_extension }
               }
             }
           }`
        : `query ($boardId: [ID!]) {
             boards(ids: $boardId) {
               items_page(limit: 200) {
                 cursor
                 items {
                   id name
                   column_values { id text value type }
                   assets { id name url public_url file_extension }
                 }
               }
             }
           }`;
      const vars: Record<string, unknown> = cursor ? { cursor } : { boardId: [data.boardId] };
      const r = await mondayFetch(token, q, vars);
      const pageData: any = cursor ? r?.next_items_page : r?.boards?.[0]?.items_page;
      const items: Array<{
        id: string;
        name: string;
        column_values: Array<{ id: string; text: string; value: string; type: string }>;
        assets: Asset[] | null;
      }> = pageData?.items ?? [];

      for (const it of items) {
        const cv = it.column_values?.find((c) => c.id === chosenColId);
        if (!cv) continue;
        let matchesStatus = false;
        // Compare by index from value JSON, fall back to text
        try {
          if (cv.value) {
            const parsed = JSON.parse(cv.value);
            if (typeof parsed?.index === "number" && parsed.index === chosenIndex) {
              matchesStatus = true;
            }
          }
        } catch {
          // ignore
        }
        if (!matchesStatus && cv.text?.trim().toLowerCase() === wanted) {
          matchesStatus = true;
        }
        if (!matchesStatus) continue;

        const assets = (it.assets ?? []).filter((a) => !!a?.public_url);
        if (assets.length === 0) continue;
        matches.push({ itemId: it.id, itemName: it.name, assets });
      }

      cursor = pageData?.cursor ?? null;
      if (!cursor) break;
    }

    return { matches, totalItems: matches.length };
  });

// Server-side proxy: download a Monday asset by id (avoids browser CORS on signed URLs)
export const downloadMondayAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ assetId: z.string().regex(/^\d+$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const token: string = await resolveMondayToken(context.userId);

    const r = await mondayFetch(
      token,
      `query ($ids: [ID!]!) { assets(ids: $ids) { id name public_url file_extension } }`,
      { ids: [data.assetId] },
    );
    const asset = r?.assets?.[0];
    if (!asset?.public_url) throw new Error("הקובץ לא נמצא ב-Monday");

    const fileRes = await fetch(asset.public_url);
    if (!fileRes.ok) throw new Error(`הורדת קובץ נכשלה (${fileRes.status})`);
    const buf = await fileRes.arrayBuffer();
    // Encode as base64 for transit (server fn return)
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const base64 = btoa(binary);
    return {
      name: asset.name as string,
      extension: (asset.file_extension as string) || "",
      base64,
      mimeType: fileRes.headers.get("content-type") || "application/octet-stream",
    };
  });
