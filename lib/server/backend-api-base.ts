/**
 * Base URL for the external REST API (leads, deals, settings).
 *
 * Resolution order:
 * 1. `BACKEND_API_BASE` if set (explicit override — no trailing slash).
 * 2. Else derive from `MONDAY_MCP_URL`: same origin, path `/api/v1` (one backend host).
 * 3. Else built-in default (legacy).
 */
const DEFAULT_BACKEND_API_BASE = 'http://54.91.147.151:8000/api/v1';

function deriveBackendFromMondayMcpUrl(mcpUrl: string): string | null {
  try {
    const u = new URL(mcpUrl);
    u.pathname = '/api/v1';
    u.search = '';
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getBackendApiBase(): string {
  const explicit = process.env.BACKEND_API_BASE?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const mcp = process.env.MONDAY_MCP_URL?.trim();
  if (mcp) {
    const derived = deriveBackendFromMondayMcpUrl(mcp);
    if (derived) {
      return derived;
    }
  }

  return DEFAULT_BACKEND_API_BASE;
}
