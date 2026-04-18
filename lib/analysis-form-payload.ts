/**
 * Contract for POST `body` to the analysis service (`analysis_invoke`).
 * - **One row:** a plain JSON object (column ids or titles → cell values).
 * - **Several candidates:** `{ "candidates": [ { ... }, { ... } ] }` — each element is one row in the same shape.
 * No fixed column schema; serialize whatever the table has.
 */

/** One row; keys mirror the board/table columns. */
export const ANALYSIS_FORM_BODY_SINGLE_EXAMPLE = `{"subject_name":"Jane Doe","pre_screen_status":"Pending","item_id":"12345"}`;

/** Multiple rows in one request. */
export const ANALYSIS_FORM_BODY_MULTI_EXAMPLE = `{"candidates":[{"subject_name":"Jane Doe","item_id":"1"},{"subject_name":"John Smith","item_id":"2"}]}`;

/** Back-compat: short line used in prompts (single + multi). */
export const ANALYSIS_FORM_BODY_EXAMPLE = `${ANALYSIS_FORM_BODY_SINGLE_EXAMPLE} · Multi: ${ANALYSIS_FORM_BODY_MULTI_EXAMPLE}`;

/** Short instruction block for prompts and tool descriptions. */
export const ANALYSIS_FORM_BODY_RULES = `POST \`body\` must be **plain JSON** (not a string, not markdown). **One candidate:** a single object — **keys** = column identifiers from the Monday board / table (or normalized titles), **values** = cell values (strings, numbers, booleans as appropriate). **Multiple candidates:** send \`{"candidates":[{...},{...}]}\` — each array element is one full row object (same key shape). Include every field you have per row; use empty string \`""\` or \`0\` when unknown. Do **not** wrap in \`\`\` fences. Examples — one row: ${ANALYSIS_FORM_BODY_SINGLE_EXAMPLE}. Several rows: ${ANALYSIS_FORM_BODY_MULTI_EXAMPLE}`;

/**
 * Strips ```json fences, parses string bodies, and returns a value safe to JSON.stringify once.
 * If a string is not JSON, wraps as `{ formText: string }` for backward compatibility.
 */
export function normalizeAnalysisInvokeBody(raw: unknown): unknown {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw === "string") {
    let s = raw.trim();
    if (s.startsWith("```")) {
      s = s
        .replace(/^```(?:json)?\s*\r?\n?/i, "")
        .replace(/\r?\n?```\s*$/i, "")
        .trim();
    }
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return { formText: s };
    }
  }
  return raw;
}
