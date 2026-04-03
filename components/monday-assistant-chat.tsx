'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Send, Bot, User, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssistantMarkdown } from '@/components/assistant-markdown';
import { LunaAiOrb } from '@/components/luna-ai-orb';
import {
  type ChatMessage,
  getSession,
  upsertSession,
  sessionTitleFromMessages,
} from '@/lib/chat-sessions';
import {
  looksLikeHtmlDocument,
  sanitizeAssistantDisplayText,
} from '@/lib/sanitize-assistant-text';

const REQUEST_TIMEOUT_MS = 120_000;

const EMPTY_REPLY_FALLBACK =
  "I couldn’t get a reply from the AI (the response was empty). Please try again in a moment.";

function friendlyErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message;
    if (looksLikeHtmlDocument(m)) {
      return "Something returned a web error page instead of a normal reply. Check MONDAY_MCP_URL and that your Monday MCP server is running.";
    }
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) {
      return "Couldn’t reach the server. Check that the app is running and your connection.";
    }
    if (/abort/i.test(m)) {
      return "The request was cancelled.";
    }
    if (m.includes("No response body")) {
      return "The server didn’t return any data. Please try again.";
    }
    return m.length > 800 ? `${m.slice(0, 800)}…` : m;
  }
  return "Something went wrong. Please try again.";
}

export type MondayAssistantChatProps = {
  /** When set, load messages for this session (e.g. `/chats/[id]`). Omit for a new chat on `/`. */
  initialSessionId?: string;
};

export function MondayAssistantChat({ initialSessionId }: MondayAssistantChatProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!initialSessionId) return;
    const stored = getSession(initialSessionId);
    if (stored) {
      setMessages(stored.messages);
      setSessionId(stored.id);
    } else {
      setMessages([]);
      setSessionId(initialSessionId);
    }
    setError(null);
  }, [initialSessionId]);

  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    upsertSession({
      id: sessionId,
      title: sessionTitleFromMessages(messages),
      updatedAt: Date.now(),
      messages,
    });
  }, [sessionId, messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const activeSessionId = sessionId ?? crypto.randomUUID();
    if (!sessionId) {
      setSessionId(activeSessionId);
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    console.log('[monday] Chat sending messages to /api/ai/monday', {
      count: apiMessages.length,
      lastMessage: apiMessages[apiMessages.length - 1],
    });

    let streamAssistantId: string | null = null;
    let abortedByTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      abortRef.current = new AbortController();
      timeoutId = setTimeout(() => {
        abortedByTimeout = true;
        abortRef.current?.abort();
      }, REQUEST_TIMEOUT_MS);

      const response = await fetch('/api/ai/monday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortRef.current.signal,
      });

      console.log('[monday] Chat API response status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let errorMessage = `Server error (${response.status}).`;
        try {
          const parsed = JSON.parse(errorBody) as {
            error?: string;
            details?: string;
          };
          if (parsed.error) {
            errorMessage = parsed.details
              ? `${parsed.error} ${parsed.details}`
              : parsed.error;
          }
        } catch {
          if (errorBody.trim()) {
            errorMessage = /<!DOCTYPE|<html[\s>]/i.test(errorBody)
              ? "The server returned a web page instead of an API response. Check that /api/ai/monday is correct and the app is running."
              : errorBody.slice(0, 500);
          }
        }
        console.warn("[monday] Chat API error:", response.status, errorBody || "(empty body)");
        throw new Error(errorMessage);
      }

      const body = response.body;
      if (!body) throw new Error('No response body');

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let toolCalls: Array<{ name: string; status: 'pending' | 'done' }> = [];
      let buffer = '';

      const assistantId = `assistant-${Date.now()}`;
      streamAssistantId = assistantId;

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', toolCalls: [] },
      ]);

      const updateMessage = (content: string, tools: typeof toolCalls) => {
        const safe = sanitizeAssistantDisplayText(content);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: safe, toolCalls: [...tools] }
              : m
          )
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;

          try {
            const data = JSON.parse(payload) as { type?: string; delta?: string; toolName?: string };
            switch (data.type) {
              case 'text-delta':
                if (typeof data.delta === 'string') {
                  fullContent += data.delta;
                  updateMessage(fullContent, toolCalls);
                }
                break;
              case 'tool-input-start':
                if (data.toolName) {
                  toolCalls = [...toolCalls, { name: data.toolName, status: 'pending' }];
                  updateMessage(fullContent, toolCalls);
                }
                break;
              case 'tool-output-available':
                const lastPending = toolCalls.findIndex((t) => t.status === 'pending');
                if (lastPending >= 0) {
                  toolCalls = toolCalls.map((t, i) =>
                    i === lastPending ? { ...t, status: 'done' as const } : t
                  );
                  updateMessage(fullContent, toolCalls);
                }
                break;
              default:
                break;
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      if (buffer.trim().startsWith('data:')) {
        const payload = buffer.trim().slice(5).trim();
        if (payload !== '[DONE]') {
          try {
            const data = JSON.parse(payload) as { type?: string; delta?: string; toolName?: string };
            if (data.type === 'text-delta' && typeof data.delta === 'string') {
              fullContent += data.delta;
            }
          } catch {
            // ignore
          }
        }
      }

      toolCalls = toolCalls.map((t) => ({ ...t, status: 'done' as const }));

      const hasText = fullContent.trim().length > 0;
      const hasTools = toolCalls.length > 0;
      const rawFinal = hasText || hasTools ? fullContent : EMPTY_REPLY_FALLBACK;
      const finalText = sanitizeAssistantDisplayText(rawFinal);

      updateMessage(finalText, toolCalls);
    } catch (err: any) {
      console.error('[monday] Chat error:', err);

      if (err?.name === "AbortError") {
        const timeoutMsg =
          "The request timed out waiting for the AI. Please try again.";
        if (abortedByTimeout) {
          if (streamAssistantId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamAssistantId
                  ? {
                      ...m,
                      content: timeoutMsg,
                      toolCalls: [],
                    }
                  : m
              )
            );
          } else {
            setError(timeoutMsg);
          }
        }
        return;
      }

      const msg = friendlyErrorMessage(err);
      if (streamAssistantId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamAssistantId
              ? {
                  ...m,
                  content: `Sorry — I couldn’t complete that reply.\n\n${msg}`,
                  toolCalls: m.toolCalls?.map((t) => ({
                    ...t,
                    status: "done" as const,
                  })),
                }
              : m
          )
        );
      } else {
        setError(msg);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [isLoading, messages, sessionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    sendMessage(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="rounded-2xl border bg-card/80 backdrop-blur shadow-sm overflow-hidden flex flex-col min-h-[70vh]">
        <div className="border-b bg-background/40 px-4 sm:px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start justify-between gap-4 sm:justify-start sm:flex-1">
              <div className="flex items-center gap-3 min-w-0">
                <div className="bg-primary/10 text-primary rounded-xl p-2 shrink-0">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold leading-tight">Monday AI Assistant</h2>
                    <span className="text-[11px] rounded-full border px-2 py-0.5 text-muted-foreground">
                      Bedrock
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Ask about boards, items, updates, and workflows.
                  </p>
                </div>
              </div>
              <Image
                src="/assets/logo/logo.jpg"
                alt="Luna"
                width={112}
                height={40}
                className="h-9 w-auto object-contain opacity-90 sm:hidden"
              />
            </div>
            <Image
              src="/assets/logo/logo.jpg"
              alt="Luna"
              width={112}
              height={40}
              className="hidden sm:block h-9 w-auto object-contain opacity-90 sm:ml-auto"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div className="max-w-md">
              <LunaAiOrb />
              <h3 className="font-semibold text-lg mb-2">Luna AI Assistant</h3>
              <p className="text-muted-foreground text-sm mb-6">
                I can help you explore and summarize your data. Try asking:
              </p>
              <div className="grid gap-2">
                {[
                  'Show me the entries from the Incoming Leads Tracker board with today’s referral date.',
                  'List the entries from the Depression Pre-Screening form along with their status.',
                  'What is the status of "X" person?',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="text-left px-4 py-2.5 rounded-xl border bg-background/50 text-sm hover:bg-accent transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              const isUser = message.role === 'user';

              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3',
                    isUser ? 'justify-end' : 'justify-start'
                  )}
                >
                  {!isUser && (
                    <div className="bg-primary/10 text-primary rounded-full p-1.5 h-8 w-8 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-border/60">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-2xl rounded-2xl px-4 py-3 shadow-sm ring-1 ring-border/60',
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background/60'
                    )}
                  >
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {message.toolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            {tc.status === 'done' ? (
                              <span className="text-green-600">{'>'}</span>
                            ) : (
                              <Spinner size="sm" />
                            )}
                            <span className="font-mono">{tc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {message.content &&
                      (isUser ? (
                        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                          {message.content}
                        </p>
                      ) : (
                        <AssistantMarkdown content={message.content} />
                      ))}
                    {!message.content && isLoading && !isUser && (
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" />
                        <span className="text-sm text-muted-foreground">Thinking...</span>
                      </div>
                    )}
                  </div>
                  {isUser && (
                    <div className="bg-primary text-primary-foreground rounded-full p-1.5 h-8 w-8 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-border/60">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })}

            {error && (
              <div className="flex gap-3 justify-start">
                <div className="bg-destructive/10 text-destructive rounded-full p-1.5 h-8 w-8 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                  <p className="text-sm text-destructive">
                    {error}. Please try again.
                  </p>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
        </div>

        <div className="border-t bg-background/40 px-4 sm:px-6 py-4">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <Input
              placeholder="Ask about your boards, items, workflows..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              className="flex-1 h-11 rounded-xl bg-background"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              className="h-11 w-11 rounded-xl"
            >
              {isLoading ? (
                <Spinner size="sm" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
          <div className="mt-2 text-xs text-muted-foreground">
            Tip: include a board name and a date range for best results.
          </div>
        </div>
      </div>
    </div>
  );
}

