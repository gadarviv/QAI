// Client-side file parsing
import mammoth from "mammoth";
import * as XLSX from "xlsx";

export async function parseFile(file: File): Promise<{ content: string; type: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const raw = await file.text();
    try {
      const json = JSON.parse(raw);
      // Postman Collection detection
      if (json?.info && Array.isArray(json?.item)) {
        return { content: postmanCollectionToText(json), type: "postman" };
      }
      return { content: raw, type: "json" };
    } catch {
      return { content: raw, type: "json" };
    }
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return { content: await file.text(), type: "txt" };
  }

  if (name.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return { content: value, type: "docx" };
  }
  if (name.endsWith(".pdf")) {
    const pdfjs: any = await import("pdfjs-dist");
    // Use bundled worker
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => it.str).join(" ") + "\n\n";
    }
    return { content: text, type: "pdf" };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    let text = "";
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      text += `### גיליון: ${sheetName}\n`;
      for (const row of rows) {
        const line = row.map((c) => String(c ?? "").trim()).filter(Boolean).join(" | ");
        if (line) text += line + "\n";
      }
      text += "\n";
    }
    return { content: text, type: name.endsWith(".csv") ? "csv" : "xlsx" };
  }
  throw new Error("פורמט קובץ לא נתמך - יש להעלות PDF, Word, Excel, JSON (Postman) או טקסט");
}

function postmanCollectionToText(col: any): string {
  const out: string[] = [];
  out.push(`# Postman Collection: ${col.info?.name ?? "ללא שם"}`);
  if (col.info?.description) out.push(String(col.info.description));
  out.push("");

  const walk = (items: any[], prefix = "") => {
    for (const it of items ?? []) {
      if (Array.isArray(it.item)) {
        out.push(`## ${prefix}${it.name ?? "Folder"}`);
        walk(it.item, prefix + (it.name ? it.name + " / " : ""));
        continue;
      }
      const req = it.request ?? {};
      const method = (typeof req.method === "string" ? req.method : "GET").toUpperCase();
      const url =
        typeof req.url === "string"
          ? req.url
          : req.url?.raw ?? (Array.isArray(req.url?.path) ? "/" + req.url.path.join("/") : "");
      out.push(`### ${prefix}${it.name ?? "Request"}`);
      out.push(`- Method: ${method}`);
      out.push(`- URL: ${url}`);
      const headers = Array.isArray(req.header)
        ? req.header
            .filter((h: any) => !h?.disabled)
            .map((h: any) => `${h.key}: ${h.value}`)
            .join(" | ")
        : "";
      if (headers) out.push(`- Headers: ${headers}`);
      const auth = req.auth?.type;
      if (auth) out.push(`- Auth: ${auth}`);
      const bodyMode = req.body?.mode;
      if (bodyMode === "raw" && req.body?.raw) {
        out.push(`- Body (${req.body?.options?.raw?.language ?? "raw"}):`);
        out.push(String(req.body.raw).slice(0, 2000));
      } else if (bodyMode === "formdata" && Array.isArray(req.body?.formdata)) {
        out.push(
          `- Body (form-data): ${req.body.formdata.map((f: any) => `${f.key}=${f.value ?? ""}`).join(", ")}`,
        );
      } else if (bodyMode === "urlencoded" && Array.isArray(req.body?.urlencoded)) {
        out.push(
          `- Body (urlencoded): ${req.body.urlencoded.map((f: any) => `${f.key}=${f.value ?? ""}`).join(", ")}`,
        );
      }
      if (Array.isArray(it.response) && it.response.length) {
        const examples = it.response
          .slice(0, 3)
          .map(
            (r: any) =>
              `  • ${r.name ?? "example"} → status ${r.code ?? r.status ?? "?"}${r.body ? `, body: ${String(r.body).slice(0, 400)}` : ""}`,
          )
          .join("\n");
        out.push(`- Example responses:\n${examples}`);
      }
      if (it.event) {
        const tests = it.event.find((e: any) => e.listen === "test");
        const script = tests?.script?.exec;
        if (Array.isArray(script) && script.length) {
          out.push(`- Tests script:\n${script.join("\n").slice(0, 800)}`);
        }
      }
      out.push("");
    }
  };
  walk(col.item ?? []);
  return out.join("\n");
}

