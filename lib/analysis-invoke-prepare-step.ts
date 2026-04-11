import type { ModelMessage, PrepareStepFunction, ToolSet } from "ai";

/**
 * Tools whose results mean we have (or attempted to load) Monday/board data for a case.
 * After any of these run, we can safely require `analysis_invoke` when the user asked for analysis.
 */
const MONDAY_DATA_TOOL_NAMES = new Set([
  "monday_get_item",
  "monday_list_items_in_board",
  "get_board_items_by_name",
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

/**
 * When analysis is configured, forces the next model step to call `analysis_invoke` after
 * Monday tools have run, if the user message asked for analysis/eligibility and the tool
 * has not been used yet. Stops the model from writing long prose "form analysis" instead.
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

    if (!loadedMonday && !likelyInlineForm) {
      return undefined;
    }

    return {
      toolChoice: { type: "tool", toolName: "analysis_invoke" },
      activeTools: ["analysis_invoke"],
    };
  };
}
