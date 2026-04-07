import { createMCPClient } from "@ai-sdk/mcp";
import { Buffer } from "node:buffer";
import { streamText, stepCountIs } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import type { ModelMessage, ToolSet } from "ai";

export const runtime = "nodejs";
/** Vercel: allow long Bedrock + MCP streams (Hobby plan max 10s unless upgraded). */
export const maxDuration = 60;

/**
 * Used when `BEDROCK_MODEL_ID` is missing or blank in the environment.
 * Claude Sonnet 4.5 on Amazon Bedrock — stronger than Haiku for tools + long answers.
 * Newer Claude models must be invoked via a Bedrock **inference profile** ID (not the
 * raw foundation model ID), or Bedrock returns "on-demand throughput isn't supported".
 * `us.*` is for US commercial regions; use `eu.*`, `ap.*`, etc. per AWS docs for your region.
 * Override with `BEDROCK_MODEL_ID` if needed (including a full inference profile ARN).
 */
const DEFAULT_BEDROCK_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

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

const MAX_PDF_ATTACHMENTS = 5;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

type PdfAttachmentInput = {
  name: string;
  mimeType: string;
  data: string;
};

function parsePdfAttachments(raw: unknown): PdfAttachmentInput[] | Response {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    return jsonError(400, "attachments must be an array when provided.");
  }
  if (raw.length > MAX_PDF_ATTACHMENTS) {
    return jsonError(
      400,
      `Too many PDF attachments (max ${MAX_PDF_ATTACHMENTS}).`
    );
  }

  const out: PdfAttachmentInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return jsonError(400, "Invalid attachment entry.");
    }
    const name = (item as { name?: unknown }).name;
    const mimeType = (item as { mimeType?: unknown }).mimeType;
    const data = (item as { data?: unknown }).data;
    if (typeof name !== "string" || !name.trim()) {
      return jsonError(400, "Each attachment must include a name.");
    }
    if (typeof mimeType !== "string" || !mimeType.trim()) {
      return jsonError(400, "Each attachment must include a mimeType.");
    }
    if (mimeType !== "application/pdf") {
      return jsonError(400, "Only PDF attachments are supported right now.");
    }
    if (typeof data !== "string" || !data.trim()) {
      return jsonError(400, "Each attachment must include base64 data.");
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(data, "base64");
    } catch {
      return jsonError(400, "Invalid base64 data for an attachment.");
    }
    if (buf.length === 0) {
      return jsonError(400, "Attachment data was empty.");
    }
    if (buf.length > MAX_PDF_BYTES) {
      return jsonError(
        400,
        `Attachment "${name}" is too large (max ${Math.floor(
          MAX_PDF_BYTES / (1024 * 1024)
        )}MB).`
      );
    }

    out.push({ name: name.trim(), mimeType: mimeType.trim(), data });
  }

  return out;
}

function applyPdfAttachmentsToMessages(
  messages: ModelMessage[],
  attachments: PdfAttachmentInput[]
): ModelMessage[] {
  if (attachments.length === 0) return messages;

  const next = [...messages];
  const last = next[next.length - 1];
  if (!last || last.role !== "user") {
    return messages;
  }

  let text = "";
  if (typeof last.content === "string") {
    text = last.content;
  } else if (Array.isArray(last.content)) {
    const parts = last.content as Array<{ type?: unknown; text?: unknown }>;
    text = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n");
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: Buffer; mediaType: string; filename?: string }
  > = [{ type: "text", text: text.trim() ? text : " " }];

  for (const a of attachments) {
    content.push({
      type: "file",
      data: Buffer.from(a.data, "base64"),
      mediaType: a.mimeType,
      filename: a.name,
    });
  }

  next[next.length - 1] = { role: "user", content };
  return next;
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

    const attachmentsRaw = (body as { attachments?: unknown }).attachments;
    const parsedAttachments = parsePdfAttachments(attachmentsRaw);
    if (parsedAttachments instanceof Response) {
      return parsedAttachments;
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

    if (
      process.env.NODE_ENV === "development" &&
      /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(mcpUrl)
    ) {
      console.warn(
        "[monday] MONDAY_MCP_URL uses https on localhost — TLS often fails in Node (self-signed). Use http://localhost:PORT/api/mcp unless your MCP serves a trusted certificate."
      );
    }

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
      process.env.BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL_ID;
    console.log("[monday] Bedrock model:", modelId);

    const system = buildSystemPrompt(
      mcpAvailable,
      currentDateTime,
      currentDate,
      currentDayOfWeek,
      currentTime
    );

    const modelMessages = applyPdfAttachmentsToMessages(
      messages as ModelMessage[],
      parsedAttachments
    );

    const result = streamText({
      model: bedrock(modelId),
      messages: modelMessages,
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
