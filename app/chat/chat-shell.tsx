'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ChatView from './chat-view';

const LAST_SLUG_KEY = 'chat_last_slug';

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
  const router = useRouter();
  const slug = projectSlugFromPathname(pathname);
  const didRedirectRef = useRef(false);

  useEffect(() => {
    if (slug) {
      // Save the current project so we can return to it later.
      try { sessionStorage.setItem(LAST_SLUG_KEY, slug); } catch { /* ignore */ }
      didRedirectRef.current = false;
    } else if (!didRedirectRef.current) {
      // At /chat (no slug) — restore last project if one was saved.
      try {
        const last = sessionStorage.getItem(LAST_SLUG_KEY);
        if (last) {
          didRedirectRef.current = true;
          router.replace(`/chat/${encodeURIComponent(last)}`);
        }
      } catch { /* ignore */ }
    }
  }, [slug, router]);

  return <ChatView projectIdFromUrl={slug} />;
}

/** Called by ChatView when the user starts a new project (+ button).
 *  Clears the last-slug so the next /chat visit starts fresh. */
export function clearLastChatSlug() {
  try { sessionStorage.removeItem(LAST_SLUG_KEY); } catch { /* ignore */ }
}
