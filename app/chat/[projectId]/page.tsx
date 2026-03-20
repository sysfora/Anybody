'use client';

import { use } from 'react';
import ChatView from '../chat-view';

export default function ChatProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <ChatView projectIdFromUrl={projectId} />;
}

