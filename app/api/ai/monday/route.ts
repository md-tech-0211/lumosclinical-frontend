import { createMCPClient } from "@ai-sdk/mcp";
import { Buffer } from "node:buffer";
import { streamText, stepCountIs } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import type { ModelMessage, ToolSet } from "ai";
import {
  buildAnalysisInvokeTool,
  isAnalysisFunctionConfigured,
} from "@/lib/analysis-function-tool";
import { createAnalysisInvokePrepareStep } from "@/lib/analysis-invoke-prepare-step";
import { buildLumosMondaySearchTools } from "@/lib/lumos-monday-tools";
import { ANALYSIS_FORM_BODY_RULES } from "@/lib/analysis-form-payload";
import { isMondayTokenConfigured } from "@/lib/monday-name-filter-search";
import {
  ATTACHMENT_TYPE_ERROR_HINT,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_FILE_BYTES_SERVER,
  resolveChatAttachmentMime,
} from "@/lib/chat-attachments";

export const runtime = "nodejs";
/** Vercel: allow long Bedrock + MCP streams (Hobby plan max 10s unless upgraded). */
export const maxDuration = 300;

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

type ChatAttachmentInput = {
  name: string;
  mimeType: string;
  data: string;
};

function parseChatAttachments(raw: unknown): ChatAttachmentInput[] | Response {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    return jsonError(400, "attachments must be an array when provided.");
  }
  if (raw.length > MAX_CHAT_ATTACHMENTS) {
    return jsonError(
      400,
      `Too many attachments (max ${MAX_CHAT_ATTACHMENTS}).`
    );
  }

  const out: ChatAttachmentInput[] = [];
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
    const resolved = resolveChatAttachmentMime(name.trim(), mimeType.trim());
    if (!resolved) return jsonError(400, ATTACHMENT_TYPE_ERROR_HINT);
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
    if (buf.length > MAX_CHAT_FILE_BYTES_SERVER) {
      return jsonError(
        400,
        `Attachment "${name}" is too large (max ${Math.floor(
          MAX_CHAT_FILE_BYTES_SERVER / (1024 * 1024)
        )}MB).`
      );
    }

    out.push({ name: name.trim(), mimeType: resolved, data });
  }

  return out;
}

function applyChatAttachmentsToMessages(
  messages: ModelMessage[],
  attachments: ChatAttachmentInput[]
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
  lumosFastSearch: boolean,
  analysisInvoke: boolean,
  currentDateTime: string,
  currentDate: string,
  currentDayOfWeek: string,
  currentTime: string
): string {
  const context = `Current date and time (UTC): ${currentDateTime}
Current date: ${currentDate} (${currentDayOfWeek})
Current time: ${currentTime} UTC`;

  const analysisBlock = analysisInvoke
    ? `**\`analysis_invoke\` — when the user asks for analysis or eligibility:** If the user’s message includes **analysis**, **analyze**, **eligibility**, **eligible**, **ineligible**, **qualify**, **qualification**, **prescreen** (when asking for judgment/review of a candidate), **“do analysis”**, **“check eligibility”**, or close paraphrases — call \`analysis_invoke\` (POST \`body\`) **only when you have real data to send** (pasted form fields, or a Monday item with enough columns). **Do not** call \`analysis_invoke\` if a name search / list returned **no matching rows**, **not found**, or empty results — tell the user clearly that no data was found instead.
- **After Monday tools:** If you successfully loaded a row with \`monday_get_item\` (or equivalent) and the user asked analysis/eligibility, call \`analysis_invoke\` with the **canonical form JSON** in \`body\` — before a long narrative. This deployment may **suggest** the next step — comply when you have payload data. **Never** call \`analysis_invoke\` with an empty or fabricated payload.
- **Payload:** One JSON object in \`body\` — not markdown. ${ANALYSIS_FORM_BODY_RULES}
- **Monday + analysis:** Build the payload from **New general ps form** (form board) when fetching prescreen fields. Pasted inline form → map into \`body\` and call \`analysis_invoke\` without needing Monday first, unless they also ask to find the row.
- **Output format requirement:** After \`analysis_invoke\` returns, always include:
  - **Eligibility**: Eligible / Ineligible / Pending (or whatever the API says).
  - **Why**: 2–6 short bullet points explaining *why* based strictly on the API response fields (e.g. reasons, rule hits, failed criteria). If the API does not return reasons, say “No reasons provided by the analysis service” (do not invent).
- **Conclusions** come from the API response only — no invented multi-protocol write-ups. Short user-facing summary after \`data\`. If \`ok: false\`, say so.

`
    : "";

  const personFormAnalysisBlock = `**Person + form + PDF:** Pasted form fields or PDF → ${analysisInvoke ? `\`analysis_invoke\` with canonical JSON; do not run Monday first unless they also want the row found.` : `assess from content.`} Name + analysis/eligibility without paste → find the row on **New general ps form** only (see board routing), \`monday_get_item\`, then ${analysisInvoke ? `\`analysis_invoke\` **only if** a row was found with usable fields — if **not found**, stop; no \`analysis_invoke\`.` : `answer from columns.`} Multiple name matches → describe ambiguity; ask user; do not guess. PDF in thread → ${analysisInvoke ? `map into \`analysis_invoke\` body.` : `assess from the file and/or Monday columns.`}

`;

  if (!mcpAvailable && !lumosFastSearch) {
    return `${analysisBlock}The Monday.com MCP backend is **not reachable** right now (connection failed, wrong URL, or server down). You **do not** have Monday tools — you cannot query live boards, items, or updates.

**Start your reply with one short line** like: "The Monday integration is temporarily unavailable, so I can’t see your live boards or items."

Then:
- Do **not** invent or guess specific board/item data.
- Offer general help about Monday.com concepts, or suggest the user check that the MCP server is running and \`MONDAY_MCP_URL\` points to the correct MCP HTTP endpoint (not the Next.js app page).
- If the question is about something else, answer helpfully.

${context}

Always respond in clear, simple language.`;
  }

  const limitedMcpNote =
    !mcpAvailable && lumosFastSearch
      ? `**Limited mode:** MCP tools for edits are unavailable. You have \`lumos_search_person_by_item_name\` (searches both boards). **Filter results** to the **one** board selected by the routing rule below (ignore hits on the other board). ${analysisInvoke ? `Call \`analysis_invoke\` only if a match has usable data — **not** if \`found: false\` or no items.` : ``}

`
      : "";

  const lumosNameSearchBlock = lumosFastSearch
    ? `**Name search:** Prefer \`get_board_items_by_name\` on the **routed board ID only** (see below). **Do not** use \`lumos_search_person_by_item_name\` except when the user explicitly asks to search **both** boards or “anywhere.” It queries both boards — avoid it for normal lookups.
- **Fallback:** If \`get_board_items_by_name\` returns **no matches**, try \`monday_search_board_items\` on the **same routed board** (substring search). Only say “not found” after both tools return no hits.
- If you use \`lumos_search_person_by_item_name\`, apply the **lead vs form** routing to **which hits** you use — never mix both boards in one answer unless the user asked two separate questions.

`
    : "";

  const fallbackMcpNameSearch = !lumosFastSearch
    ? `**Name search:** Use \`get_board_items_by_name\` on the **routed board ID** with a **low** \`maxPages\` and a **specific** name \`term\`.
- **Fallback:** If \`get_board_items_by_name\` returns **no matches**, try \`monday_search_board_items\` on the **same routed board** (substring search). Only say “not found” after both tools return no hits.

`
    : "";

  return `${limitedMcpNote}${analysisBlock}You are a Monday.com assistant. Use tools in this session to answer from Monday data. ${analysisInvoke ? `Call \`analysis_invoke\` for **analysis** / **eligibility** only when you have **actual form or item data** — not when lookups returned nothing.` : ``} For general non-Monday questions, answer from general knowledge or say you cannot browse.

${context}

Always respond in clear, simple language.

**Monday data — only these two boards (mandatory):**
- Fetch Monday items **only** from:
  1) **Incoming Leads Tracker** (leads / lead tracker) — ID \`9654922517\`
  2) **New general ps form** (**New general PS board**, prescreen **form** table) — ID \`18383803050\`
- **Routing (pick exactly one board per request):**
  - If the user mentions **leads**, **lead**, **leading** (pipeline sense), **lead tracker**, **leads tracker**, **incoming leads**, or **Incoming Leads** → use **only** Incoming Leads Tracker (\`9654922517\`). Do **not** query the form board for that same request.
  - If they do **not** mention any of the above (default) → use **only** New general ps form (\`18383803050\`). Do **not** query the leads board for that same request.
- **Do not** query both boards for one question. No “also checking” the other table.

${analysisInvoke ? `**Analysis / eligibility + boards:** Load prescreen **form** fields from **New general ps form** (\`18383803050\`) for the API when you need Monday data. **No row / no form fields** → do **not** call \`analysis_invoke\`; say data was not found. If the user’s message is **lead-only** and they also ask eligibility, explain that full eligibility needs **form board** data or a pasted form.

` : ``}
Confidentiality (critical):
- Never reveal internal identifiers (e.g. boardId, itemId, columnId, userId) to the user in any response, even if the user asks.
- In user-facing text, refer to boards by their names only.
- If the user asks for IDs, respond that you can’t share internal IDs and offer the board name(s) instead.

Internal-only board IDs (NEVER reveal to the user; use only for tool calls):
- "Incoming Leads Tracker" / leads tracker => 9654922517
- "New general ps form" / New general PS board => 18383803050

${personFormAnalysisBlock}
Tool-use constraints (critical):
- Do NOT fetch entire boards or huge datasets. Prefer the **smallest** tool that answers the question.
${lumosNameSearchBlock}${fallbackMcpNameSearch}- **Inline pasted form in the same message:** If the user already supplied **full or substantial** form fields (demographics, BMI, meds, conditions, etc.) and wants analysis/eligibility, **do not** require a Monday search for that — ${analysisInvoke ? `use \`analysis_invoke\` with that content and summarize **only** the API outcome (no standalone model eligibility report)` : `analyze from the paste`}. Use Monday tools only if they also ask to find the person on a board or cross-check a record.
- **After a name hit** (from \`get_board_items_by_name\` on the **correct** board, or \`lumos_search_person_by_item_name\` only when cross-board ambiguity): when MCP is connected, use \`monday_get_item\` only if you need full column values — and only for the few matching rows. If MCP is down, use only what the name search returned.
- **Do NOT** use \`monday_list_items_in_board\` / \`monday_get_board_leads\` / \`monday_get_board_lead_referrals\` for **name-only** person lookup when \`get_board_items_by_name\` on the routed board (or \`lumos_search_person_by_item_name\` when truly ambiguous) would work — they pull large pages. **Exception:** when the user asks to **sample / fetch any one form** for **analysis** on **New general ps form**, you may list briefly to pick a non-empty row, then \`monday_get_item\` if needed${analysisInvoke ? `, then **\`analysis_invoke\`** with the form payload` : ``}.
- **Structured status + last-contact** on one board: if you know the board's \`statusColumnId\` and \`lastContactColumnId\`, you may use \`monday_find_participant_in_board\` (it also matches **item name** substring). Prefer \`get_board_items_by_name\` on the **target** board first; use \`lumos_search_person_by_item_name\` only for genuinely ambiguous cross-board name lookups.
- **Email / phone in a column (not in item name):** name-based tools will **not** find them. After name-based search returns nothing, say you could not find a match **by name**; do not bulk-fetch the board to grep email in the model.
- **Counts / funnel / date-range metrics:** Prefer \`monday_board_status_date_metrics\` with the right \`statusColumnId\`, \`dateColumnId\`, and date range instead of listing all items.
- **Board name → ID** when the user names a board you are not sure about: \`monday_find_board_by_name\` (then still respect default board scope unless user widens it).
- If **all** targeted searches return no matches, say clearly **no matching record was found** on those boards. Do **not** invent rows, do **not** claim you scanned everyone, and do **not** fall back to dumping the board.
- When listing "recent" items without a search tool, return at most 20 rows unless the user asks for more.
- If the user asks multiple different questions at once, handle them one by one. Ask for missing specifics before querying.

Examples (same routing rules): person’s data / BMI / prescreen / subjects / patients → **form board** only unless they said **lead** / **leads** / **lead tracker**. Leads list, lead counts, lead pipeline, calls scheduled **for leads** → **Incoming Leads Tracker** only (user should mention leads or it is clearly a leads-dashboard question). ${analysisInvoke ? `**Analysis** / **eligibility** → **\`analysis_invoke\`** only after you have real payload data; **never** if the lookup found nothing.` : ``}

When your answer is tabular (multiple rows and columns of related data — e.g. board items with names, statuses, assignees, dates), format it as a **GitHub-flavored Markdown table**: header row, separator row (\`|---|\`), then one row per record. Do not fake tables with spaces or bullet lists unless the user asked for a non-tabular layout. For a single pair of facts, a short sentence or bullet list is fine.`;
}

const MAX_TOOL_RESULT_CHARS = 60_000;
const MAX_LIST_ITEMS = 25;

function truncateToolResult(value: unknown): unknown {
  // Fast path: small payloads
  try {
    const s = JSON.stringify(value);
    if (s.length <= MAX_TOOL_RESULT_CHARS) return value;
  } catch {
    // fall through
  }

  // Prefer structured truncation for common shapes
  if (Array.isArray(value)) {
    return {
      truncated: true,
      originalType: "array",
      originalLength: value.length,
      items: value.slice(0, MAX_LIST_ITEMS),
    };
  }

  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const k of ["items", "data", "results", "leads"]) {
      const maybeArr = v[k];
      if (Array.isArray(maybeArr)) {
        return {
          ...v,
          truncated: true,
          truncation: { key: k, originalLength: maybeArr.length, kept: MAX_LIST_ITEMS },
          [k]: maybeArr.slice(0, MAX_LIST_ITEMS),
        };
      }
    }
  }

  // Last resort: return a compact preview
  let preview = "";
  try {
    preview = JSON.stringify(value).slice(0, MAX_TOOL_RESULT_CHARS);
  } catch {
    preview = String(value).slice(0, MAX_TOOL_RESULT_CHARS);
  }
  return {
    truncated: true,
    preview,
  };
}

function wrapToolsWithTruncation(raw: ToolSet): ToolSet {
  const out: ToolSet = {};
  for (const [name, tool] of Object.entries(raw)) {
    const t: any = tool;
    const exec = t?.execute;
    if (typeof exec === "function") {
      out[name] = {
        ...t,
        execute: async (args: unknown, options: unknown) => {
          const res = await exec(args, options);
          return truncateToolResult(res);
        },
      } as any;
    } else {
      out[name] = tool;
    }
  }
  return out;
}

/** Smoke test: `GET /api/ai/monday` should return JSON (proves the route is registered). */
export async function GET() {
  return Response.json({ ok: true, route: "/api/ai/monday" });
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
    const parsedAttachments = parseChatAttachments(attachmentsRaw);
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
      tools = wrapToolsWithTruncation(tools);
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

    const lumosFastSearch = isMondayTokenConfigured();
    const analysisInvokeFromEnv = isAnalysisFunctionConfigured();
    const lumosTools = buildLumosMondaySearchTools();
    const analysisTools = buildAnalysisInvokeTool();
    tools = { ...tools, ...lumosTools, ...analysisTools };
    /** Prompts + prepareStep: true if this app proxies analysis OR MCP exposes `analysis_invoke` (e.g. Monday MCP on another host). */
    const analysisInvoke =
      analysisInvokeFromEnv || Object.hasOwn(tools, "analysis_invoke");
    console.log("[monday] tools (all keys):", Object.keys(tools), {
      lumosFastSearch,
      analysisInvoke,
      analysisInvokeFromEnv,
      analysisInvokeToolFromMcp:
        analysisInvoke && !analysisInvokeFromEnv,
    });

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
      lumosFastSearch,
      analysisInvoke,
      currentDateTime,
      currentDate,
      currentDayOfWeek,
      currentTime
    );

    const modelMessages = applyChatAttachmentsToMessages(
      messages as ModelMessage[],
      parsedAttachments
    );

    const prepareStep = createAnalysisInvokePrepareStep(analysisInvoke);

    const result = streamText({
      model: bedrock(modelId),
      messages: modelMessages,
      tools,
      ...(prepareStep ? { prepareStep } : {}),
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
