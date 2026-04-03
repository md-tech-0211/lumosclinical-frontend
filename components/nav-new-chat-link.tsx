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
        'text-muted-foreground hover:text-foreground transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer font-inherit font-sans',
        className
      )}
      onClick={() => router.push(`/?new=${Date.now()}`)}
    >
      New chat
    </button>
  );
}
