// Client-side FHIR request runner.
// The FHIR API (iris-qa.fhir.dev.idgmc.org) lives on the internal Ministry of Health
// network and is not reachable from our Cloudflare Workers backend. Running fetch
// from the user's browser uses the computer's own network — which on a MoH machine
// CAN reach the internal API directly. CORS may still block the response from being
// read; in that case we surface a clear error.

type RunInput = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  basicAuth?: { username: string; password: string };
};

export type FhirRunResult = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: any;
};

export async function runFhirRequestClient(
  args: { data: RunInput },
): Promise<FhirRunResult> {
  const { data } = args;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), data.timeoutMs ?? 20000);

  try {
    const headers: Record<string, string> = {
      Accept: "application/fhir+json, application/json;q=0.9, */*;q=0.1",
      ...(data.headers ?? {}),
    };
    const hasBody = !!data.body && !["GET", "HEAD"].includes(data.method);
    if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/fhir+json";
    }
    const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
    if (!hasAuth && data.basicAuth) {
      const token = btoa(`${data.basicAuth.username}:${data.basicAuth.password}`);
      headers["Authorization"] = `Basic ${token}`;
    }

    const res = await fetch(data.url, {
      method: data.method,
      headers,
      body: hasBody ? data.body : undefined,
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
    });

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      durationMs: Date.now() - started,
      headers: responseHeaders,
      bodyText: text.slice(0, 100_000),
      bodyJson: parsed,
    };
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    const msg = aborted
      ? "Timeout"
      : e?.message?.includes("Failed to fetch") || e?.message?.includes("NetworkError")
        ? "שגיאת רשת — ייתכן שאינך מחובר לרשת משרד הבריאות, או שהשרת חוסם CORS מהדפדפן"
        : (e?.message ?? String(e));
    return {
      ok: false,
      status: 0,
      statusText: aborted ? "Timeout" : "Network Error",
      durationMs: Date.now() - started,
      headers: {},
      bodyText: msg,
      bodyJson: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
