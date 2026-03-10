'use client';

import { use } from 'react';
import Chat from '../page';

export default function ChatProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <Chat projectIdFromUrl={projectId} />;
}

