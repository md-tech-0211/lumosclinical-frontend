# Project Understanding Notes

## What This Project Does

This is an AI chatbot that helps users ask questions about their Zoho CRM data (leads, deals, contacts, meetings). The chatbot can also search the internet when needed.

---

## How It Works (Simple Explanation)

### 1. **User Types a Question**
- User types a question in the chat interface (like "How many leads do we have?")
- The question is sent to our Next.js API route (`/api/ai/chat`)

### 2. **OpenAI Gets the Question**
- Our code sends the question to OpenAI's AI model (`gpt-5-mini`)
- The AI model runs on OpenAI's servers (not on our computer)

### 3. **Internet Access (Web Search)**
- OpenAI can search the internet using a special tool called `web_search`
Example setup -   
const tools = {
    ...(typeof mcpTools === "object" && mcpTools !== null ? mcpTools : {}),
    web_search: openai.tools.webSearch({
      searchContextSize: "medium",
    }),
  };
- When the user asks something not in CRM data (like "What is CRM?"), the AI uses web search to find answers
- The web search happens automatically - OpenAI does it for us

### 4. **Zoho CRM Access (MCP Server)**
- We have a separate backend server called "MCP Server" (hosted on Vercel)
- This server connects to Zoho CRM and provides tools like:
  - `zoho_crm_list_records` - Get a list of leads/deals
  - `zoho_crm_get_record` - Get details of one lead/deal
  - `zoho_crm_search_records` - Search for specific records
  - `zoho_crm_upsert_record` - Create or update records
- Our frontend connects to this MCP server using HTTP (like visiting a website)
- The MCP server talks to Zoho CRM API to get real data

### 5. **AI Decides What to Do**
- The AI model receives both tools: web search AND Zoho CRM tools
- The AI decides which tool to use based on the question:
  - CRM questions → Uses Zoho tools
  - General knowledge → Uses web search
- The AI can use multiple tools in one conversation (up to 15 steps)

### 6. **AI Gives the Answer**
- After using tools, the AI writes a clear answer in plain English
- The answer streams back to the user (appears word by word)
- User sees the final answer in the chat

---

## Technical Flow

```
User Question
    ↓
Frontend (React) → /api/ai/chat route
    ↓
OpenAI GPT-5-mini Model
    ↓
Has Access To:
    ├─ Web Search Tool (for internet)
    └─ Zoho MCP Tools (via MCP Server)
         ↓
    MCP Server (Vercel) → Zoho CRM API
    ↓
AI Uses Tools → Gets Data → Writes Answer
    ↓
Answer Streams Back to User
```

---

## Key Files

- **`app/api/ai/chat/route.ts`** - Main API route that connects everything
- **`components/assistant-chat.tsx`** - The chat UI the user sees
- **MCP Server** (separate project) - Backend that connects to Zoho CRM

---

## Important Points

1. **OpenAI doesn't browse the internet directly** - It uses the web_search tool when needed
2. **Zoho data comes through MCP Server** - A separate backend handles all Zoho API calls
3. **AI decides automatically** - It chooses which tool to use based on the question
4. **Everything streams** - Answers appear in real-time, not all at once
