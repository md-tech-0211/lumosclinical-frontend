import { z } from "zod";
import { normalizeAnalysisInvokeBody } from "@/lib/analysis-form-payload";

/**
 * Shared contract for the `analysis_invoke` tool: proxy to your analysis API / Lambda.
 * Use from:
 * - `buildAnalysisInvokeTool()` in this repo (Luna `/api/ai/monday`)
 * - Your Monday MCP server: register a tool with the same name + schema and call
 *   `runAnalysisInvokeHttp` with env from `ANALYSIS_FUNCTION_URL` (+ optional auth).
 */
export function joinBaseAndPath(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = (path ?? "").trim().replace(/^\/+/, "");
  return p ? `${b}/${p}` : b;
}

export const analysisInvokeInputSchema = z.object({
  method: z.enum(["GET", "POST", "PUT"]).describe("HTTP method."),
  path: z
    .string()
    .optional()
    .describe(
      "Path under the configured base URL (e.g. `runs` or `v1/score`). Leading slash optional."
    ),
  query: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional query string parameters."),
  body: z
    .unknown()
    .optional()
    .describe("Optional JSON body for POST or PUT."),
});

export type AnalysisInvokeInput = z.infer<typeof analysisInvokeInputSchema>;

/** HTTP result uses `Response.ok`. Network / config failures return `{ error }` only. */
export type AnalysisInvokeHttpResult =
  | { ok: boolean; status: number; data: unknown }
  | { error: string };

/**
 * Proxies to `baseUrl` (typically `process.env.ANALYSIS_FUNCTION_URL`). Only `http:` / `https:`
 * origins are allowed; resolved URL must stay on the same origin as `baseUrl`.
 */
export async function runAnalysisInvokeHttp(
  args: AnalysisInvokeInput,
  options: {
    baseUrl: string;
    authHeader?: string;
    timeoutMs?: number;
  }
): Promise<AnalysisInvokeHttpResult> {
  const { method, path, query, body } = args;
  const { baseUrl: base, authHeader, timeoutMs = 120_000 } = options;

  let parsedBase: URL;
  try {
    parsedBase = new URL(base);
  } catch {
    return { error: "Invalid ANALYSIS_FUNCTION_URL." };
  }
  if (!/^https?:$/i.test(parsedBase.protocol)) {
    return { error: "ANALYSIS_FUNCTION_URL must be http or https." };
  }

  const urlStr = joinBaseAndPath(base, path ?? "");
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { error: "Invalid URL after joining base and path." };
  }

  if (url.origin !== parsedBase.origin) {
    return {
      error: "Resolved URL origin does not match ANALYSIS_FUNCTION_URL.",
    };
  }

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (authHeader?.trim()) {
    headers.Authorization = authHeader.trim();
  }

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (method === "POST" || method === "PUT") {
    headers["Content-Type"] = "application/json";
    if (body !== undefined) {
      const normalized = normalizeAnalysisInvokeBody(body);
      init.body = JSON.stringify(normalized);
    }
  }

  try {
    const res = await fetch(url.toString(), init);
    const text = await res.text();
    let data: unknown = text;
    if (text.length > 0) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Analysis request failed: ${msg}` };
  }
}
