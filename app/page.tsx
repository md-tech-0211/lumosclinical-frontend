'use client';

import { AssistantChat } from '@/components/assistant-chat';

export default function Page() {
  return (
    <div className="h-screen flex flex-col bg-background">
      <AssistantChat />
    </div>
  );
}
