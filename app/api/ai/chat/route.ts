import { createMCPClient } from "@ai-sdk/mcp";
import { streamText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";

export const runtime = "edge";

export async function POST(req: Request) {
  const { messages } = await req.json();

  console.log("[v0] /api/ai/chat request", {
    messageCount: Array.isArray(messages) ? messages.length : 0,
    lastMessage:
      Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1]
        : null,
  });

  const mcpUrl = process.env.ZOHO_MCP_URL;
  console.log("[v0] /api/ai/chat MCP URL:", mcpUrl);

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl!, // e.g. "https://your-vercel-mcp-app.vercel.app/api/mcp"
    },
  });

  console.log("[v0] /api/ai/chat loading MCP tools...");
  const mcpTools = await mcpClient.tools();
  const toolNames =
    mcpTools && typeof mcpTools === "object"
      ? Object.keys(mcpTools as Record<string, unknown>)
      : [];
  console.log("[v0] /api/ai/chat MCP tools loaded:", toolNames);

  // Merge MCP tools with web search so the assistant can search the internet when needed
  const tools = {
    ...(typeof mcpTools === "object" && mcpTools !== null ? mcpTools : {}),
    web_search: openai.tools.webSearch({
      searchContextSize: "medium",
    }),
  };
  console.log("[v0] /api/ai/chat tools (MCP + web_search):", Object.keys(tools));

  // Get current date and time for the session (UTC)
  const now = new Date();
  const currentDateTime = now.toISOString();
  const currentDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const currentDayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

  
  const result = streamText({
    model: openai("gpt-5-mini"),
    messages,
    tools,
    stopWhen: stepCountIs(15),
    system: `You are a CRM assistant. Use the Zoho CRM MCP tools to answer questions about leads, deals, contacts, and meetings. When the user asks about something outside CRM data (e.g. general knowledge, recent events, definitions), use the web_search tool to find up-to-date information, then answer clearly.

Current date and time (UTC): ${currentDateTime}
Current date: ${currentDate} (${currentDayOfWeek})
Current time: ${currentTime} UTC

Use this information to provide time-aware responses. When users ask about "today", "this week", "recent", etc., use the current date/time provided above.

Important: After you have the data you need from tool calls, you MUST reply to the user in plain language. Never end your turn with only tool calls—always end with a clear, concise text answer or summary (e.g. "You have X leads", "Here are the deals..."). Prefer one or two tool calls when possible (e.g. use perPage and page to get totals), then answer.`,
    onStepFinish({ text, toolCalls, toolResults, usage, finishReason }) {
      console.log("[v0] /api/ai/chat step finished", {
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

  console.log("[v0] /api/ai/chat streamText initialized");
  return result.toUIMessageStreamResponse();
}