'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  type ChatSession,
  deleteSession,
  listSessions,
} from '@/lib/chat-sessions';

export default function ChatsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const refresh = useCallback(() => {
    setSessions(listSessions());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = (id: string) => {
    deleteSession(id);
    refresh();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Previous chats</h1>
          <p className="text-sm text-muted-foreground">
            Open a saved conversation or start a new one.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="rounded-xl w-fit"
          onClick={() => router.push(`/?new=${Date.now()}`)}
        >
          New chat
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              No chats yet
            </CardTitle>
            <CardDescription>
              Start a conversation on the home page. It will appear here automatically.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card className="rounded-2xl transition-shadow hover:shadow-md">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="bg-primary/10 text-primary rounded-xl p-2 shrink-0 mt-0.5">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/chats/${s.id}`}
                      className="font-medium text-foreground hover:underline line-clamp-2"
                    >
                      {s.title}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(s.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-xl text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(s.id)}
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
