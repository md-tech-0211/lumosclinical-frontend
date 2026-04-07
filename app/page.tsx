'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MondayAssistantChat } from '@/components/monday-assistant-chat';

function HomeChat() {
  const searchParams = useSearchParams();
  const newKey = searchParams.get('new') ?? 'default';

  return <MondayAssistantChat key={newKey} />;
}

export default function Page() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <HomeChat />
        </div>
      </Suspense>
    </div>
  );
}
