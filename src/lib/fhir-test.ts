type Scenario = { title: string; steps: string[] | null; expected_result?: string | null; area?: string | null };

export type ParsedFhirRequest = {
  method: string;
  url: string;
  name: string;
  body: string;
  description: string;
  /** True when URL ends with a template prefix like `/Patient/PAT.` and a suffix must be appended at run time. */
  isTemplated: boolean;
  /** The trailing prefix (e.g. "PAT.", "IMG.") shown to the user as context. Only set when isTemplated. */
  templatePrefix?: string;
};

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;
const URL_RE = /(https?:\/\/[^\s"'<>]+)/i;

function findStep(steps: string[] | undefined, prefixes: string[]): string | undefined {
  if (!steps) return undefined;
  for (const s of steps) {
    const lower = s.toLowerCase();
    if (prefixes.some((p) => lower.startsWith(p.toLowerCase()))) return s;
  }
  return undefined;
}

function stripPrefix(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : line.trim();
}

export function parseFhirScenario(
  scenario: Pick<Scenario, "title" | "steps" | "expected_result"> & { steps: string[] | null | undefined },
): ParsedFhirRequest | null {
  const steps = (scenario.steps ?? []) as string[];

  const postmanStep = findStep(steps, ["GET POSTMAN", "POSTMAN"]);
  const jsonStep = findStep(steps, ["JSON"]);
  const descStep = findStep(steps, ["תיאור צעדי בדיקה", "תיאור"]);

  if (!postmanStep) return null;

  const content = stripPrefix(postmanStep);
  const methodMatch = content.match(METHOD_RE);
  const urlMatch = content.match(URL_RE);
  if (!urlMatch) return null;

  const method = (methodMatch?.[1] ?? "GET").toUpperCase();
  let url = urlMatch[1];
  // Always strip trailing commas/semicolons (sentence punctuation)
  url = url.replace(/[,;]+$/, "");
  // Detect template — two shapes:
  //  (א) URL ends with `/<Prefix>.` (e.g. `/Patient/PAT.`) — explicit empty slot.
  //  (ב) URL ends with `/<Prefix>.<example-id>` (e.g. `/ServiceRequest/IMG.02337023.4897`)
  //      — the example id is sample data; strip it so the user supplies their own.
  const TEMPLATE_EMPTY_RE = /\/([A-Za-z][A-Za-z0-9_-]*)\.$/;
  const TEMPLATE_EXAMPLE_RE = /\/([A-Za-z][A-Za-z0-9_-]*)\.[A-Za-z0-9][A-Za-z0-9._\-]*$/;
  let tplMatch = url.match(TEMPLATE_EMPTY_RE);
  if (!tplMatch) {
    const ex = url.match(TEMPLATE_EXAMPLE_RE);
    if (ex) {
      tplMatch = ex;
      url = url.replace(TEMPLATE_EXAMPLE_RE, `/${ex[1]}.`);
    }
  }
  const isTemplated = !!tplMatch;
  const templatePrefix = tplMatch ? `${tplMatch[1]}.` : undefined;
  if (!isTemplated) {
    // Not a template — safe to strip sentence-ending dots
    url = url.replace(/\.+$/, "");
  }

  let body = "";
  if (jsonStep) {
    const raw = stripPrefix(jsonStep);
    if (raw && !/^לא רלוונטי/i.test(raw)) {
      // Try to extract JSON object/array if surrounded by text
      const objMatch = raw.match(/[{\[][\s\S]*[}\]]/);
      body = objMatch ? objMatch[0] : raw;
    }
  }

  return {
    method,
    url,
    name: scenario.title || `FHIR ${method}`,
    body,
    description: descStep ? stripPrefix(descStep) : "",
    isTemplated,
    templatePrefix,
  };
}

export function buildPostmanCollection(
  collectionName: string,
  scenarios: Array<{ title: string; steps: string[] | null; expected_result?: string | null }>,
) {
  const items = scenarios
    .map((s) => {
      const parsed = parseFhirScenario(s as any);
      if (!parsed) return null;
      let urlObj: any;
      try {
        const u = new URL(parsed.url);
        urlObj = {
          raw: parsed.url,
          protocol: u.protocol.replace(":", ""),
          host: u.hostname.split("."),
          port: u.port || undefined,
          path: u.pathname.split("/").filter(Boolean),
          query: Array.from(u.searchParams.entries()).map(([key, value]) => ({ key, value })),
        };
      } catch {
        urlObj = { raw: parsed.url };
      }
      return {
        name: parsed.name,
        request: {
          method: parsed.method,
          header: [
            { key: "Accept", value: "application/fhir+json" },
            ...(parsed.body
              ? [{ key: "Content-Type", value: "application/fhir+json" }]
              : []),
          ],
          url: urlObj,
          body: parsed.body
            ? { mode: "raw", raw: parsed.body, options: { raw: { language: "json" } } }
            : undefined,
          description: parsed.description,
        },
        response: [],
      };
    })
    .filter(Boolean);

  return {
    info: {
      _postman_id: crypto.randomUUID(),
      name: collectionName,
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      description: "Generated from QAI test scenarios",
    },
    item: items,
  };
}

export function isFhirScenario(s: { area?: string | null }, specSystem?: string | null) {
  return s.area === "FHIR" || specSystem === "FHIR";
}
