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
    <div className="min-h-[calc(100vh-7.5rem)] flex flex-col">
      <Suspense
        fallback={
          <div className="min-h-[50vh] flex items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <HomeChat />
      </Suspense>
    </div>
  );
}
