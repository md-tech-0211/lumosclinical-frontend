'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Send,
  Bot,
  User,
  AlertCircle,
  Wand2,
  Square,
  Plus,
  FileText,
  X,
} from 'lucide-react';
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
  ATTACHMENT_TYPE_ERROR_HINT,
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_FILE_BYTES_CLIENT,
  resolveChatAttachmentMime,
} from '@/lib/chat-attachments';
import {
  looksLikeHtmlDocument,
  sanitizeAssistantDisplayText,
} from '@/lib/sanitize-assistant-text';

// Bedrock/MCP can be slow to produce the first streamed chunk. Keep this comfortably above
// typical tool+model latency to avoid aborting requests that are still progressing server-side.
const REQUEST_TIMEOUT_MS = 300_000;

const EMPTY_REPLY_FALLBACK =
  "I couldn’t get a reply from the AI (the response was empty). Please try again in a moment.";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== 'string') {
        reject(new Error('Could not read file'));
        return;
      }
      const comma = r.indexOf(',');
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

type AttachmentPick = { id: string; file: File };

function ChatComposer({
  isLoading,
  input,
  onInputChange,
  onSubmit,
  onStop,
  attachmentItems,
  onAttachmentInputChange,
  onRemoveAttachment,
}: {
  isLoading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  attachmentItems: AttachmentPick[];
  onAttachmentInputChange: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const canSend = input.trim().length > 0 || attachmentItems.length > 0;

  return (
    <div className="space-y-2">
      {attachmentItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachmentItems.map((p) => (
            <span
              key={p.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-foreground/90 dark:border-border/50 dark:bg-muted/20"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-[220px] truncate">{p.file.name}</span>
              <button
                type="button"
                className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
                onClick={() => onRemoveAttachment(p.id)}
                aria-label={`Remove ${p.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex items-end">
        <input
          id="chat-attachment-input"
          type="file"
          accept={CHAT_ATTACHMENT_ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            onAttachmentInputChange(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="relative flex-1">
          {/* Buttons must sit above the full-width input in the stacking order, or the input steals clicks */}
          <label
            htmlFor="chat-attachment-input"
            aria-label="Attach file"
            className={cn(
              "absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-slate-600 hover:bg-primary/12 hover:text-slate-900 dark:text-muted-foreground dark:hover:bg-muted/70 dark:hover:text-foreground",
              isLoading && "pointer-events-none opacity-40"
            )}
          >
            <Plus className="h-5 w-5" />
          </label>

          {isLoading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onStop}
              className="absolute right-2 top-1/2 z-10 h-9 w-9 -translate-y-1/2 rounded-xl text-slate-600 hover:bg-muted/70 hover:text-slate-900 dark:text-muted-foreground dark:hover:bg-muted/70 dark:hover:text-foreground"
              aria-label="Stop generating"
            >
              <Square className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={!canSend}
              className="absolute right-2 top-1/2 z-10 h-9 w-9 -translate-y-1/2 rounded-xl text-slate-600 hover:bg-primary/12 hover:text-slate-900 disabled:opacity-40 dark:text-muted-foreground dark:hover:bg-muted/70 dark:hover:text-foreground"
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </Button>
          )}

          <Input
            placeholder="Ask about boards, items, workflows…"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            disabled={isLoading}
            className="h-12 w-full rounded-2xl border-sky-200/50 bg-white/90 pl-14 pr-14 text-slate-900 shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.04)] backdrop-blur-sm transition-shadow placeholder:text-slate-500 focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-border/60 dark:bg-background/50 dark:text-foreground dark:placeholder:text-muted-foreground"
            suppressHydrationWarning
          />
        </div>
      </form>
    </div>
  );
}

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
  const router = useRouter();
  const pathname = usePathname();
  const [input, setInput] = useState('');
  const [attachmentItems, setAttachmentItems] = useState<AttachmentPick[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const abortRef = useRef<AbortController | null>(null);

  messagesRef.current = messages;

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

  // If the currently-open session is deleted (sidebar / other tab), reset to a new chat.
  useEffect(() => {
    if (!sessionId) return;

    const handleMaybeDeleted = () => {
      const stillExists = Boolean(getSession(sessionId));
      if (stillExists) return;

      setMessages([]);
      setAttachmentItems([]);
      setInput('');
      setError(null);
      setSessionId(null);

      if ((pathname ?? '').startsWith(`/chats/${sessionId}`)) {
        router.push(`/?new=${Date.now()}`);
      }
    };

    window.addEventListener('luna-chat-sessions-changed', handleMaybeDeleted);
    window.addEventListener('storage', handleMaybeDeleted);
    return () => {
      window.removeEventListener('luna-chat-sessions-changed', handleMaybeDeleted);
      window.removeEventListener('storage', handleMaybeDeleted);
    };
  }, [pathname, router, sessionId]);

  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    upsertSession({
      id: sessionId,
      title: sessionTitleFromMessages(messages),
      updatedAt: Date.now(),
      messages,
    });
  }, [sessionId, messages]);

  const addAttachmentFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    let err: string | null = null;
    setAttachmentItems((prev) => {
      const next = [...prev];
      for (const f of Array.from(files)) {
        const mime = resolveChatAttachmentMime(f.name, f.type);
        if (!mime) {
          err = ATTACHMENT_TYPE_ERROR_HINT;
          continue;
        }
        if (f.size > MAX_CHAT_FILE_BYTES_CLIENT) {
          err = `"${f.name}" is too large (max ${Math.floor(MAX_CHAT_FILE_BYTES_CLIENT / (1024 * 1024))}MB).`;
          continue;
        }
        if (next.length >= MAX_CHAT_ATTACHMENTS) {
          err = `You can attach up to ${MAX_CHAT_ATTACHMENTS} files.`;
          break;
        }
        next.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f });
      }
      return next;
    });
    if (err) setError(err);
  }, []);

  const sendMessage = useCallback(async (text: string, attached: File[] = []) => {
    const trimmed = text.trim();
    if ((!trimmed && attached.length === 0) || isLoading) return;

    const displayText = trimmed || (attached.length ? 'Use the attached file(s).' : '');

    const activeSessionId = sessionId ?? crypto.randomUUID();
    if (!sessionId) {
      setSessionId(activeSessionId);
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: displayText,
      attachments:
        attached.length > 0 ? attached.map((f) => ({ name: f.name })) : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    const apiMessages = [...messagesRef.current, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let attachmentsPayload:
      | Array<{ name: string; mimeType: string; data: string }>
      | undefined;
    if (attached.length > 0) {
      attachmentsPayload = await Promise.all(
        attached.map(async (file) => {
          const mime =
            resolveChatAttachmentMime(file.name, file.type) ?? file.type.trim();
          return {
            name: file.name,
            mimeType: mime || 'application/octet-stream',
            data: await fileToBase64(file),
          };
        })
      );
    }

    console.log('[monday] Chat sending messages to /api/ai/monday', {
      count: apiMessages.length,
      lastMessage: apiMessages[apiMessages.length - 1],
    });

    let streamAssistantId: string | null = null;
    let abortedByTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    /** Stream UI batching (must be cleared in catch if the reader throws). */
    let streamRafId: number | null = null;
    let streamPendingAssistant: {
      content: string;
      tools: Array<{ name: string; status: 'pending' | 'done' }>;
    } | null = null;

    try {
      abortRef.current = new AbortController();
      timeoutId = setTimeout(() => {
        abortedByTimeout = true;
        abortRef.current?.abort();
      }, REQUEST_TIMEOUT_MS);

      const response = await fetch('/api/ai/monday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          ...(attachmentsPayload?.length ? { attachments: attachmentsPayload } : {}),
        }),
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
            const isHtml = /<!DOCTYPE|<html[\s>]/i.test(errorBody);
            if (response.status === 404 && isHtml) {
              const origin =
                typeof window !== 'undefined' ? window.location.origin : '';
              errorMessage =
                `Chat API not found (404). The server returned an HTML page instead of JSON.${origin ? ` This page is ${origin}.` : ''} If "next dev" printed a different port (e.g. 3001 because 3000 is in use), open the app at that Local URL — a tab on another port talks to a different process and /api/ai/monday will 404. Or free port 3000 and restart the dev server.`;
            } else if (isHtml) {
              errorMessage =
                'The server returned a web page instead of an API response. Check that /api/ai/monday exists and the app is running.';
            } else {
              errorMessage = errorBody.slice(0, 500);
            }
          }
        }
        console.warn("[monday] Chat API error:", response.status, errorBody || "(empty body)");
        // Surface as UI state — do not throw (avoids dev overlay / stack noise for expected 4xx/5xx).
        setError(errorMessage);
        return;
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

      /** Batch UI updates: hundreds of SSE lines per chunk can sync-call setMessages and exceed React update depth. */
      const flushAssistantMessage = () => {
        if (!streamPendingAssistant) return;
        const { content, tools } = streamPendingAssistant;
        streamPendingAssistant = null;
        const safe = sanitizeAssistantDisplayText(content);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: safe, toolCalls: [...tools] }
              : m
          )
        );
      };

      const scheduleAssistantFlush = () => {
        if (streamRafId != null) return;
        streamRafId = requestAnimationFrame(() => {
          streamRafId = null;
          flushAssistantMessage();
        });
      };

      const updateMessage = (content: string, tools: typeof toolCalls) => {
        streamPendingAssistant = { content, tools };
        scheduleAssistantFlush();
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

      if (streamRafId != null) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }
      streamPendingAssistant = null;

      const hasText = fullContent.trim().length > 0;
      const hasTools = toolCalls.length > 0;
      const rawFinal = hasText || hasTools ? fullContent : EMPTY_REPLY_FALLBACK;
      const finalText = sanitizeAssistantDisplayText(rawFinal);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalText,
                toolCalls: [...toolCalls],
              }
            : m
        )
      );
    } catch (err: any) {
      if (streamRafId != null) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }
      streamPendingAssistant = null;

      // "Stop" is an expected path. Avoid surfacing it as a console error
      // (Next dev overlay treats console errors as visible issues).
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

      console.error('[monday] Chat error:', err);

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
  }, [isLoading, sessionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const files = attachmentItems.map((p) => p.file);
    if (!input.trim() && files.length === 0) return;
    const text = input;
    setInput('');
    setAttachmentItems([]);
    void sendMessage(text, files);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-primary/28 via-sky-400/12 to-violet-400/22 p-[1px] shadow-[0_24px_64px_-20px_hsl(221_83%_53%/0.2),0_0_0_1px_hsl(var(--border)/0.3)] dark:from-primary/45 dark:via-chart-3/25 dark:to-accent/35 dark:shadow-[0_28px_80px_-24px_rgba(0,0,0,0.55)]">
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[calc(1.75rem-1px)] border border-sky-100/60 bg-gradient-to-b from-white/95 via-card to-slate-50/90 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.85)] backdrop-blur-xl dark:border-border/70 dark:from-card dark:via-card dark:to-secondary/25 dark:bg-card/55 dark:[background-image:none] dark:shadow-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_55%_at_50%_-25%,hsl(var(--primary)/0.14),transparent_58%),radial-gradient(ellipse_60%_40%_at_100%_0%,hsl(var(--chart-4)/0.08),transparent_50%)] dark:bg-[radial-gradient(ellipse_90%_50%_at_50%_-30%,hsl(var(--primary)/0.08),transparent_55%)] pointer-events-none" />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6 [scrollbar-gutter:stable]">
        {messages.length === 0 ? (
          <div className="flex min-h-[min(52vh,520px)] flex-col">
            <div className="shrink-0 pt-2 text-center sm:pt-4">
              <LunaAiOrb />
              <h3 className="bg-gradient-to-r from-slate-900 via-sky-800 to-violet-800 bg-clip-text text-xl font-semibold tracking-tight text-transparent dark:bg-none dark:text-foreground">
                Luna AI Assistant
              </h3>
            </div>

            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-lg text-left">
                <ChatComposer
                  isLoading={isLoading}
                  input={input}
                  onInputChange={setInput}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                  attachmentItems={attachmentItems}
                  onAttachmentInputChange={addAttachmentFiles}
                  onRemoveAttachment={(id) =>
                    setAttachmentItems((prev) => prev.filter((p) => p.id !== id))
                  }
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-1">
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
                        <div className="space-y-2">
                          <p className="whitespace-pre-wrap break-words leading-relaxed text-primary-foreground/95">
                            {message.content}
                          </p>
                          {message.attachments && message.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {message.attachments.map((a, i) => (
                                <span
                                  key={`${a.name}-${i}`}
                                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[11px] text-primary-foreground/95"
                                >
                                  <FileText className="h-3 w-3 shrink-0 opacity-90" />
                                  <span className="truncate">{a.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
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
          </div>
        )}
        </div>

        {messages.length > 0 && (
          <div className="relative shrink-0 border-t border-border/60 bg-gradient-to-t from-muted/40 to-transparent dark:border-border/50 dark:from-muted/30 px-4 sm:px-6 py-4">
            <ChatComposer
              isLoading={isLoading}
              input={input}
              onInputChange={setInput}
              onSubmit={handleSubmit}
              onStop={handleStop}
              attachmentItems={attachmentItems}
              onAttachmentInputChange={addAttachmentFiles}
              onRemoveAttachment={(id) =>
                setAttachmentItems((prev) => prev.filter((p) => p.id !== id))
              }
            />
            <p className="mt-2.5 text-center text-[11px] text-neutral-600 dark:text-muted-foreground/90">
              Tip: name the board and a date range for sharper answers.
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

