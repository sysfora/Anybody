'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  thinking?: string;
}

function formatTime(d: Date): string {
  try {
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderInlineContent(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded border border-border bg-muted/80 px-1 py-px text-[0.8125rem] font-mono text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function AssistantBlock({
  message,
  suppressWorkingPlaceholder,
  generationActive,
  showCompletedEmptyHint,
  showRemoteGenerationHint,
}: {
  message: ChatMessage;
  suppressWorkingPlaceholder?: boolean;
  /** Live socket turn only (`pending-*` rows). */
  generationActive: boolean;
  showCompletedEmptyHint?: boolean;
  /** Server still reports generating but this isn’t a live pending row (e.g. after refresh). */
  showRemoteGenerationHint?: boolean;
}) {
  const awaitingContent = !message.content?.trim();

  const [thinkingOpen, setThinkingOpen] = useState(
    () => Boolean(message.thinking?.trim()) && awaitingContent,
  );
  const hadThinkingRef = useRef(Boolean(message.thinking?.trim()));

  useEffect(() => {
    const has = Boolean(message.thinking?.trim());
    if (awaitingContent && has && !hadThinkingRef.current) {
      setThinkingOpen(true);
    }
    hadThinkingRef.current = has;
  }, [message.thinking, awaitingContent]);

  const showThinking = Boolean(message.thinking?.trim());
  const showContent = Boolean(message.content?.trim());

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold text-foreground">
          Assistant
        </span>
        <time
          className="text-[11px] text-muted-foreground tabular-nums"
          dateTime={message.timestamp.toISOString()}
          suppressHydrationWarning
        >
          {formatTime(message.timestamp)}
        </time>
      </div>

      {showThinking ? (
        <Collapsible open={thinkingOpen} onOpenChange={setThinkingOpen}>
          <div className="overflow-hidden rounded-lg border border-border bg-muted/10">
            <CollapsibleTrigger
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="text-xs font-medium text-muted-foreground">
                Reasoning
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                  thinkingOpen && 'rotate-180',
                )}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-border px-3 py-2.5 sm:px-3.5">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
                  {message.thinking}
                </p>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}

      {showContent ? (
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground sm:text-[15px]">
            {renderInlineContent(message.content)}
          </p>
        </div>
      ) : null}

      {generationActive &&
      !suppressWorkingPlaceholder &&
      !showContent &&
      !showThinking ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60 animate-pulse"
            aria-hidden
          />
          <span className="text-sm text-muted-foreground">Working…</span>
        </div>
      ) : null}
      {showRemoteGenerationHint ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60 animate-pulse"
            aria-hidden
          />
          <span className="text-sm text-muted-foreground">Generating…</span>
        </div>
      ) : null}
      {showCompletedEmptyHint ? (
        <p className="text-xs text-muted-foreground">
          Summary not stored; open the code or preview pane for output.
        </p>
      ) : null}
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex w-fit max-w-full flex-col items-start gap-1.5">
      <div className="w-full min-w-0 rounded-2xl border border-border bg-foreground px-3.5 py-2.5 sm:px-4 sm:py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-background sm:text-[15px]">
          {message.content}
        </p>
      </div>
      <time
        className="text-[11px] text-muted-foreground tabular-nums"
        dateTime={message.timestamp.toISOString()}
        suppressHydrationWarning
      >
        {formatTime(message.timestamp)}
      </time>
    </div>
  );
}

function AssistantGeneratingTail() {
  return (
    <div
      className="mt-2 flex items-center gap-2 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-foreground/70 dark:text-foreground/60"
        aria-hidden
      />
      <span className="text-xs sm:text-[13px]">Generating…</span>
    </div>
  );
}

export function ChatMessages({
  messages,
  pendingStreamingAssistantId,
  generationActive,
  remoteGenerationSuggested,
}: {
  messages: ChatMessage[];
  /** Only local `pending-*` assistant id; never a PocketBase id (avoids fake “Generating…” after refresh). */
  pendingStreamingAssistantId?: string | null;
  /** True only while this tab has an in-flight `pending-*` assistant message. */
  generationActive: boolean;
  /** Project status is generating but there is no local pending row (reconnect / refresh). */
  remoteGenerationSuggested?: boolean;
}) {
  const lastAssistantId = [...messages]
    .reverse()
    .find((m) => m.type === 'assistant')?.id;

  return (
    <div className="flex flex-col gap-6 px-3 py-4 sm:gap-8 sm:px-4 sm:py-5">
      {messages.map((message) =>
        message.type === 'user' ? (
          <div key={message.id} className="flex w-full justify-start">
            <div className="w-fit max-w-[80%] min-w-0">
              <UserBubble message={message} />
            </div>
          </div>
        ) : (
          <div key={message.id} className="flex w-full justify-end">
            <div
              className={cn(
                'min-w-0 max-w-[80%]',
                message.content?.trim() || message.thinking?.trim()
                  ? 'w-full max-w-[80%]'
                  : 'w-fit max-w-[80%]',
              )}
            >
              <AssistantBlock
                message={message}
                generationActive={generationActive}
                suppressWorkingPlaceholder={
                  pendingStreamingAssistantId === message.id ||
                  !generationActive
                }
                showRemoteGenerationHint={
                  !!remoteGenerationSuggested &&
                  message.id === lastAssistantId &&
                  !message.content?.trim() &&
                  !message.thinking?.trim()
                }
                showCompletedEmptyHint={
                  !generationActive &&
                  !remoteGenerationSuggested &&
                  message.id === lastAssistantId &&
                  !message.content?.trim() &&
                  !message.thinking?.trim()
                }
              />
              {pendingStreamingAssistantId === message.id && generationActive ? (
                <AssistantGeneratingTail />
              ) : null}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
