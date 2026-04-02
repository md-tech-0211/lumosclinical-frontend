import { createMCPClient } from "@ai-sdk/mcp";
import { streamText, stepCountIs } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import type { ToolSet } from "ai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages } = await req.json();

  console.log("[monday] /api/ai/monday request", {
    messageCount: Array.isArray(messages) ? messages.length : 0,
    lastMessage:
      Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1]
        : null,
  });

  const mcpUrl = process.env.MONDAY_MCP_URL;
  console.log("[monday] MCP URL:", mcpUrl);

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl!,
    },
  });

  console.log("[monday] loading MCP tools...");
  const mcpTools = await mcpClient.tools();
  const toolNames =
    mcpTools && typeof mcpTools === "object"
      ? Object.keys(mcpTools as Record<string, unknown>)
      : [];
  console.log("[monday] MCP tools loaded:", toolNames);

  const tools: ToolSet =
    typeof mcpTools === "object" && mcpTools !== null ? (mcpTools as ToolSet) : {};
  console.log("[monday] tools (MCP):", Object.keys(tools));

  const now = new Date();
  const currentDateTime = now.toISOString();
  const currentDate = now.toISOString().split("T")[0];
  const currentTime = now.toTimeString().split(" ")[0];
  const currentDayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });

  const modelId =
    process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0";

  const result = streamText({
    model: bedrock(modelId),
    messages,
    tools,
    stopWhen: stepCountIs(20),
    system: `You are a Monday.com assistant. Use the Monday MCP tools to answer questions about boards, items, updates, and workflows in the user's Monday.com account. If the user asks about something outside Monday data (e.g. general knowledge, recent events, definitions), say you don't have browsing enabled and answer using general knowledge (or ask the user to provide specifics).

Current date and time (UTC): ${currentDateTime}
Current date: ${currentDate} (${currentDayOfWeek})
Current time: ${currentTime} UTC

Always respond in clear, simple language. Where helpful, summarize complex Monday structures (boards, groups, items) in a human-friendly way.

When your answer is tabular (multiple rows and columns of related data — e.g. board items with names, statuses, assignees, dates), format it as a **GitHub-flavored Markdown table**: header row, separator row (\`|---|\`), then one row per record. Do not fake tables with spaces or bullet lists unless the user asked for a non-tabular layout. For a single pair of facts, a short sentence or bullet list is fine.`,
    onStepFinish({
      text,
      toolCalls,
      toolResults,
      usage,
      finishReason,
    }: {
      text: string;
      toolCalls: Array<{ toolCallId: string; toolName: string; dynamic?: boolean }>;
      toolResults: unknown[];
      usage: unknown;
      finishReason: string;
    }) {
      console.log("[monday] step finished", {
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

  console.log("[monday] streamText initialized");
  return result.toUIMessageStreamResponse();
}

