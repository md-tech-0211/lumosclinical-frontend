import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import {
  isMondayTokenConfigured,
  searchDefaultBoardsByName,
  validateSearchTerm,
} from "@/lib/monday-name-filter-search";

/**
 * Local Bedrock tools: server-side Monday name filter (fast). Merged with MCP tools in /api/ai/monday.
 */
export function buildLumosMondaySearchTools(): ToolSet {
  if (!isMondayTokenConfigured()) {
    return {};
  }

  return {
    lumos_search_person_by_item_name: tool({
      description: `**Avoid unless necessary.** Only two boards: user mentioned **lead/leads/lead tracker** → **Incoming Leads Tracker** only; else → **New general ps form** only. Prefer \`get_board_items_by_name\` on that board ID. Use this tool only if the user asks to search **both** boards or “anywhere.” It queries both — then **ignore** hits on the board routing excludes. Rejects generic terms. Returns item id + name + updated_at; use monday_get_item for columns.`,
      inputSchema: z.object({
        term: z
          .string()
          .describe(
            "Distinctive substring of the person's name as it would appear in the Monday **item name** (e.g. Shyam, Garcia) — not generic words."
          ),
        maxItemsPerBoard: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(15)
          .describe("Max matches to return per board (default 15)."),
      }),
      execute: async ({ term, maxItemsPerBoard }) => {
        const v = validateSearchTerm(term);
        if (!v.ok) {
          return {
            found: false,
            error: v.error,
            boards: [],
          };
        }
        try {
          const boards = await searchDefaultBoardsByName(
            v.term,
            maxItemsPerBoard ?? 15
          );
          const found = boards.some((b) => b.matchCount > 0);
          return {
            found,
            term: v.term,
            boards: boards.map((b) => ({
              boardLabel: b.boardLabel,
              matchCount: b.matchCount,
              items: b.items.map((i) => ({
                id: i.id,
                name: i.name,
                updated_at: i.updated_at ?? null,
              })),
            })),
            hint: found
              ? "Use monday_get_item with an item id if you need column values. Do not expose raw ids to the user."
              : "No item on either default board has this text in the Monday item name. Say clearly that no matching form/person was found by name.",
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            found: false,
            error: `Monday search failed: ${msg}`,
            boards: [],
          };
        }
      },
    }),
  };
}
