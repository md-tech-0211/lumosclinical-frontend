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
    <div className="min-h-[calc(100vh-7.5rem)] flex flex-col">
      <MondayAssistantChat key={id} initialSessionId={id} />
    </div>
  );
}
