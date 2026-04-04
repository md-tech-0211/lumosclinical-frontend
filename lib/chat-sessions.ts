export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; status: 'pending' | 'done' }>
}

export interface ChatSession {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

const STORAGE_KEY = 'luna-monday-chat-sessions'

function readAll(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatSession[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function listSessions(): ChatSession[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): ChatSession | null {
  return readAll().find((s) => s.id === id) ?? null
}

export function upsertSession(session: ChatSession): void {
  const rest = readAll().filter((s) => s.id !== session.id)
  writeAll([session, ...rest])
}

export function deleteSession(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id))
}

export function sessionTitleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  const text = firstUser?.content?.trim() ?? 'New chat'
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}
