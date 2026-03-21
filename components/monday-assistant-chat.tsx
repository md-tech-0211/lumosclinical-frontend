'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Send, Sparkles, Bot, User, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssistantMarkdown } from '@/components/assistant-markdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; status: 'pending' | 'done' }>;
}

export function MondayAssistantChat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

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

    try {
      abortRef.current = new AbortController();

      const response = await fetch('/api/ai/monday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortRef.current.signal,
      });

      console.log('[monday] Chat API response status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let errorMessage = `Server error: ${response.status}`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed.error) errorMessage = parsed.error;
        } catch {
          if (errorBody) errorMessage = errorBody;
        }
        console.error('[monday] Chat API error response:', response.status, errorBody);
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

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', toolCalls: [] },
      ]);

      const updateMessage = (content: string, tools: typeof toolCalls) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content, toolCalls: [...tools] }
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
      updateMessage(fullContent, toolCalls);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[monday] Chat error:', err);
      setError(err?.message || 'Failed to get a response');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    sendMessage(text);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-center gap-3 mb-2">
          <Image
            src="/assets/logo/logo.jpg"
            alt="Lumos"
            width={72}
            height={72}
            className="h-16 w-28 flex items-center justify-center object-contain flex-shrink-0"
          />
          <h2 className="text-lg flex items-center justify-center font-semibold">AI Assistant</h2>
          
        </div>
        <p className="text-sm flex items-center justify-center text-muted-foreground">
          Ask questions about your boards, items, and workflows.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div className="max-w-md">
              <div className="bg-primary/10 text-primary rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <Sparkles className="h-8 w-8" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Lumos AI Assistant</h3>
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
                    className="text-left px-4 py-2.5 rounded-lg border text-sm hover:bg-accent transition-colors"
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
                    <div className="bg-primary/10 text-primary rounded-full p-1.5 h-8 w-8 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-2xl rounded-lg px-4 py-3',
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
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
                    <div className="bg-primary text-primary-foreground rounded-full p-1.5 h-8 w-8 flex items-center justify-center flex-shrink-0 mt-0.5">
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

      <div className="border-t px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="Ask about your boards, items, workflows..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            size="icon"
          >
            {isLoading ? (
              <Spinner size="sm" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

