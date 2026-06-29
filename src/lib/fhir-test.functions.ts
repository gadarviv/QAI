import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RunSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().min(1000).max(60000).optional(),
  basicAuth: z
    .object({
      username: z.string().min(1).max(200),
      password: z.string().min(1).max(500),
    })
    .optional(),
});

export const runFhirRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RunSchema.parse(data))
  .handler(async ({ data }) => {
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

      // Per-request Basic Auth — credentials come from the user each run, never stored.
      const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
      if (!hasAuth && data.basicAuth) {
        const token = Buffer.from(
          `${data.basicAuth.username}:${data.basicAuth.password}`,
        ).toString("base64");
        headers["Authorization"] = `Basic ${token}`;
      }

      const res = await fetch(data.url, {
        method: data.method,
        headers,
        body: hasBody ? data.body : undefined,
        signal: controller.signal,
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
      return {
        ok: false,
        status: 0,
        statusText: e?.name === "AbortError" ? "Timeout" : "Network Error",
        durationMs: Date.now() - started,
        headers: {} as Record<string, string>,
        bodyText: e?.message ?? String(e),
        bodyJson: null,
      };
    } finally {
      clearTimeout(timer);
    }
  });
