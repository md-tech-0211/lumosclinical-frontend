# Project Understanding Notes

## What This Project Does

This is an AI chatbot that helps users ask questions about their Monday.com data (boards, items, updates, workflows). The chatbot can also search the internet when needed.

---

## How It Works (Simple Explanation)

### 1. **User Types a Question**
- User types a question in the chat interface (e.g. "Show me the latest items on my Projects board")
- The question is sent to our Next.js API route (`/api/ai/monday`)

### 2. **OpenAI Gets the Question**
- Our code sends the question to OpenAI's AI model (`gpt-5-mini`)
- The AI model runs on OpenAI's servers

### 3. **Internet Access (Web Search)**
- OpenAI can search the internet using the `web_search` tool
- When the user asks something outside Monday data, the AI uses web search to find answers

### 4. **Monday.com Access (MCP Server)**
- A separate backend (Monday MCP server) connects to Monday.com and provides tools such as:
  - `monday_list_boards` – list boards
  - `monday_list_items_in_board` – list items in a board
  - `monday_get_item`, `monday_create_item`, `monday_change_column_value`, etc.
- Our frontend connects to this MCP server over HTTP
- The MCP server talks to the Monday.com API to get real data

### 5. **AI Decides What to Do**
- The AI has access to web search and Monday MCP tools
- It chooses which tool to use based on the question
- It can use multiple tools in one conversation (up to several steps)

### 6. **AI Gives the Answer**
- After using tools, the AI replies in plain language
- The answer streams back to the user in real time

---

## Technical Flow

```
User Question
    ↓
Frontend (React) → /api/ai/monday route
    ↓
OpenAI GPT-5-mini Model
    ↓
Has Access To:
    ├─ Web Search Tool (for internet)
    └─ Monday MCP Tools (via MCP Server)
         ↓
    MCP Server (Vercel) → Monday.com API
    ↓
AI Uses Tools → Gets Data → Writes Answer
    ↓
Answer Streams Back to User
```

---

## Key Files

- **`app/api/ai/monday/route.ts`** – API route that connects to OpenAI and the Monday MCP
- **`components/monday-assistant-chat.tsx`** – Chat UI the user sees
- **MCP Server** (separate project) – Backend that connects to Monday.com

---

## Important Points

1. **OpenAI doesn't browse the internet directly** – It uses the web_search tool when needed.
2. **Monday data comes through the MCP Server** – A separate backend handles Monday API calls.
3. **AI decides automatically** – It chooses which tool to use based on the question.
4. **Everything streams** – Answers appear in real time, not all at once.
