import { createMCPClient } from "@ai-sdk/mcp";
import { Buffer } from "node:buffer";
import { generateText, streamText, stepCountIs } from "ai";
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
  effectiveMondayChatMaxPdfPages,
  resolveChatAttachmentMime,
} from "@/lib/chat-attachments";
import {
  BEDROCK_PROMPT_FIT_TARGET_TOKENS,
  isPromptTooLongError,
  parseReportedPromptTokens,
} from "@/lib/bedrock-prompt-limit";
import {
  clampPdfToMaxPages,
  PDF_PAGE_COUNT_UNKNOWN,
} from "@/lib/pdf-page-count";

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

/**
 * Bedrock document names must only use alphanumeric characters, whitespace, hyphens,
 * parentheses, and square brackets, with no consecutive whitespace (ValidationException).
 */
function sanitizeBedrockDocumentFileName(name: string): string {
  let s = name.replace(/[^a-zA-Z0-9 \-()\u005B\u005D]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/ +/g, " ");
  s = s.replace(/^[\s-]+|[\s-]+$/g, "");
  return s || "document";
}

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
      filename: sanitizeBedrockDocumentFileName(a.name),
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
    ? `**\`analysis_invoke\` vs in-thread analysis:** The \`analysis_invoke\` tool calls your **deployed prescreen/eligibility API** with structured form JSON. **Do not** use it when the user wants **only** a **document-based** review: e.g. they attached a **protocol** (or study PDF) plus **patient/case** data and ask you to **compare**, **check compliance**, **review inclusion/exclusion**, or **analyze** using **those files** — including when they say **not** to use the API/tool, **not** to fetch Monday, or to **analyze yourself** from the attachments. In that case, read the **file contents** in the thread and answer **directly** (clearly label limitations vs a formal eligibility system). Use Monday tools **only** if they explicitly ask you to **look up a live board row**.

**\`analysis_invoke\` — when the user asks for the eligibility API path:** If the user’s message includes **analysis**, **analyze**, **eligibility**, **eligible**, **ineligible**, **qualify**, **qualification**, **prescreen** (when asking for judgment/review of a candidate), **“do analysis”**, **“check eligibility”**, or close paraphrases — call \`analysis_invoke\` (POST \`body\`) **only when** that API path applies and you have **real data to send** (pasted form fields, or a Monday item with enough columns). **Do not** call \`analysis_invoke\` if a name search / list returned **no matching rows**, **not found**, or empty results — tell the user clearly that no data was found instead.
- **After Monday tools:** If you loaded one or more rows and the user asked analysis/eligibility, call \`analysis_invoke\` **before** a long narrative: **one row** → single JSON object in \`body\` (column keys → values); **several rows** → \`{"candidates":[{...},{...}]}\` with one object per row. This deployment may **suggest** the next step — comply when you have payload data. **Never** call \`analysis_invoke\` with an empty or fabricated payload.
- **Spreadsheets (CSV, Excel .xlsx, etc.):** If the user attached a **table of candidates** and wants analysis / eligibility for **the file**, include **every** non-header data row you can read in \`{"candidates":[...]}\` (**one object per row**). **Do not** arbitrarily take only the “first N” or “first few complete” rows unless the user explicitly asked for a limit or sample — if you must skip a row (blank, garbled, duplicate header), say **which row(s)** and why.
- **Payload:** Plain JSON in \`body\` — not markdown. ${ANALYSIS_FORM_BODY_RULES}
- **Monday + analysis:** Build the payload from **New general ps form** (form board) when fetching prescreen fields. Pasted inline form → map into \`body\` and call \`analysis_invoke\` without needing Monday first, unless they also ask to find the row.
- **Output format requirement:** After \`analysis_invoke\` returns, always include:
  - **Eligibility**: Eligible / Ineligible / Pending (or whatever the API says).
  - **Why**: 2–6 short bullet points explaining *why* based strictly on the API response fields (e.g. reasons, rule hits, failed criteria). If the API does not return reasons, say “No reasons provided by the analysis service” (do not invent).
- **Bulk output requirement (no paragraphs):** If the analysis covered **multiple candidates** (e.g. \`body.candidates\`), present results primarily as a **GitHub-flavored Markdown table** (one row per candidate). Preferred columns: **Name**, **Eligibility**, **Top reasons** (short; use semicolons), **Notes** (optional). Avoid long narrative paragraphs; at most 1–2 short sentences after the table if needed.
- **Batched tool responses:** If the tool returned a batched response (e.g. \`data.batched: true\` with multiple batch results), merge batches into **one** table for the user. If some batches failed, include an **Errors** column or a short errors section listing only the failing batch numbers and error messages.
- **Conclusions** come from the API response only — no invented multi-protocol write-ups. Short user-facing summary after \`data\`. If \`ok: false\`, say so.

`
    : "";

  const personFormAnalysisBlock = `**Person + form + PDF:** Pasted form fields or PDF → ${analysisInvoke ? `use \`analysis_invoke\` with row(s) as JSON (keys → values), or \`{"candidates":[...]}\` **when** the user expects the **prescreen/eligibility API** result — **not** when they asked for **protocol/file-only** analysis (see above). Do not run Monday first unless they also want the row found.` : `assess from content.`} Name + analysis/eligibility without paste → find the row on **New general ps form** only (see board routing), \`monday_get_item\`, then ${analysisInvoke ? `\`analysis_invoke\` **only if** a row was found with usable fields — if **not found**, stop; no \`analysis_invoke\`.` : `answer from columns.`} Multiple name matches → describe ambiguity; if the user wants everyone analyzed and you have multiple items, send **all** in \`candidates\`; otherwise ask which row. PDF / protocol in thread → ${analysisInvoke ? `if they want the **API**, map into \`analysis_invoke\` body; if they want **review vs protocol / your assessment from files**, answer from the documents without \`analysis_invoke\`.` : `assess from the file and/or Monday columns.`}

`;

  const protocolPlusMondayBlock = `**Protocol summary + Monday (typical workflow):** The user may attach a **short protocol PDF** (e.g. one-page summary) and ask you to **analyze** a case using **Monday data**. Use the **smallest** Monday lookups needed (\`get_board_items_by_name\` → \`monday_get_item\`, etc.), then answer **in this chat** by combining **what’s in the attachment** with **columns you fetched**. Treat the uploaded protocol as **context for this conversation only** — you are not assumed to have the full study file elsewhere.${analysisInvoke ? ` **Do not** call \`analysis_invoke\` for this workflow unless the user clearly wants the **automated prescreen/eligibility API** result; a structured narrative from protocol + Monday is the default.` : ``}

**Protocol PDF already in the thread:** If a **protocol or summary PDF** was attached in an **earlier message**, it still counts as the protocol context for **later questions** in the same chat (e.g. “now fetch Monday and analyze”). Continue with **in-chat** analysis against that document; **do not** call \`analysis_invoke\` unless the user explicitly asks for the **prescreen/eligibility API** / \`analysis_invoke\`.

**Evaluation gaps → follow-up questions:** After you synthesize, if assessment is incomplete, add a **numbered list** of **specific** questions or missing facts (labs, dates, staging, prior lines, pregnancy, con meds, consent, I/E criteria not visible in Monday or the PDF) that someone would still need to answer to evaluate the case. Keep questions practical for coordinators; skip the list only when you already have enough to conclude.

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

  return `${limitedMcpNote}${analysisBlock}You are a Monday.com assistant. Use tools in this session to answer from Monday data when the user needs **live** board data. ${analysisInvoke ? `Call \`analysis_invoke\` only for the **eligibility API** path when you have **actual form or item payload** — not for protocol/document-only review, and not when lookups returned nothing.` : ``} For general non-Monday questions, answer from general knowledge or say you cannot browse.

${context}

Always respond in clear, simple language.

**“Empty” rows vs sparse tool payloads (critical):**
- Do **not** tell the user the board is “empty”, that rows are “placeholders”, or that “only one candidate has completed data”, unless tools returned **no matching items**, **not found**, or an explicit empty marker from the integration — **not** merely because some columns look blank or the payload omitted long text fields.
- If tool JSON is **sparse** but still has an item id/name/status, describe it as **limited fields in this response** or **not enough columns for eligibility/API**, and list **what is missing for that task**. Do **not** infer that Monday’s UI table is blank.
- Mirrors, formulas, and some column types may **not** surface in full in API JSON; that is **not** proof that cells are empty on the board.

**Schema-first fetching (critical for “all candidate data” and **table answers**):**
- When the user asks to “fetch data”, “show all data”, “all fields”, “all columns”, “table schema”, **“in a table”**, **“as a table”**, **“table format”**, or mentions **multiple candidates**, you MUST understand the board’s **column schema** first, then fetch **full rows** — **especially** when they want candidate data presented as a **Markdown table**.
- Preferred order (**do not skip for multi-candidate table requests**):
  - **(1) Fetch board columns/schema** (if the MCP provides it: \`monday_get_board_columns\`, \`monday_get_board_schema\`, \`get_board_columns\`, etc.) on the **routed board only**. Use column **titles** as the logical field names for your table headers (user-facing labels, not raw ids).
  - **(2) For each candidate row** you will include, call \`monday_get_item\` so you have **full column values** for that item. Name search / list previews are **not** enough to fill a complete table — you need the full item payload per person.
- If a board-schema tool is NOT available:
  - Fetch **one** matched item via \`monday_get_item\` first to learn which fields/columns exist.
  - Then fetch \`monday_get_item\` for **every** matched candidate and return the full non-empty dataset.
- **Table output + multiple people:** Build the table from **schema + one full \`monday_get_item\` per candidate**. Include **all column details** you retrieved for those items (split wide data across multiple tables or column groups if needed). Only narrow to a **subset** of columns if the user explicitly asked for specific fields (e.g. “name and phone only”).
- If any fetch returns empty / not found, say clearly “no data returned” for that candidate instead of guessing.


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
${protocolPlusMondayBlock}
Tool-use constraints (critical):
- Do NOT fetch entire boards or huge datasets. Prefer the **smallest** tool that answers the question.
${lumosNameSearchBlock}${fallbackMcpNameSearch}- **Inline pasted form in the same message:** If the user already supplied **full or substantial** form fields (demographics, BMI, meds, conditions, etc.) and wants analysis/eligibility, **do not** require a Monday search for that — ${analysisInvoke ? `use \`analysis_invoke\` with that content **when** they want the **prescreen API** result and summarize **only** the API outcome. If they asked for **your** assessment from paste/files only (no API), analyze in-thread.` : `analyze from the paste`}. Use Monday tools only if they also ask to find the person on a board or cross-check a record.
- **After a name hit** (from \`get_board_items_by_name\` on the **correct** board, or \`lumos_search_person_by_item_name\` only when cross-board ambiguity): when MCP is connected, use \`monday_get_item\` only if you need full column values — and only for the few matching rows. If MCP is down, use only what the name search returned.
- **Do NOT** use \`monday_list_items_in_board\` / \`monday_get_board_leads\` / \`monday_get_board_lead_referrals\` for **name-only** person lookup when \`get_board_items_by_name\` on the routed board (or \`lumos_search_person_by_item_name\` when truly ambiguous) would work — they pull large pages. **Exceptions (list is only for IDs, then always \`monday_get_item\`):** (a) **sample / one form** for **analysis** on **New general ps form** — list briefly if needed, then \`monday_get_item\`${analysisInvoke ? `, then **\`analysis_invoke\`** if applicable` : ``}. (b) User asks for **the first N candidates**, **N rows**, **“give me 5 form rows”**, etc. — use **one** list call (or page) **only** to collect **N item IDs**, then **\`monday_get_item\` exactly N times** (once per ID). **Never** treat the list payload as full form data; **never** answer with **one** deep candidate when **N > 1** was requested.
- **Structured status + last-contact** on one board: if you know the board's \`statusColumnId\` and \`lastContactColumnId\`, you may use \`monday_find_participant_in_board\` (it also matches **item name** substring). Prefer \`get_board_items_by_name\` on the **target** board first; use \`lumos_search_person_by_item_name\` only for genuinely ambiguous cross-board name lookups.
- **Email / phone in a column (not in item name):** name-based tools will **not** find them. After name-based search returns nothing, say you could not find a match **by name**; do not bulk-fetch the board to grep email in the model.
- **Counts / funnel / date-range metrics:** Prefer \`monday_board_status_date_metrics\` with the right \`statusColumnId\`, \`dateColumnId\`, and date range instead of listing all items.
- **Board name → ID** when the user names a board you are not sure about: \`monday_find_board_by_name\` (then still respect default board scope unless user widens it).
- If **all** targeted searches return no matches, say clearly **no matching record was found** on those boards. Do **not** invent rows, do **not** claim you scanned everyone, and do **not** fall back to dumping the board.
- When listing "recent" items without a search tool, return at most 20 rows unless the user asks for more.
- If the user asks multiple different questions at once, handle them one by one. Ask for missing specifics before querying.

Examples (same routing rules): person’s data / BMI / prescreen / subjects / patients → **form board** only unless they said **lead** / **leads** / **lead tracker**. Leads list, lead counts, lead pipeline, calls scheduled **for leads** → **Incoming Leads Tracker** only (user should mention leads or it is clearly a leads-dashboard question). ${analysisInvoke ? `**Analysis** / **eligibility** → **\`analysis_invoke\`** only after you have real payload data; **never** if the lookup found nothing.` : ``}

**Multiple candidates — table format (mandatory):**
- If the user asks for data for **two or more** candidates (several names, “all of them”, “each person’s…”, comparing people, or any **multiple rows** of the same kind of fields), present the **main result** as **GitHub-flavored Markdown table(s)**: header row, separator (\`|---|\`), **one row per candidate**. Do **not** use repeated bullet sections or one paragraph per person as the primary layout unless the user explicitly asks for prose only.
- **Before** building that table: follow **Schema-first fetching** above — **see the board schema**, then **\`monday_get_item\` for each** of those candidates so the table reflects **complete item data**, not stubs from search results.
- Too many columns → split into **more than one table** (same candidates, different column groups) or **chunk** rows (e.g. 8–15 people per table) so it stays readable.

**Exact count (e.g. “5 candidates”, “three people’s form data”) — non-negotiable:**
- If the user gives a **number** (**N**) of candidates/rows/forms, your answer MUST include **N table rows** of data from **\`monday_get_item\`** (after schema fetch), **unless** the board has **fewer than N items** — then say so and show **every** item that exists.
- **Forbidden:** Delivering **one** full write-up for a single candidate when **N > 1**. **Forbidden:** Replacing **N − 1** rows with claims like “placeholder”, “mostly empty”, or “only one had data” **without** showing those rows’ actual column values from **\`monday_get_item\`**. Sparse columns still get a **table row**.
- **Forbidden:** Repeated listing / “scanning for complete forms” **unless** the user explicitly asked for **only** rows with complete/substantial data. Default: **first N items** (by however the board was listed) **or** first N matches from search — then **get_item** each.
- If a tool response is **truncated** (wrapper shows a slice), the returned rows are still valid IDs to fetch — **call \`monday_get_item\` for each** needed candidate; truncation is **not** proof the board lacks data.

**Large lists (critical to avoid truncation):**
- If the user asks for a "full list" like "full 25 candidates" or "all 25 from the board", you MUST return **all N rows** by using **compact tables** and **chunking** into multiple tables (e.g. rows 1–10, 11–20, 21–25). Do not stop early.
- **When the user did not** ask for a full table of all fields, a **default short set** of columns is often enough: **Name**, **Status**, **DOB** (or blank), **Age** (or blank), **Sex** (or blank), **Phone** (or blank), **Email** (or blank), **Location** (or blank). If you are not in the “all details” case, you may **omit** long free-text fields (medical history, notes, etc.) unless the user asked for them.
- For **“all details”**, **“all fields”**, **“show everything”**, or **multi-candidate table data** (schema-first rules), include **all relevant columns** from the board schema populated from **full \`monday_get_item\`** per row; split wide data across multiple tables if needed.
- Keep each cell concise; if a value is very long, truncate the cell to ~120 characters with an ellipsis.

**Single vs multi-row presentation:** For **one** candidate, a short paragraph or small bullet list is fine. For **two or more**, tables are **required** as above.

When your answer is tabular (multiple rows and columns of related data — e.g. board items with names, statuses, assignees, dates), format it as a **GitHub-flavored Markdown table**: header row, separator row (\`|---|\`), then one row per record. Do not fake tables with spaces or bullet lists unless the user asked for a non-tabular layout.`;
}

const MAX_TOOL_RESULT_CHARS = 60_000;
const MAX_LIST_ITEMS = 25;

function isEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length === 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * Recursively removes "empty" values so the model only sees useful data.
 * - Removes: null, undefined, "", "   ", empty objects (after pruning children)
 * - Keeps: 0, false, non-empty strings, dates-as-strings, **empty arrays []**
 *   (so `{ items: [] }` stays meaningful — “no results” vs `{ empty: true }`).
 */
function pruneEmptyDeep(value: unknown): unknown {
  if (value == null) return undefined;
  if (isEmptyString(value)) return undefined;

  if (Array.isArray(value)) {
    const prunedItems = value
      .map((v) => pruneEmptyDeep(v))
      .filter((v) => v !== undefined);
    return prunedItems;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const pruned = pruneEmptyDeep(v);
      if (pruned !== undefined) out[k] = pruned;
    }
    if (Object.keys(out).length === 0) return undefined;
    return out;
  }

  return value;
}

function truncateToolResult(value: unknown): unknown {
  if (value === null || value === undefined) {
    return {
      empty: true,
      note: "Tool returned null or undefined.",
    };
  }

  const pruned = pruneEmptyDeep(value);
  if (pruned === undefined) {
    if (Array.isArray(value) && value.length === 0) {
      return [];
    }
    if (isPlainObject(value) && Object.keys(value).length === 0) {
      return {};
    }
    return {
      emptyAfterNormalization: true,
      note:
        "All fields were null/blank after normalization, or nested objects became empty. The Monday row may still have data (mirrors, formulas, unsupported types). Do not claim the board or rows are empty in the UI—say this response had sparse JSON or refetch with monday_get_item / column schema.",
    };
  }

  // Fast path: small payloads
  try {
    const s = JSON.stringify(pruned);
    if (s.length <= MAX_TOOL_RESULT_CHARS) return pruned;
  } catch {
    // fall through
  }

  const truncationHint =
    "These entries are complete for tool-use: call monday_get_item for each item id you need. Do not infer the board is empty or abandon multi-candidate tables because this payload was shortened for size.";

  // Prefer structured truncation for common shapes
  if (Array.isArray(pruned)) {
    return {
      truncated: true,
      originalType: "array",
      originalLength: pruned.length,
      assistantHint: truncationHint,
      items: pruned.slice(0, MAX_LIST_ITEMS),
    };
  }

  if (pruned && typeof pruned === "object") {
    const v = pruned as Record<string, unknown>;
    for (const k of ["items", "data", "results", "leads"]) {
      const maybeArr = v[k];
      if (Array.isArray(maybeArr)) {
        return {
          ...v,
          truncated: true,
          truncation: { key: k, originalLength: maybeArr.length, kept: MAX_LIST_ITEMS },
          assistantHint: truncationHint,
          [k]: maybeArr.slice(0, MAX_LIST_ITEMS),
        };
      }
    }
  }

  // Last resort: return a compact preview
  let preview = "";
  try {
    preview = JSON.stringify(pruned).slice(0, MAX_TOOL_RESULT_CHARS);
  } catch {
    preview = String(pruned).slice(0, MAX_TOOL_RESULT_CHARS);
  }
  return {
    truncated: true,
    assistantHint: truncationHint,
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

    const pdfOriginalBuffers = new Map<number, Buffer>();
    for (let i = 0; i < parsedAttachments.length; i++) {
      const a = parsedAttachments[i];
      if (a.mimeType !== "application/pdf") continue;
      let buf: Buffer;
      try {
        buf = Buffer.from(a.data, "base64");
      } catch {
        continue;
      }
      if (buf.length === 0) {
        return jsonError(400, `The PDF "${a.name}" was empty.`);
      }
      pdfOriginalBuffers.set(i, buf);
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

    const prepareStep = createAnalysisInvokePrepareStep(analysisInvoke);

    if (pdfOriginalBuffers.size > 0) {
      let maxPages = effectiveMondayChatMaxPdfPages();
      const minPages = 2;
      let pdfContextProbeOk = false;

      for (let attempt = 0; attempt < 24; attempt++) {
        for (const [idx, buf] of pdfOriginalBuffers) {
          const a = parsedAttachments[idx];
          const { buffer, pageCount, truncated } = await clampPdfToMaxPages(
            buf,
            maxPages
          );
          a.data = buffer.toString("base64");
          if (truncated && attempt === 0) {
            console.warn(
              `[monday] PDF "${a.name}" had ${pageCount} pages; clamping to ${maxPages} page(s) max (initial cap before context probe).`
            );
          } else if (pageCount === PDF_PAGE_COUNT_UNKNOWN && attempt === 0) {
            console.warn(
              `[monday] PDF "${a.name}" could not be parsed for page trimming locally; sending original bytes (Bedrock may still read it).`
            );
          }
        }

        const probeMessages = applyChatAttachmentsToMessages(
          messages as ModelMessage[],
          parsedAttachments
        );

        try {
          // Must not use toolChoice: "none" — @ai-sdk/amazon-bedrock strips ALL tools from the
          // Converse request for "none", so the probe would under-count vs streamText (auto).
          await generateText({
            model: bedrock(modelId),
            messages: probeMessages,
            system,
            tools,
            maxOutputTokens: 1,
            maxRetries: 0,
            stopWhen: stepCountIs(1),
            ...(prepareStep ? { prepareStep } : {}),
          });
          pdfContextProbeOk = true;
          if (attempt > 0) {
            console.warn(
              `[monday] PDF context fits Bedrock input limit at ${maxPages} page(s) max per PDF (after ${attempt + 1} probe attempt(s)).`
            );
          }
          break;
        } catch (e) {
          if (!isPromptTooLongError(e)) {
            throw e;
          }
          const reported = parseReportedPromptTokens(e);
          let next =
            reported != null
              ? Math.floor(
                  maxPages * (BEDROCK_PROMPT_FIT_TARGET_TOKENS / reported)
                )
              : Math.floor(maxPages * 0.82);
          next = Math.max(minPages, next);
          if (next >= maxPages) {
            next = maxPages - 1;
          }
          maxPages = next;
          console.warn(
            `[monday] prompt too long${reported != null ? ` (${reported} tokens)` : ""}; retrying with max ${maxPages} PDF page(s) per file`
          );
          if (maxPages < minPages) {
            return jsonError(
              400,
              "The attached PDF(s) are too large for the model context even after shrinking. Try a shorter PDF, fewer pages, or fewer files."
            );
          }
        }
      }

      if (!pdfContextProbeOk) {
        return jsonError(
          500,
          "Could not confirm the PDF fits the model input limit. Try a smaller attachment."
        );
      }
    }

    const modelMessages = applyChatAttachmentsToMessages(
      messages as ModelMessage[],
      parsedAttachments
    );

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
