/**
 * Direct Monday.com GraphQL using items_page query_params (server-side name filter).
 * Avoids MCP get_board_items_by_name full-board pagination when MONDAY_TOKEN is set on this app.
 */

const DEFAULT_MONDAY_API_URL = "https://api.monday.com/v2";

/** Same default boards as the Monday assistant system prompt (internal IDs only). */
export const LUMOS_DEFAULT_BOARDS: readonly { label: string; id: number }[] = [
  { label: "Incoming Leads Tracker", id: 9654922517 },
  { label: "New general ps form", id: 18383803050 },
];

const GENERIC_TERMS = new Set([
  "form",
  "forms",
  "lead",
  "leads",
  "tracker",
  "track",
  "new",
  "general",
  "ps",
  "incoming",
  "monday",
  "board",
  "item",
  "items",
  "name",
  "email",
  "mail",
  "phone",
  "status",
  "date",
  "candidate",
  "candidates",
  "prescreen",
  "prescreening",
]);

function getToken(): string | undefined {
  const t = process.env.MONDAY_TOKEN ?? process.env.MONDAY_API_TOKEN;
  return t?.trim() || undefined;
}

export function isMondayTokenConfigured(): boolean {
  return Boolean(getToken());
}

export function validateSearchTerm(
  raw: string
): { ok: true; term: string } | { ok: false; error: string } {
  const term = raw.trim();
  if (term.length < 2) {
    return { ok: false, error: "Search term must be at least 2 characters." };
  }
  if (term.length > 80) {
    return {
      ok: false,
      error: "Search term is too long (max 80 characters).",
    };
  }
  const lower = term.toLowerCase();
  if (GENERIC_TERMS.has(lower)) {
    return {
      ok: false,
      error: `The term "${term}" is too generic. Use a person's name or a distinctive substring — not words like "form", "lead", or "tracker".`,
    };
  }
  if (!/^[\p{L}\p{N}\s@._'-]+$/u.test(term)) {
    return {
      ok: false,
      error: "Search term contains unsupported characters.",
    };
  }
  return { ok: true, term };
}

function escapeGraphQlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function mondayRequest<T>(query: string): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error("Monday token not configured.");
  }
  const url =
    process.env.MONDAY_API_URL?.trim() || DEFAULT_MONDAY_API_URL;
  const controller = new AbortController();
  const timeoutMs = Math.min(
    Math.max(Number(process.env.MONDAY_SEARCH_TIMEOUT_MS) || 45_000, 5_000),
    120_000
  );
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (!res.ok || json.errors) {
      throw new Error(
        `Monday API error ${res.status}: ${JSON.stringify(
          json.errors ?? json
        )}`
      );
    }
    return json.data as T;
  } finally {
    clearTimeout(to);
  }
}

type ItemRow = {
  id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * One round-trip: Monday filters by item name contains_text (no client-side scan).
 */
export async function searchItemsByNameContains(
  boardId: number,
  term: string,
  limit: number
): Promise<{
  boardId: number;
  boardName: string;
  items: ItemRow[];
}> {
  const esc = escapeGraphQlString(term);
  const lim = Math.min(Math.max(limit, 1), 100);
  const query = `
    query {
      boards(ids: [${boardId}]) {
        id
        name
        items_page(
          limit: ${lim}
          query_params: {
            rules: [
              {
                column_id: "name"
                compare_value: ["${esc}"]
                operator: contains_text
              }
            ]
          }
        ) {
          cursor
          items {
            id
            name
            created_at
            updated_at
          }
        }
      }
    }
  `;

  const data = await mondayRequest<{
    boards: Array<{
      id: string;
      name: string;
      items_page: { cursor: string | null; items: ItemRow[] };
    }>;
  }>(query);

  const board = data.boards?.[0];
  if (!board) {
    return { boardId, boardName: "", items: [] };
  }
  return {
    boardId,
    boardName: board.name ?? "",
    items: board.items_page?.items ?? [],
  };
}

export async function searchDefaultBoardsByName(
  term: string,
  maxItemsPerBoard: number
): Promise<
  Array<{
    boardLabel: string;
    boardId: number;
    boardNameFromApi: string;
    matchCount: number;
    items: ItemRow[];
  }>
> {
  const results = await Promise.all(
    LUMOS_DEFAULT_BOARDS.map(async (b) => {
      const r = await searchItemsByNameContains(b.id, term, maxItemsPerBoard);
      return {
        boardLabel: b.label,
        boardId: b.id,
        boardNameFromApi: r.boardName,
        matchCount: r.items.length,
        items: r.items,
      };
    })
  );
  return results;
}
