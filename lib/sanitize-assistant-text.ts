/** Shown when model/MCP echoes an HTML error page into the reply. */
export const HTML_LEAK_FALLBACK = `The assistant hit a **web error page** (often a 404) instead of Monday data. That usually means **\`MONDAY_MCP_URL\` is wrong** or the MCP server isn’t running on that path.

**Fix:** Point \`MONDAY_MCP_URL\` at your real MCP HTTP endpoint (correct host, port, and path — not the main Next.js page). Then try again.

You can still ask general questions; **live boards/items** need a working MCP connection.`;

export function looksLikeHtmlDocument(text: string): boolean {
  if (!text || text.length < 20) return false;
  const head = text.slice(0, 500).trimStart();
  if (/<!DOCTYPE\s+html/i.test(head)) return true;
  if (/<html[\s>]/i.test(head) && /<\/html>/i.test(text)) return true;
  if (head.startsWith("<") && /next-error-h1|__next_f|_next\/static\/chunks/i.test(text)) {
    return true;
  }
  return false;
}

/** Use for assistant bubbles and streamed text. Replaces HTML dumps with a short user-facing message. */
export function sanitizeAssistantDisplayText(raw: string): string {
  if (!raw) return raw;
  if (looksLikeHtmlDocument(raw)) {
    return HTML_LEAK_FALLBACK;
  }
  return raw;
}
