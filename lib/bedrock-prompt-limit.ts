/** Target max input tokens (Bedrock reports ~200k; stay under with margin). */
export const BEDROCK_PROMPT_FIT_TARGET_TOKENS = 198_000;

export function isPromptTooLongError(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return /prompt is too long/i.test(s);
}

/** Parses "prompt is too long: 202123 tokens" from Bedrock / SDK errors. */
export function parseReportedPromptTokens(err: unknown): number | null {
  const s = err instanceof Error ? err.message : String(err);
  const m = s.match(/prompt is too long:\s*(\d+)\s*tokens/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}
