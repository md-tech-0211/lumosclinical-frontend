'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Navigates home with a fresh query key so the chat panel remounts (new conversation). */
export function NavNewChatLink({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-start rounded-full px-3 py-1.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground',
        className
      )}
      onClick={() => router.push(`/?new=${Date.now()}`)}
    >
      New chat
    </button>
  );
}
