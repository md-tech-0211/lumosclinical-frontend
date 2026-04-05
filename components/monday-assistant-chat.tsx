'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Send, Bot, User, AlertCircle, Wand2 } from 'lucide-react';
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

  /** Only scroll when the user sends a message — not on every assistant stream chunk (avoids jank / “shaking” near the input). */
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
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
      <div className="relative p-[1px] rounded-[1.75rem] bg-gradient-to-br from-primary/30 via-chart-3/15 to-accent/22 dark:from-primary/45 dark:via-chart-3/25 dark:to-accent/35 shadow-[0_20px_50px_-12px_rgb(15_23_42/0.06),0_0_0_1px_hsl(var(--border)/0.45)] dark:shadow-[0_28px_80px_-24px_rgba(0,0,0,0.55)]">
        <div className="relative flex flex-col overflow-hidden rounded-[calc(1.75rem-1px)] border border-border/80 bg-card shadow-sm backdrop-blur-xl dark:border-border/40 dark:bg-card/55 dark:shadow-none min-h-[70vh]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_50%_at_50%_-30%,hsl(var(--primary)/0.06),transparent_55%)] dark:bg-[radial-gradient(ellipse_90%_50%_at_50%_-30%,hsl(var(--primary)/0.08),transparent_55%)] pointer-events-none" />
          <div className="relative border-b border-border/60 bg-gradient-to-r from-muted/50 via-muted/20 to-transparent dark:border-border/50 dark:from-muted/30 dark:via-transparent dark:to-muted/20 px-4 sm:px-6 py-4">
            <div className="flex items-center gap-3">
              <Image
                src="/assets/logo/lo.jpeg"
                alt="Luna"
                width={112}
                height={40}
                className="rounded-[5px] object-contain opacity-95 drop-shadow-sm"
                style={{ width: 'auto', height: '2.25rem' }}
                priority
              />
              <span className="text-base font-semibold tracking-tight text-foreground">
                AI Assistant
              </span>
            </div>
          </div>

        <div className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5 [scrollbar-gutter:stable]">
        {messages.length === 0 ? (
          <div className="flex min-h-[min(52vh,520px)] items-center justify-center py-8">
            <div className="max-w-lg text-center">
              <LunaAiOrb />
              <h3 className="font-semibold text-xl tracking-tight bg-gradient-to-r from-foreground via-foreground to-primary/80 bg-clip-text text-transparent mb-2">
                Luna AI Assistant
              </h3>
              <p className="text-muted-foreground text-sm mb-8 max-w-sm mx-auto leading-relaxed">
                Your copilot for Monday.com — pick a starter or type your own question.
              </p>
              <div className="grid gap-3 text-left">
                {[
                  'Show me the entries from the Incoming Leads Tracker board with today’s referral date.',
                  'List the entries from the Depression Pre-Screening form along with their status.',
                  'What is the status of "X" person?',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card bg-gradient-to-br from-card to-muted/40 px-4 py-3.5 text-sm text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 dark:border-border/60 dark:from-card/80 dark:to-muted/20"
                  >
                    <span className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-gradient-to-b from-primary to-chart-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                        <Wand2 className="h-4 w-4" />
                      </span>
                      <span className="leading-snug text-foreground/90">{suggestion}</span>
                    </span>
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
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-chart-3/15 text-primary shadow-sm ring-1 ring-primary/20">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[min(100%,42rem)] rounded-2xl px-4 py-3.5 text-sm shadow-md',
                      isUser
                        ? 'bg-gradient-to-br from-primary via-primary to-primary/90 text-primary-foreground shadow-primary/25 ring-1 ring-white/10'
                        : 'border border-border/70 bg-card bg-gradient-to-b from-card to-muted/35 text-foreground ring-1 ring-border/40 backdrop-blur-sm dark:border-border/50 dark:from-card/90 dark:to-muted/15 dark:ring-border/30'
                    )}
                  >
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {message.toolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/40 px-2 py-1 text-[11px] font-mono text-muted-foreground dark:bg-muted/25"
                          >
                            {tc.status === 'done' ? (
                              <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                            ) : (
                              <Spinner size="sm" />
                            )}
                            <span>{tc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {message.content &&
                      (isUser ? (
                        <p className="whitespace-pre-wrap break-words leading-relaxed text-primary-foreground/95">
                          {message.content}
                        </p>
                      ) : (
                        <AssistantMarkdown content={message.content} />
                      ))}
                    {!message.content && isLoading && !isUser && (
                      <div className="flex items-center gap-2.5 text-muted-foreground">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                        </span>
                        <span className="text-sm">Thinking…</span>
                      </div>
                    )}
                  </div>
                  {isUser && (
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md ring-1 ring-primary/30">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })}

            {error && (
              <div className="flex gap-3 justify-start">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-destructive/15 text-destructive ring-1 ring-destructive/25">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div className="max-w-xl rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 shadow-sm backdrop-blur-sm">
                  <p className="text-sm leading-relaxed text-destructive">
                    {error}. Please try again.
                  </p>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
        </div>

        <div className="relative border-t border-border/60 bg-gradient-to-t from-muted/40 to-transparent dark:border-border/50 dark:from-muted/30 px-4 sm:px-6 py-4">
          <form onSubmit={handleSubmit} className="flex gap-2.5 items-end">
            <Input
              placeholder="Ask about boards, items, workflows…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              className="flex-1 h-12 rounded-2xl border-border/70 bg-background px-4 shadow-inner transition-shadow focus-visible:border-primary/40 focus-visible:ring-primary/20 dark:border-border/60 dark:bg-background/50"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              {isLoading ? (
                <Spinner size="sm" className="text-primary-foreground" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
          <p className="mt-2.5 text-center text-[11px] text-muted-foreground/90">
            Tip: name the board and a date range for sharper answers.
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}

