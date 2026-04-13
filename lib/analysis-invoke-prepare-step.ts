import type { ModelMessage, PrepareStepFunction, ToolSet } from "ai";

/**
 * Tools whose results mean we have (or attempted to load) Monday/board data for a case.
 * After any of these run, we can safely require `analysis_invoke` when the user asked for analysis.
 */
const MONDAY_DATA_TOOL_NAMES = new Set([
  "monday_get_item",
  "monday_list_items_in_board",
  "get_board_items_by_name",
  "monday_search_board_items",
  "lumos_search_person_by_item_name",
  "monday_find_participant_in_board",
  "monday_get_board_leads",
  "monday_get_board_lead_referrals",
]);

function textFromUserMessageContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = content as Array<{ type?: string; text?: string }>;
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** Last user message text in the model message list (current turn / thread). */
export function extractLatestUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      return textFromUserMessageContent(m.content).trim();
    }
  }
  return "";
}

/** True if the user is asking for form analysis / eligibility (broad keyword match). */
export function userRequestedAnalysisOrEligibility(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /\b(analy[sz]e|analysis|analysing|eligib|ineligib|qualif|qualification|prescreen)\b/i.test(
    t
  );
}

/**
 * MCP tools from `createMCPClient` appear on `dynamicToolCalls`; local tools (e.g. `analysis_invoke`,
 * `lumos_search_person_by_item_name`) use `toolCalls`. We must check both or forcing never triggers.
 */
function toolNamesFromStep(step: {
  toolCalls: ReadonlyArray<{ toolName: string }>;
  dynamicToolCalls?: ReadonlyArray<{ toolName: string }>;
}): string[] {
  const a = step.toolCalls.map((c) => c.toolName);
  const b = step.dynamicToolCalls?.map((c) => c.toolName) ?? [];
  return [...a, ...b];
}

function stepInvokedAnalysisInvoke(step: {
  toolCalls: ReadonlyArray<{ toolName: string }>;
  dynamicToolCalls?: ReadonlyArray<{ toolName: string }>;
}): boolean {
  return toolNamesFromStep(step).some((n) => n === "analysis_invoke");
}

function stepLoadedMondayData(step: {
  toolCalls: ReadonlyArray<{ toolName: string }>;
  dynamicToolCalls?: ReadonlyArray<{ toolName: string }>;
}): boolean {
  return toolNamesFromStep(step).some((n) => MONDAY_DATA_TOOL_NAMES.has(n));
}

/** Tool results on a completed step (shape varies slightly by AI SDK / MCP). */
function extractToolResultsFromStep(step: unknown): Array<{
  toolName: string;
  result: unknown;
}> {
  if (!step || typeof step !== "object") return [];
  const s = step as Record<string, unknown>;
  const raw =
    s.toolResults ?? s.staticToolResults ?? s.experimental_toolResults;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ toolName: string; result: unknown }> = [];
  for (const tr of raw) {
    if (!tr || typeof tr !== "object") continue;
    const o = tr as Record<string, unknown>;
    const name = o.toolName;
    if (typeof name !== "string" || !name) continue;
    out.push({
      toolName: name,
      result: o.result ?? o.output,
    });
  }
  return out;
}

/**
 * True when a Monday tool returned something we can run eligibility analysis on.
 * If every search/list returned empty / not found, do **not** force `analysis_invoke`.
 */
function mondayToolResultHasUsableCaseData(
  toolName: string,
  result: unknown
): boolean {
  if (result == null) return false;
  if (typeof result !== "object") return false;
  const r = result as Record<string, unknown>;

  switch (toolName) {
    case "lumos_search_person_by_item_name":
      return r.found === true;
    case "get_board_items_by_name": {
      const items = r.items ?? r.results ?? r.data;
      return Array.isArray(items) && items.length > 0;
    }
    case "monday_search_board_items": {
      const items = r.items ?? r.results ?? r.data;
      return Array.isArray(items) && items.length > 0;
    }
    case "monday_get_item": {
      if (Array.isArray(r.errors) && r.errors.length > 0) return false;
      const item = r.item ?? r.data;
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        return (
          typeof o.id === "string" ||
          typeof o.id === "number" ||
          Array.isArray(o.column_values)
        );
      }
      return Array.isArray(r.column_values);
    }
    case "monday_list_items_in_board": {
      if (Array.isArray(r.items) && r.items.length > 0) return true;
      const boards = r.boards;
      if (Array.isArray(boards) && boards[0] && typeof boards[0] === "object") {
        const b0 = boards[0] as Record<string, unknown>;
        const bi = b0.items;
        return Array.isArray(bi) && bi.length > 0;
      }
      return false;
    }
    case "monday_find_participant_in_board": {
      const found = r.found ?? r.match;
      if (found === false) return false;
      const item = r.item ?? r.participant;
      return item != null && typeof item === "object";
    }
    case "monday_get_board_leads":
    case "monday_get_board_lead_referrals": {
      const leads = r.leads ?? r.items ?? r.data;
      return Array.isArray(leads) && leads.length > 0;
    }
    default:
      return false;
  }
}

function stepsHaveUsableMondayDataForAnalysis(steps: unknown[]): boolean {
  for (const step of steps) {
    for (const { toolName, result } of extractToolResultsFromStep(step)) {
      if (!MONDAY_DATA_TOOL_NAMES.has(toolName)) continue;
      if (mondayToolResultHasUsableCaseData(toolName, result)) {
        return true;
      }
    }
  }
  return false;
}

/** True if any step exposed tool results we could read (AI SDK shape). */
function stepsExposeToolResults(steps: unknown[]): boolean {
  for (const step of steps) {
    if (extractToolResultsFromStep(step).length > 0) return true;
  }
  return false;
}

/**
 * When analysis is configured, forces the next model step to call `analysis_invoke` after
 * Monday tools have run, if the user message asked for analysis/eligibility and the tool
 * has not been used yet. Stops the model from writing long prose "form analysis" instead.
 *
 * Does **not** force `analysis_invoke` when Monday lookups returned no matching data — the
 * model should say "not found" instead of calling the analysis API with an empty payload.
 */
export function createAnalysisInvokePrepareStep(
  analysisInvokeConfigured: boolean
): PrepareStepFunction<ToolSet> | undefined {
  if (!analysisInvokeConfigured) return undefined;

  return ({ steps, messages }) => {
    const userText = extractLatestUserText(messages);
    if (!userRequestedAnalysisOrEligibility(userText)) {
      return undefined;
    }

    if (steps.some(stepInvokedAnalysisInvoke)) {
      return undefined;
    }

    const loadedMonday = steps.some(stepLoadedMondayData);
    /** User pasted substantial text (likely form fields) without using Monday tools first. */
    const likelyInlineForm =
      userText.length >= 120 && steps.length >= 1 && !loadedMonday;

    const hasMondayPayload = stepsHaveUsableMondayDataForAnalysis(
      steps as unknown[]
    );
    const sawToolResultObjects = stepsExposeToolResults(steps as unknown[]);

    /**
     * No forced analysis if Monday was queried and we **saw** tool results with no usable data.
     * If the runtime did not attach `toolResults` on steps, do not block (avoid false negatives).
     */
    if (
      loadedMonday &&
      !hasMondayPayload &&
      !likelyInlineForm &&
      sawToolResultObjects
    ) {
      return undefined;
    }

    if (!loadedMonday && !likelyInlineForm) {
      return undefined;
    }

    return {
      toolChoice: { type: "tool", toolName: "analysis_invoke" },
      activeTools: ["analysis_invoke"],
    };
  };
}
