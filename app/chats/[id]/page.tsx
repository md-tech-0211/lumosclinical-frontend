'use client';

import { useParams } from 'next/navigation';
import { MondayAssistantChat } from '@/components/monday-assistant-chat';

export default function ChatSessionPage() {
  const params = useParams();
  const id = params?.id as string | undefined;

  if (!id) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <MondayAssistantChat key={id} initialSessionId={id} />
    </div>
  );
}
