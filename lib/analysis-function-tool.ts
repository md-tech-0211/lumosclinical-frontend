import { tool } from "ai";
import type { ToolSet } from "ai";
import { ANALYSIS_FORM_BODY_RULES } from "@/lib/analysis-form-payload";
import {
  analysisInvokeInputSchema,
  runAnalysisInvokeHttp,
} from "@/lib/analysis-invoke-http";

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function extractCandidatesArray(body: unknown): unknown[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const c = (body as Record<string, unknown>).candidates;
  return Array.isArray(c) ? c : undefined;
}

/**
 * Optional Bedrock tool: proxy to a single configured analysis HTTP API (no arbitrary hosts).
 * Merged with MCP tools in /api/ai/monday when ANALYSIS_FUNCTION_URL is set.
 */
export function isAnalysisFunctionConfigured(): boolean {
  return Boolean(process.env.ANALYSIS_FUNCTION_URL?.trim());
}

export function buildAnalysisInvokeTool(): ToolSet {
  const base = process.env.ANALYSIS_FUNCTION_URL?.trim();
  if (!base) {
    return {};
  }

  try {
    const u = new URL(base);
    if (!/^https?:$/i.test(u.protocol)) {
      return {};
    }
  } catch {
    return {};
  }

  return {
    analysis_invoke: tool({
      description: `**Required** when the user wants analysis/eligibility on a prescreen form. Call **before** any long reply. Use \`method: "POST"\` and put data in \`body\`: **one JSON object** per row (column keys → values), or **several candidates** as \`{"candidates":[{...},{...}]}\` from Monday or paste. ${ANALYSIS_FORM_BODY_RULES} **Batching:** If \`body.candidates\` has more than 10 rows, this tool will automatically split into batches of 10 and run multiple requests sequentially, returning a combined result. **Never** write a “COMPREHENSIVE FORM ANALYSIS” instead of calling this tool—summarize **only** the JSON returned in \`data\` (short). Base: \`ANALYSIS_FUNCTION_URL\`.`,
      inputSchema: analysisInvokeInputSchema,
      execute: async (args) => {
        const candidates = extractCandidatesArray(args.body);
        const method = args.method;

        const shouldBatch =
          (method === "POST" || method === "PUT") &&
          candidates != null &&
          candidates.length > 10;

        if (!shouldBatch) {
          const result = await runAnalysisInvokeHttp(args, {
            baseUrl: base,
            authHeader: process.env.ANALYSIS_FUNCTION_AUTH_HEADER?.trim(),
          });
          if ("error" in result) {
            return result;
          }
          return {
            ok: result.ok,
            status: result.status,
            data: result.data,
          };
        }

        const batches = chunk(candidates, 10);
        const batchResults: Array<{
          batchNumber: number;
          batchStartIndex: number;
          batchEndIndex: number;
          ok?: boolean;
          status?: number;
          data?: unknown;
          error?: string;
        }> = [];

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const batchArgs = {
            ...args,
            body: { ...(args.body as Record<string, unknown>), candidates: batch },
          };

          const res = await runAnalysisInvokeHttp(batchArgs, {
            baseUrl: base,
            authHeader: process.env.ANALYSIS_FUNCTION_AUTH_HEADER?.trim(),
          });

          const start = i * 10;
          const end = start + batch.length - 1;

          if ("error" in res) {
            batchResults.push({
              batchNumber: i + 1,
              batchStartIndex: start,
              batchEndIndex: end,
              error: res.error,
            });
            continue;
          }

          batchResults.push({
            batchNumber: i + 1,
            batchStartIndex: start,
            batchEndIndex: end,
            ok: res.ok,
            status: res.status,
            data: res.data,
          });
        }

        const allOk = batchResults.every((r) => r.error == null && r.ok === true);
        return {
          ok: allOk,
          status: allOk ? 200 : 207,
          data: {
            batched: true,
            batchSize: 10,
            totalCandidates: candidates.length,
            batches: batchResults,
          },
        };
      },
    }),
  };
}
