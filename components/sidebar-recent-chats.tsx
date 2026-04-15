'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { deleteSession, listSessions, type ChatSession } from '@/lib/chat-sessions';
import { cn } from '@/lib/utils';

export function SidebarRecentChats() {
  const pathname = usePathname();
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const refresh = useCallback(() => {
    setSessions(listSessions());
  }, []);

  useEffect(() => {
    refresh();
    const onSessionsChanged = () => refresh();
    window.addEventListener('luna-chat-sessions-changed', onSessionsChanged);
    window.addEventListener('storage', onSessionsChanged);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('luna-chat-sessions-changed', onSessionsChanged);
      window.removeEventListener('storage', onSessionsChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  if (sessions.length === 0) {
    return (
      <p className="px-2 py-2 text-xs text-muted-foreground">
        No recent chats yet.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {sessions.slice(0, 30).map((s) => (
        <li key={s.id}>
          <Link
            href={`/chats/${s.id}`}
            className={cn(
              'group flex items-start gap-2 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-muted/80',
              pathname === `/chats/${s.id}` && 'bg-muted/60'
            )}
          >
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 line-clamp-2 leading-snug text-foreground/90">
              {s.title}
            </span>
            <button
              type="button"
              className="ml-1 mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 opacity-0 transition hover:bg-muted/80 hover:text-destructive group-hover:opacity-100"
              aria-label="Delete chat"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const wasOpen = (pathname ?? "").startsWith(`/chats/${s.id}`);
                deleteSession(s.id);
                refresh();
                if (wasOpen) {
                  router.push(`/?new=${Date.now()}`);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Link>
        </li>
      ))}
    </ul>
  );
}
