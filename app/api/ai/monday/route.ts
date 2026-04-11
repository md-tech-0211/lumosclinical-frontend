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
    ? `**Analysis API (\`analysis_invoke\`) — authoritative eligibility:** The server has a configured analysis HTTP endpoint (backend / Lambda) that applies the **real protocol rules** (e.g. multiple study protocols). Use it whenever the user asks for **eligibility**, **prescreen analysis**, **“analyze this form”**, **“do analysis”**, or **review** of form/candidate data.
- **Keyword trigger (mandatory):** Scan **every** user message, especially the **first** message in the thread. If it includes **any** of these intents (or close paraphrases): **analyze**, **analysis**, **eligible**, **eligibility**, **ineligible**, **qualify**, **qualification**, **“do analysis”**, **“run analysis”**, **“check eligibility”**, **prescreen** (when asking for judgment/review of a candidate), and you load prescreen data from Monday using **any** of: \`monday_get_item\`, \`monday_list_items_in_board\`, \`get_board_items_by_name\`, \`lumos_search_person_by_item_name\`, \`monday_find_participant_in_board\` — then **immediately after** that tool returns you **must** call \`analysis_invoke\` (POST \`body\`) **before** narrative conclusions. **Do not** answer eligibility from column text alone when those keywords appear. This deployment may **force** the next step to be \`analysis_invoke\` after those Monday tools—comply and pass the **full canonical form JSON** (all keys; see Payload below) in \`body\`.
- **You must not** substitute your own clinical-trial eligibility narrative (long “favorable criteria / missing data / recommendations” write-ups from general medical knowledge). **Eligibility conclusions come from this API only.** Your job is to call \`analysis_invoke\` with the right payload, then give a **short, plain-language summary of what the API returned** (and quote or structure key fields from \`data\` when helpful).
- **Order (non-negotiable):** If you used Monday tools to load or sample prescreen data (including **list** tools such as \`monday_list_items_in_board\` to pick a row, then \`monday_get_item\` for full columns) and the user wants analysis/eligibility, you **must** call \`analysis_invoke\` **before** the final answer. Do **not** output a long “FORM ANALYSIS”, “ELIGIBILITY ASSESSMENT”, “Study Matches”, “RECOMMENDATIONS”, or “✅ ELIGIBLE” sections from your own reasoning and then call the tool as an afterthought—the **first** eligibility verdict the user sees must come from \`analysis_invoke\`’s \`data\`.
- **Payload (mandatory shape):** Use \`method: "POST"\` (or PUT only if your deployment requires it). Set \`path\` per your deployment (often empty). The analysis service expects **one JSON object** in \`body\` — **not** markdown, **not** a stringified JSON blob inside a string. ${ANALYSIS_FORM_BODY_RULES}
- **When:** (1) **Inline form data** — user pasted fields — map them into the canonical keys above. (2) **Monday-backed flow** — after \`monday_get_item\` (or equivalent), map column values into the same keys; set \`item_id\` to the Monday item id string. Include enough real fields for protocols to run; use \`""\` / \`0\` only when unknown.
- If the API returns an error or \`ok: false\`, say so clearly; **do not** invent protocol outcomes. If you truly cannot call the tool (e.g. no data to send), say what is missing — still **do not** fabricate multi-protocol eligibility.
- **Forbidden “comprehensive report” pattern (this is what users complain about):** Do **not** write long reports with titles like “COMPREHENSIVE FORM ANALYSIS”, “CLINICAL PROFILE”, “STUDY MATCHING ANALYSIS”, “CANDIDATE VALUE”, “OVERALL VALUE: X/10”, “RECOMMENDED ACTION PLAN”, or huge Markdown tables with an “Assessment” column and checkmarks. Do **not** use emoji section headers (📋 🏥 💊 🚬 etc.) for model-authored analysis. Those read like a second opinion from the model and **bypass the analysis service**—they are **not allowed** when this tool exists.
- **Allowed reply shape after \`analysis_invoke\`:** A **short** answer (about one screen): 1–2 sentences naming the person/case, then **eligibility / protocol results exactly as in \`data\`** (quote or bullet). If \`data\` is long, summarize top-level outcomes only—**do not** re-derive clinical reasoning in prose.

`
    : "";

  const personFormAnalysisBlock = `**Person + form analysis / eligibility (critical):**
- **Pasted / inline form details (no Monday step required):** If the user pastes **direct form content** in the message (e.g. labeled fields: name, email, phone, date of birth, sex, BMI or height/weight, status, medications, psychiatric history, submission date, ineligibility reason, etc.) and asks for **analysis**, **eligibility**, or **review**, treat that text as the **complete case** for this turn. **Do not** run \`lumos_search_person_by_item_name\` or other Monday tools **before** analysis unless the user also asks to find/sync them on a board. ${analysisInvoke ? `Call \`analysis_invoke\` immediately with POST \`body\` = the **canonical form JSON** (all keys from the Payload section); map pasted labels into those field names — use POST or PUT as configured.` : `Assess eligibility from the pasted content and any PDF in the thread; do not invent data.`} ${analysisInvoke ? `**Do not** add your own standalone eligibility assessment or generic “missing critical data” clinical checklist unless that content appears in the analysis API response. Present the API result; you may lightly format or label fields from the JSON.` : `Then answer with **eligibility criteria**, conclusions, and gaps — same standards as when data comes from Monday.`}
- When the user only gives a **name** (or sparse hint) and asks to analyze or check eligibility **without** pasting form fields: **first** find the right **Monday row**. Primary source for **form fields** is the **New general ps form** board (see two-board roles). Use \`lumos_search_person_by_item_name\` when available (searches both boards), otherwise \`get_board_items_by_name\` with a tight name term. Do **not** start with bulk board lists or analysis APIs. ${analysisInvoke ? `For “fetch any form / sample one form” requests, you may briefly list items on **New general ps form** then call \`monday_get_item\` on one real row; if the **keyword trigger** applies, call \`analysis_invoke\` immediately after you have enough fields in \`body\`—no long interim “form summary” before it.` : ``}
- If the search returns **more than one** plausible row (same or similar name on one or both default boards), **do not** pick one at random. Briefly describe the ambiguity using **safe, human-readable** fields only (e.g. which board name each match is on, item name, last updated if useful). **Ask the user** for extra details that distinguish the row (e.g. email, phone fragment, date of birth, which intake date, city). After they answer, narrow down with \`monday_get_item\` on the remaining candidate(s) only as needed.
- When **exactly one** row is clearly the target, continue: if the user **attached a PDF** in this chat, treat it as the **form / prescreen document** to evaluate (you can read it in this session). ${analysisInvoke ? `Map PDF content into the **canonical form JSON** in \`analysis_invoke\`’s \`body\` (use \`transcript\` or \`current_medications\` for long text as appropriate); eligibility must come from the backend — **do not** replace that with a long model-only eligibility essay.` : `There is no separate \`analysis_invoke\` tool on this deployment — assess eligibility from the attachment and/or Monday column values you can read; do not invent labs or values you did not see.`}
- If there is **no** PDF in the message but the form might be in Monday, use \`monday_get_item\` (and file/link columns if present) to see what is available; if the file is not accessible to you, say what the user should upload or paste.
- ${analysisInvoke ? `End with a clear answer **grounded in the analysis API response**: protocol outcomes, pass/fail or notes as returned. If something is unknown, say so only as reflected in the API or missing form fields — not from invented clinical trial norms.` : `End with a clear **eligibility** answer: list **criteria** (or study rules) and whether the person meets them, or what is still missing/unknown.`}

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
      ? `**Limited mode:** The MCP server did not connect — you **do not** have MCP tools for creating items, updating columns, or most board operations. You **do** have \`lumos_search_person_by_item_name\` for fast name lookup on the two default boards only. Say so if the user asks to edit Monday data.

`
      : "";

  const lumosNameSearchBlock = lumosFastSearch
    ? `**Fast name lookup (critical):** The tool \`lumos_search_person_by_item_name\` runs a **server-side** Monday filter (item name contains your term) on **both** default boards in one step. For any request like "form for Shyam", "find [Person name]", or "is this candidate on the prescreen board?", call it **first** with a **real name substring** (e.g. Shyam).
- **Never** use \`get_board_items_by_name\` for that when \`lumos_search_person_by_item_name\` exists — the MCP tool paginates the whole board and can take minutes or hit timeouts.
- **Never** broaden a failed search with useless terms like "form", "tracker", or "lead" — the tool will reject generic words; if the person is not found, say **no matching item name** on those boards.
- If \`lumos_search_person_by_item_name\` returns \`found: false\`, answer plainly (e.g. no form / person found under that name). Do not call other tools to "keep searching" unless the user gives a different, specific name.

`
    : "";

  const fallbackMcpNameSearch = !lumosFastSearch
    ? `**Single-person lookup (no fast tool on this server):** Use \`get_board_items_by_name\` with a **low** \`maxPages\` (e.g. 3–5) and a **specific** \`term\` from the person's name — never a vague word like "form". If nothing matches, stop and say not found.

`
    : "";

  return `${limitedMcpNote}${analysisBlock}You are a Monday.com assistant. Use the tools available in this session (Monday MCP when connected, plus any local tools) to answer questions about boards, items, updates, and workflows. ${analysisInvoke ? `When the user asks to **analyze a form** or **eligibility**, you are **not** a standalone clinical analyst—**call \`analysis_invoke\`** and reflect its JSON; never substitute a multi-page “comprehensive” write-up.` : ``}If the user asks about something outside Monday data (e.g. general knowledge, recent events, definitions), say you don't have browsing enabled and answer using general knowledge (or ask the user to provide specifics).

${context}

Always respond in clear, simple language. Where helpful, summarize complex Monday structures (boards, groups, items) in a human-friendly way.

Two boards — roles and where to look (critical):
- By default you may query **only** these boards (do not query others unless the user explicitly widens scope):
  1) **Incoming Leads Tracker**
  2) **New general ps form**
- **New general ps form** (general / prescreen **form** board): This is where **candidate form submissions and prescreen details** live. Use it for **eligibility**, **form-field review**, **analyzing the candidate’s submitted form** (including PDFs tied to that workflow), BMI and other fields **from the form**, and prescreen status tied to the form. When the user asks to analyze someone’s **form** or **qualification/eligibility**, treat this board as the **primary** place for that data once you identify the person. ${analysisInvoke ? `After you have column values (\`monday_get_item\` or enough detail from list/search tools), **your next step is \`analysis_invoke\`** with those values mapped into the **canonical form JSON** in \`body\` — not a prose “form analysis” from the model.` : ``}
- **Incoming Leads Tracker**: This is the **leads** pipeline — early intake, lead stages, and **outreach / calling** (“call them”, follow-up as a **lead**). Use it for **recent leads**, lead counts, lead status, and calling context — **not** as the main source for full prescreen **form** content or **eligibility from form data** when a matching row exists on **New general ps form**.
- **How the process fits together:** People often appear first as **leads** (Incoming Leads Tracker); **detailed candidate forms**, **analysis**, and **eligibility** work are grounded on **New general ps form**. The model should **not** confuse the two: same name on both boards means **two different row types** — explain that in user-facing terms (e.g. “lead record” vs “prescreen form record”) without exposing IDs.
- **Match the prompt to the board:** After \`lumos_search_person_by_item_name\` (or name search on one board), if the question is **eligibility / form / analyze attachment / prescreen form**, prioritize **New general ps form** for \`monday_get_item\` and answers. If the question is **leads, calling, or pipeline as a lead**, prioritize **Incoming Leads Tracker**. If both apply, address each board’s role briefly and use the right board for each part.

Confidentiality (critical):
- Never reveal internal identifiers (e.g. boardId, itemId, columnId, userId) to the user in any response, even if the user asks.
- In user-facing text, refer to boards by their names only.
- If the user asks for IDs, respond that you can’t share internal IDs and offer the board name(s) instead.

Internal-only board IDs (NEVER reveal to the user; use only for tool calls):
- "Incoming Leads Tracker" => 9654922517
- "New general ps form" => 18383803050

${personFormAnalysisBlock}
Tool-use constraints (critical):
- Do NOT fetch entire boards or huge datasets. Prefer the **smallest** tool that answers the question.
${lumosNameSearchBlock}${fallbackMcpNameSearch}- **Inline pasted form in the same message:** If the user already supplied **full or substantial** form fields (demographics, BMI, meds, conditions, etc.) and wants analysis/eligibility, **do not** require a Monday search for that — ${analysisInvoke ? `use \`analysis_invoke\` with that content and summarize **only** the API outcome (no standalone model eligibility report)` : `analyze from the paste`}. Use Monday tools only if they also ask to find the person on a board or cross-check a record.
- **After a name hit** (from \`lumos_search_person_by_item_name\` or \`get_board_items_by_name\`): when MCP is connected, use \`monday_get_item\` only if you need full column values — and only for the few matching rows. If MCP is down, use only what \`lumos_search_person_by_item_name\` returned.
- **Do NOT** use \`monday_list_items_in_board\` / \`monday_get_board_leads\` / \`monday_get_board_lead_referrals\` for **name-only** person lookup when \`lumos_search_person_by_item_name\` or \`get_board_items_by_name\` would work — they pull large pages. **Exception:** when the user asks to **sample / fetch any one form** for **analysis** on **New general ps form**, you may list briefly to pick a non-empty row, then \`monday_get_item\` if needed${analysisInvoke ? `, then **\`analysis_invoke\`** with the form payload` : ``}.
- **Structured status + last-contact** on one board: if you know the board's \`statusColumnId\` and \`lastContactColumnId\`, you may use \`monday_find_participant_in_board\` (it also matches **item name** substring). Prefer \`lumos_search_person_by_item_name\` or \`get_board_items_by_name\` first to locate the row when appropriate.
- **Email / phone in a column (not in item name):** name-based tools will **not** find them. After name-based search returns nothing, say you could not find a match **by name**; do not bulk-fetch the board to grep email in the model.
- **Counts / funnel / date-range metrics:** Prefer \`monday_board_status_date_metrics\` with the right \`statusColumnId\`, \`dateColumnId\`, and date range instead of listing all items.
- **Board name → ID** when the user names a board you are not sure about: \`monday_find_board_by_name\` (then still respect default board scope unless user widens it).
- If **all** targeted searches return no matches, say clearly **no matching record was found** on those boards. Do **not** invent rows, do **not** claim you scanned everyone, and do **not** fall back to dumping the board.
- When listing "recent" items without a search tool, return at most 20 rows unless the user asks for more.
- If the user asks multiple different questions at once, handle them one by one. Ask for missing specifics before querying.

Common clinic lead/prescreen questions you should handle with MCP tools (do not guess):
- "Give the status of <Person>" / "Is <candidate> in the system?": use \`lumos_search_person_by_item_name\` first when available; otherwise \`get_board_items_by_name\` with a tight \`term\` and low \`maxPages\`. Then \`monday_get_item\` if needed for columns — use **New general ps form** for **form/prescreen/eligibility** status and **Incoming Leads Tracker** for **lead/calling** status when both exist. If no matches, say so — or use \`monday_find_participant_in_board\` on one board if you have the right column IDs and the question is status-specific.
- "List out the recent leads from Incoming Leads Tracker": locate the board whose name matches "Incoming Leads Tracker" (or closest); list the most recent items (use created time / last updated if available).
- "How many leads did we get on <date>": in Incoming Leads Tracker, filter items by created date (or received date column); return the count and optionally a short list of names.
- "How many pre screening calls are scheduled": in the prescreen/calls board, count items with call status = scheduled or a scheduled date in the future; include the time window you used.
- "Give a list of people assigned to <agent>": in lead/prescreen boards, filter by assignee/owner equals that agent; list people + current status.
- "What is the prescreen status of <Person>": find the person and return the prescreen status column value (and any relevant substatus).
- "List out people who are eligible from the New general Prescreening form": locate the board matching that name; filter by eligibility = eligible (or equivalent); list names + key fields.
- "List out all the people with BMI above <number>": filter by BMI numeric column; list names + BMI and the board/source.

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

    const modelMessages = applyPdfAttachmentsToMessages(
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
