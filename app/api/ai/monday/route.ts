import { createMCPClient } from "@ai-sdk/mcp";
import { streamText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";

export const runtime = "edge";

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

  const tools = {
    ...(typeof mcpTools === "object" && mcpTools !== null ? mcpTools : {}),
    web_search: openai.tools.webSearch({
      searchContextSize: "medium",
    }),
  };
  console.log("[monday] tools (MCP + web_search):", Object.keys(tools));

  const now = new Date();
  const currentDateTime = now.toISOString();
  const currentDate = now.toISOString().split("T")[0];
  const currentTime = now.toTimeString().split(" ")[0];
  const currentDayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });

  const result = streamText({
    model: openai("gpt-5-mini"),
    messages,
    tools,
    stopWhen: stepCountIs(20),
    system: `You are a Monday.com assistant. Use the Monday MCP tools to answer questions about boards, items, updates, and workflows in the user's Monday.com account. When the user asks about something outside Monday data (e.g. general knowledge, recent events, definitions), use the web_search tool to find up-to-date information, then answer clearly.

Current date and time (UTC): ${currentDateTime}
Current date: ${currentDate} (${currentDayOfWeek})
Current time: ${currentTime} UTC

Always respond in clear, simple language. Where helpful, summarize complex Monday structures (boards, groups, items) in a human-friendly way.

When your answer is tabular (multiple rows and columns of related data — e.g. board items with names, statuses, assignees, dates), format it as a **GitHub-flavored Markdown table**: header row, separator row (\`|---|\`), then one row per record. Do not fake tables with spaces or bullet lists unless the user asked for a non-tabular layout. For a single pair of facts, a short sentence or bullet list is fine.`,
    onStepFinish({ text, toolCalls, toolResults, usage, finishReason }) {
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

