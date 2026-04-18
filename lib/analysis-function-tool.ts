import { tool } from "ai";
import type { ToolSet } from "ai";
import { ANALYSIS_FORM_BODY_RULES } from "@/lib/analysis-form-payload";
import {
  analysisInvokeInputSchema,
  runAnalysisInvokeHttp,
} from "@/lib/analysis-invoke-http";

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
      description: `**Required** when the user wants analysis/eligibility on a prescreen form. Call **before** any long reply. Use \`method: "POST"\` and put data in \`body\`: **one JSON object** per row (column keys → values), or **several candidates** as \`{"candidates":[{...},{...}]}\` from Monday or paste. ${ANALYSIS_FORM_BODY_RULES} **Never** write a “COMPREHENSIVE FORM ANALYSIS” instead of calling this tool—summarize **only** the JSON returned in \`data\` (short). Base: \`ANALYSIS_FUNCTION_URL\`.`,
      inputSchema: analysisInvokeInputSchema,
      execute: async (args) => {
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
      },
    }),
  };
}
