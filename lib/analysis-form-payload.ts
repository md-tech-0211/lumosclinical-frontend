/**
 * Contract for POST `body` to the analysis service (`analysis_invoke`).
 * The backend expects **one JSON object** with these keys (use `""`, `0`, or enum literals when unknown).
 */
export const ANALYSIS_FORM_PAYLOAD_KEYS = [
  "subject_name",
  "pre_screen_status",
  "date_of_call",
  "phone_number",
  "email",
  "dob",
  "age",
  "gender",
  "height_in",
  "weight_lbs",
  "bmi",
  "is_adult",
  "willing_to_travel",
  "contraception_agreement",
  "current_medications",
  "can_stop_medication",
  "alcohol_use",
  "drug_use",
  "smoking",
  "previous_trials",
  "ai_analysis_link",
  "transcript",
  "last_updated",
  "item_id",
] as const;

/** One-line example for prompts (valid JSON). */
export const ANALYSIS_FORM_BODY_EXAMPLE = `{"subject_name":"Jane Doe","pre_screen_status":"Pending","date_of_call":"","phone_number":"","email":"","dob":"1990-01-01","age":35,"gender":"Female","height_in":0,"weight_lbs":0,"bmi":0,"is_adult":"Yes","willing_to_travel":"No","contraception_agreement":"","current_medications":"","can_stop_medication":"","alcohol_use":"","drug_use":"","smoking":"","previous_trials":"","ai_analysis_link":"","transcript":"","last_updated":"","item_id":""}`;

/** Short instruction block for prompts and tool descriptions. */
export const ANALYSIS_FORM_BODY_RULES = `POST \`body\` must be a **plain JSON object** (not a string, not markdown). Include **every** key below; map Monday column labels into these names; use empty string \`""\` or \`0\` when unknown. Do **not** wrap the object in \`\`\` fences. Example shape (same keys, your values): ${ANALYSIS_FORM_BODY_EXAMPLE}
- \`subject_name\` (string)
- \`pre_screen_status\`: exactly \`"Eligible"\`, \`"Ineligible"\`, or \`"Pending"\`
- \`date_of_call\`, \`dob\`, \`last_updated\`: \`"YYYY-MM-DD"\` or \`""\`
- \`phone_number\`, \`email\`, \`current_medications\`, \`ai_analysis_link\`, \`transcript\`, \`item_id\`: strings
- \`age\`, \`height_in\`, \`weight_lbs\`, \`bmi\`: numbers (use \`0\` if missing)
- \`gender\`: \`"Male"\` | \`"Female"\` | \`"Other"\`
- \`is_adult\`, \`willing_to_travel\`, \`contraception_agreement\`, \`can_stop_medication\`, \`alcohol_use\`, \`drug_use\`, \`smoking\`, \`previous_trials\`: \`"Yes"\` or \`"No"\` (or \`""\` if truly unknown)`;

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
