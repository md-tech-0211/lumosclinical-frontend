import { createMCPClient } from "@ai-sdk/mcp";
import { streamText, stepCountIs } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import type { ToolSet } from "ai";

export const runtime = "nodejs";

function jsonError(
  status: number,
  error: string,
  details?: string
): Response {
  return Response.json(
    { error, ...(details ? { details } : {}) },
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/** Avoid sending HTML error pages or huge blobs to the client. */
function sanitizeErrorForClient(raw: string): string {
  const t = raw.trim();
  if (/<!DOCTYPE/i.test(t) || /<html[\s>]/i.test(t)) {
    return "The Monday MCP URL returned a web page (often 404). Wrong address or the MCP server is not running. Check MONDAY_MCP_URL and that your MCP backend exposes the expected HTTP endpoint.";
  }
  if (t.length > 400) {
    return `${t.slice(0, 400)}…`;
  }
  return t;
}

function buildSystemPrompt(
  mcpAvailable: boolean,
  currentDateTime: string,
  currentDate: string,
  currentDayOfWeek: string,
  currentTime: string
): string {
  const context = `Current date and time (UTC): ${currentDateTime}
Current date: ${currentDate} (${currentDayOfWeek})
Current time: ${currentTime} UTC`;

  if (mcpAvailable) {
    return `You are a Monday.com assistant. Use the Monday MCP tools to answer questions about boards, items, updates, and workflows in the user's Monday.com account. If the user asks about something outside Monday data (e.g. general knowledge, recent events, definitions), say you don't have browsing enabled and answer using general knowledge (or ask the user to provide specifics).

${context}

Always respond in clear, simple language. Where helpful, summarize complex Monday structures (boards, groups, items) in a human-friendly way.

When your answer is tabular (multiple rows and columns of related data — e.g. board items with names, statuses, assignees, dates), format it as a **GitHub-flavored Markdown table**: header row, separator row (\`|---|\`), then one row per record. Do not fake tables with spaces or bullet lists unless the user asked for a non-tabular layout. For a single pair of facts, a short sentence or bullet list is fine.`;
  }

  return `The Monday.com MCP backend is **not reachable** right now (connection failed, wrong URL, or server down). You **do not** have Monday tools — you cannot query live boards, items, or updates.

**Start your reply with one short line** like: "The Monday integration is temporarily unavailable, so I can’t see your live boards or items."

Then:
- Do **not** invent or guess specific board/item data.
- Offer general help about Monday.com concepts, or suggest the user check that the MCP server is running and \`MONDAY_MCP_URL\` points to the correct MCP HTTP endpoint (not the Next.js app page).
- If the question is about something else, answer helpfully.

${context}

Always respond in clear, simple language.`;
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Invalid JSON body.");
    }

    const messages = (body as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) {
      return jsonError(400, "Request must include a messages array.");
    }

    const mcpUrl = process.env.MONDAY_MCP_URL?.trim();
    if (!mcpUrl) {
      return jsonError(
        500,
        "Monday MCP is not configured.",
        "Set MONDAY_MCP_URL in your environment (e.g. http://localhost:3000/api/mcp)."
      );
    }

    const keyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secret = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const region = process.env.AWS_REGION?.trim();
    if (!keyId || !secret) {
      return jsonError(
        500,
        "AWS credentials are missing.",
        "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for Bedrock."
      );
    }
    if (!region) {
      return jsonError(
        500,
        "AWS region is missing.",
        "Set AWS_REGION (e.g. us-east-1)."
      );
    }

    console.log("[monday] /api/ai/monday request", {
      messageCount: messages.length,
      lastMessage:
        messages.length > 0 ? messages[messages.length - 1] : null,
    });

    console.log("[monday] MCP URL:", mcpUrl);

    let tools: ToolSet = {};
    let mcpAvailable = false;

    try {
      const mcpClient = await createMCPClient({
        transport: {
          type: "http",
          url: mcpUrl,
        },
      });

      console.log("[monday] loading MCP tools...");
      const mcpTools = await mcpClient.tools();
      const toolNames =
        mcpTools && typeof mcpTools === "object"
          ? Object.keys(mcpTools as Record<string, unknown>)
          : [];
      console.log("[monday] MCP tools loaded:", toolNames);

      tools =
        typeof mcpTools === "object" && mcpTools !== null
          ? (mcpTools as ToolSet)
          : {};
      console.log("[monday] tools (MCP):", Object.keys(tools));
      mcpAvailable = true;
    } catch (mcpErr) {
      const msg =
        mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
      console.warn(
        "[monday] MCP unavailable — continuing with AI-only (no tools):",
        sanitizeErrorForClient(msg)
      );
      tools = {};
      mcpAvailable = false;
    }

    const now = new Date();
    const currentDateTime = now.toISOString();
    const currentDate = now.toISOString().split("T")[0];
    const currentTime = now.toTimeString().split(" ")[0];
    const currentDayOfWeek = now.toLocaleDateString("en-US", {
      weekday: "long",
    });

    const modelId =
      process.env.BEDROCK_MODEL_ID ??
      "anthropic.claude-3-haiku-20240307-v1:0";

    const system = buildSystemPrompt(
      mcpAvailable,
      currentDateTime,
      currentDate,
      currentDayOfWeek,
      currentTime
    );

    const result = streamText({
      model: bedrock(modelId),
      messages,
      tools,
      stopWhen: stepCountIs(20),
      system,
      onStepFinish({
        text,
        toolCalls,
        toolResults,
        usage,
        finishReason,
      }: {
        text: string;
        toolCalls: Array<{
          toolCallId: string;
          toolName: string;
          dynamic?: boolean;
        }>;
        toolResults: unknown[];
        usage: unknown;
        finishReason: string;
      }) {
        console.log("[monday] step finished", {
          mcpAvailable,
          finishReason,
          textPreview: text.slice(0, 200),
          toolCallCount: toolCalls.length,
          toolResultCount: toolResults.length,
          toolCalls: toolCalls.map((c) => ({
            id: c.toolCallId,
            name: c.toolName,
            dynamic: c.dynamic,
          })),
          usage,
        });
      },
    });

    console.log("[monday] streamText initialized", { mcpAvailable });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[monday] /api/ai/monday failed:", message, stack);
    const safe = sanitizeErrorForClient(message);
    return jsonError(500, "Monday assistant failed.", safe);
  }
}
