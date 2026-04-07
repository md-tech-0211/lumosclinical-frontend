'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Navigates home with a fresh query key so the chat panel remounts (new conversation). */
export function NavNewChatLink({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-start gap-2 rounded-full px-3 py-1.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-sky-100/50 hover:text-sky-900 dark:hover:bg-muted/80 dark:hover:text-foreground',
        className
      )}
      onClick={() => router.push(`/?new=${Date.now()}`)}
    >
      <Plus className="h-4 w-4 shrink-0" aria-hidden />
      New chat
    </button>
  );
}
