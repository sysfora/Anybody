'use client';

import { usePathname } from 'next/navigation';
import ChatView from './chat-view';

function projectSlugFromPathname(pathname: string | null): string | undefined {
  if (!pathname?.startsWith('/chat')) return undefined;
  const rest = pathname.slice('/chat'.length).replace(/^\//, '');
  if (!rest) return undefined;
  const first = rest.split('/').filter(Boolean)[0];
  if (!first) return undefined;
  try {
    return decodeURIComponent(first);
  } catch {
    return first;
  }
}

/** Keeps a single ChatView mounted for /chat and /chat/{name} so router.replace does not remount UI. */
export function ChatShell() {
  const pathname = usePathname();
  const slug = projectSlugFromPathname(pathname);
  return <ChatView projectIdFromUrl={slug} />;
}
