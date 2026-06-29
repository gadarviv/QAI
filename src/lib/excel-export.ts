import * as XLSX from "xlsx";

export interface ScenarioRow {
  title: string;
  area?: string | null;
  preconditions?: string | null;
  steps: string[];
  expected_result?: string | null;
  priority: string;
  type: string;
  status: string;
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

// זיהוי טרנזקציות SAP / מזור מתוך טקסט (כמו ב-monday.functions.ts)
function extractTransactions(parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join("\n");
  const regex = /\b(?:Z[A-Z0-9_]{2,}|[A-Z]{2,5}\d{1,4}[A-Z0-9_]*|MIGO|MB5[12]|ME2[1-9]N?|VA0[12]|FB60|FBL[135]N)\b/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const v = m[0];
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 5) break;
  }
  return out.join(", ");
}

export function exportScenariosToExcel(scenarios: ScenarioRow[], filename = "test-scenarios.xlsx") {
  const rows: Record<string, string | number>[] = [];
  scenarios.forEach((s, i) => {
    const goal = s.title;
    const transactions = extractTransactions([
      s.title,
      s.preconditions,
      s.expected_result,
      ...(s.steps ?? []),
    ]);

    rows.push({
      "#": i + 1,
      כותרת: s.title,
      "מטרת התסריט": goal,
      טרנזקציה: transactions,
      אזור: s.area ?? "",
      סוג: TYPE_HE[s.type] ?? s.type,
      עדיפות: PRIORITY_HE[s.priority] ?? s.priority,
      "תנאים מקדימים": s.preconditions ?? "",
      "צעד #": "",
      "צעד ביצוע": "",
      "תוצאה צפויה": s.expected_result ?? "",
      סטטוס: s.status,
    });
    (s.steps ?? []).forEach((st, idx) => {
      rows.push({
        "#": "",
        כותרת: "",
        "מטרת התסריט": "",
        טרנזקציה: "",
        אזור: "",
        סוג: "",
        עדיפות: "",
        "תנאים מקדימים": "",
        "צעד #": idx + 1,
        "צעד ביצוע": st,
        "תוצאה צפויה": "",
        סטטוס: "",
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 5 },
    { wch: 30 },
    { wch: 35 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 30 },
    { wch: 6 },
    { wch: 50 },
    { wch: 35 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "תסריטי בדיקה");
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.writeFile(wb, filename);
}
