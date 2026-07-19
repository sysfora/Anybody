'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  startTransition,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowUp,
  Loader2,
  Plus,
  Rocket,
  Square,
  Paperclip,
  X,
  FileText,
  FileCode,
} from 'lucide-react';
import { Sidebar } from '@/components/Dashboard/Sidebar';
import { NavigationBar } from '@/components/NavigationBar';
import {
  ChatMessages,
  AttachmentPreviews,
  type ChatMessage,
  type AttachmentMeta,
} from '@/components/Dashboard/ChatMessages';

import { CodeHighlight } from '@/components/Dashboard/CodeHighlight';
import { useProject, type ProjectStatus } from '@/context/ProjectContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { VisibilityDropdown, type VisibilityOption } from '@/components/ui/visibility-dropdown';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { animateHtmlDiff, prefersReducedMotion } from '@/lib/codeDiffAnimator';
import { unlockAudio, playGenerationCompleteSound } from '@/lib/sound';
import pb from '@/lib/pocketbase';
import { SUBSCRIPTION_RESUME_KEY, SubscriptionPopup, type SubscriptionResumeData } from '@/components/SubscriptionPopup';
import { AutoReloadDialog } from '@/components/AutoReloadDialog';
import { clearLastChatSlug } from '@/app/chat/chat-shell';
import { toast, showToast, showToastError } from '@/lib/toast';

/** sessionStorage helpers for per-project prompt persistence */
const promptKey = (slug: string) => `chat_prompt_${encodeURIComponent(slug)}`;
function savePrompt(slug: string | undefined, value: string) {
  if (!slug) return;
  try {
    if (value.trim()) {
      sessionStorage.setItem(promptKey(slug), value);
    } else {
      sessionStorage.removeItem(promptKey(slug));
    }
  } catch { /* ignore */ }
}
function loadPrompt(slug: string | undefined): string {
  if (!slug) return '';
  try { return sessionStorage.getItem(promptKey(slug)) ?? ''; } catch { return ''; }
}
function clearPrompt(slug: string | undefined) {
  if (!slug) return;
  try { sessionStorage.removeItem(promptKey(slug)); } catch { /* ignore */ }
}

const deviceSizes = {
  mobile: '375px',
  tablet: '768px',
  desktop: '100%',
} as const;

/** Pixels from bottom to treat as "at end" for auto-scroll resume. */
const SCROLL_END_THRESHOLD_PX = 80;

/**
 * While a generation is in flight, the preview iframe rebuilds/reloads from
 * a fresh blob URL on every htmlSource change, which happens dozens of
 * times a second during streaming. Cap it to once per this many ms so the
 * preview doesn't flicker/reload constantly mid-stream.
 */
const PREVIEW_THROTTLE_MS = 5000;

function isNearScrollBottom(el: HTMLElement) {
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
  return gap <= SCROLL_END_THRESHOLD_PX;
}

function mapProjectStatusFromPb(status?: string): ProjectStatus {
  if (status === 'generating') return 'generating';
  if (status === 'error') return 'error';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'modifying') return 'modifying';
  if (status === 'building') return 'building';
  if (status === 'uploading') return 'uploading';
  if (status === 'idle') return 'idle';
  return 'completed';
}

type ProjectLoadPayload = {
  project?: {
    id?: string;
    name?: string;
    visibility?: string;
    status?: string;
    deployed?: boolean;
    preview?: string;
  };
  html?: string;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinking: string;
    created: string;
    request_id: string;
  }>;
};

export default function ChatView({
  projectIdFromUrl,
}: {
  projectIdFromUrl?: string;
}) {
  const router = useRouter();
  // Input state is now managed globally via ProjectContext
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [htmlSource, setHtmlSource] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);
  const [showAutoReloadDialog, setShowAutoReloadDialog] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [subscriptionReason, setSubscriptionReason] = useState<"private_project" | "out_of_limits">("out_of_limits");
  // Prompt captured when a credit-check popup was shown, so we can auto-submit once resolved.
  const blockedPromptRef = useRef<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);
  const chatStickBottomRef = useRef(true);
  const codeStickBottomRef = useRef(true);
  const previewObjectUrlRef = useRef<string | null>(null);
  // Throttle bookkeeping for the preview-rebuild effect below: timestamp of
  // the last actual preview flush, and the pending trailing-flush timer.
  const lastPreviewFlushAtRef = useRef(0);
  const previewThrottleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitInFlightRef = useRef(false);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  const projectNameRef = useRef<string | null>(null);
  const projectPbIdRef = useRef<string | null>(null);
  const projectIdFromUrlRef = useRef<string | undefined>(projectIdFromUrl);
  const routerRef = useRef(router);
  const wsConnectedRef = useRef(false);
  const sessionAuthedRef = useRef(false);
  const htmlSourceRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True once the first code_chunk for the current generation has arrived.
  // Used to wipe old HTML exactly once so the new code replaces it cleanly.
  const firstCodeChunkRef = useRef(false);
  // True when the current/most recent turn is editing an existing project
  // (2nd+ prompt) rather than generating a brand-new one. Drives the
  // diff-typewriter animation in onGenerationDone and suppresses the raw
  // live code_chunk re-render during modify turns (see onCodeChunk).
  const isModifyTurnRef = useRef(false);
  // Snapshot of htmlSource right before a modify-turn submit — the "before"
  // side of the diff animation once the turn completes.
  const preEditHtmlRef = useRef<string | null>(null);
  // Bumped on every new submit / stop / new-project so a still-running diff
  // animation from a stale turn can detect it's been superseded and stop
  // touching shared state.
  const animationTokenRef = useRef(0);
  // True once at least one `patch_applied` event has landed for the current
  // turn — the agentic small-patch modify loop animates each step live as
  // it arrives, so the single whole-file diff animation in onGenerationDone
  // is only needed as a fallback for turns that never got incremental
  // patches (brand-new generation, or a full-file safety-net regeneration).
  const receivedPatchAppliedRef = useRef(false);
  // Serializes per-patch diff animations so out-of-order network delivery
  // (or a slow tick loop) can never animate two steps concurrently — each
  // new patch_applied's animation is chained onto the promise for the one
  // before it.
  const patchAnimationChainRef = useRef<Promise<void>>(Promise.resolve());
  // Highest step number received so far. If a queued step's turn to
  // animate comes up but a *newer* step has since arrived, that step is
  // stale — snap straight to its target instead of animating, so a burst
  // of fast steps can never pile up a backlog that keeps "editing" on
  // screen well after generation has actually finished.
  const latestPatchStepRef = useRef(0);

  const [projectLoadStatus, setProjectLoadStatus] = useState<string | null>(
    null,
  );
  const [attachmentMetas, setAttachmentMetas] = useState<AttachmentMeta[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    projectName,
    setProjectName,
    setUserId,
    setStatus,
    status: ctxProjectStatus,
    setPreviewUrl,
    viewMode,
    setViewMode,
    deviceSize,
    previewUrl,
    setRefreshCallback,
    chatInput,
    setChatInput,
    chatAttachments,
    setChatAttachments,
    chatVisibility,
    setChatVisibility,
    shouldAutoSubmit,
    setShouldAutoSubmit,
    mobileShowPreview,
    setMobileShowPreview,
  } = useProject();

  useEffect(() => {
    const metas = chatAttachments.map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
      mimeType: f.type,
      size: f.size,
    }));
    setAttachmentMetas(metas);
    return () => {
      metas.forEach((m) => URL.revokeObjectURL(m.url));
    };
  }, [chatAttachments]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    htmlSourceRef.current = htmlSource;
  }, [htmlSource]);

  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);

  // Check subscription to set default visibility
  useEffect(() => {
    const checkSub = async () => {
      const userId = pb.authStore.record?.id;
      if (!userId) return;

      try {
        const res = await fetch("/api/subscription/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (res.ok) {
          const data = await res.json();
          const sub = !!data.hasActiveSubscription;
          setIsSubscribed(sub);
          
          // If subscribed and starting a new project (no projectIdFromUrl), default to private
          if (sub && !projectIdFromUrl) {
            setChatVisibility('private');
          }
        }
      } catch (err) {
        console.error("Failed to check sub:", err);
      }
    };
    
    if (pb.authStore.isValid) {
      checkSub();
    }
  }, [projectIdFromUrl]);

  // Use layout-effect so the ref is always in sync with the prop before any
  // useEffect (socket handlers, polling) reads it.
  useLayoutEffect(() => {
    projectIdFromUrlRef.current = projectIdFromUrl;
  }, [projectIdFromUrl]);

  // Must match server first paint (no PocketBase session in SSR) to avoid hydration mismatch.
  const [sessionAuthed, setSessionAuthed] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    sessionAuthedRef.current = sessionAuthed;
  }, [sessionAuthed]);

  useEffect(() => {
    const syncUser = () => {
      setSessionAuthed(pb.authStore.isValid);
      const model = pb.authStore.model as { id?: string } | undefined;
      setUserId(model?.id ?? null);
    };
    syncUser();
    setAuthResolved(true);
    return pb.authStore.onChange(() => {
      syncUser();
    });
  }, [setUserId]);

  const clearGenerationWatchdog = useCallback(() => {
    if (generationWatchdogRef.current) {
      clearTimeout(generationWatchdogRef.current);
      generationWatchdogRef.current = null;
    }
  }, []);

  const handleRefreshPreview = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const onChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    chatStickBottomRef.current = isNearScrollBottom(el);
  }, []);

  const onCodeScroll = useCallback(() => {
    const el = codeScrollRef.current;
    if (!el) return;
    codeStickBottomRef.current = isNearScrollBottom(el);
  }, []);

  /** Scroll the code panel so the given 1-based line is centered in view. */
  const scrollCodeToLine = useCallback((lineNumber: number) => {
    const container = codeScrollRef.current;
    if (!container) return;
    const lineEl = container.querySelector(`[data-line-number="${lineNumber}"]`);
    lineEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  useLayoutEffect(() => {
    const el = chatContainerRef.current;
    if (!el || !chatStickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  useLayoutEffect(() => {
    if (viewMode !== 'code') return;
    const el = codeScrollRef.current;
    if (!el || !codeStickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [htmlSource, viewMode]);

  useEffect(() => {
    setRefreshCallback(handleRefreshPreview);
    return () => setRefreshCallback(null);
  }, [handleRefreshPreview, setRefreshCallback]);

  useLayoutEffect(() => {
    if (projectIdFromUrl?.trim()) {
      setProjectName(decodeURIComponent(projectIdFromUrl.trim()));
    } else {
      setProjectName(null);
      setStatus('idle');
      setProjectLoadStatus(null);
      projectPbIdRef.current = null;
      projectNameRef.current = null;
      setChatMessages([]);
      setHtmlSource('');
      htmlSourceRef.current = '';
    }
  }, [projectIdFromUrl, setProjectName, setStatus]);

  // Restore unsent prompt that was saved before the user navigated away.
  useEffect(() => {
    const slug = projectIdFromUrl?.trim();
    if (!slug) return;
    const saved = loadPrompt(slug);
    if (saved) setChatInput(saved);
    // Only run when the slug first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdFromUrl]);

  // On mount, restore a prompt saved before Stripe checkout (upgrade mid-prompt).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUBSCRIPTION_RESUME_KEY);
      if (!raw) return;

      const data = JSON.parse(raw) as SubscriptionResumeData;
      const returnTo = data.returnTo?.trim() || "";
      const isChatReturn =
        returnTo === "/chat" ||
        returnTo.startsWith("/chat/") ||
        returnTo.startsWith("/chat?");

      if (!isChatReturn) return;

      // If we landed on a different chat URL than saved, still restore here
      // when the success page already navigated us to this path.
      if (data.pendingPrompt?.trim()) {
        setChatInput(data.pendingPrompt.trim());
        setChatVisibility((data.pendingVisibility as VisibilityOption) ?? "public");
        setShouldAutoSubmit(true);
      }
      localStorage.removeItem(SUBSCRIPTION_RESUME_KEY);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // When the socket connects, check if we need to auto-submit (either from Home.tsx navigate or subscription resume)
  useEffect(() => {
    if (!wsConnected) return;
    if (!shouldAutoSubmit) return;
    
    // Once handled, turn off auto-submission to prevent loops
    setShouldAutoSubmit(false);
    
    if (!chatInput.trim() && chatAttachments.length === 0) return;
    
    // We snapshot attachments to clear the main state visually exactly how handleSubmit does it
    const filesToSubmit = [...chatAttachments];
    void handleSubmit(chatInput, filesToSubmit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected, shouldAutoSubmit]); 

  const loadedProjectKeyRef = useRef<string | null>(null);

  const fetchProjectLoadData =
    useCallback(async (): Promise<ProjectLoadPayload | null | 'not-found'> => {
      const raw = projectIdFromUrlRef.current?.trim();
      if (!raw || !sessionAuthedRef.current) return null;
      const decoded = decodeURIComponent(raw);
      try {
        const res = await fetch(
          `/api/projects/load?projectName=${encodeURIComponent(decoded)}`,
          { credentials: 'include' },
        );
        if (res.status === 404) return 'not-found';
        if (!res.ok) return null;
        return (await res.json()) as ProjectLoadPayload;
      } catch {
        return null;
      }
    }, []);

  const applyProjectLoad = useCallback(
    (data: ProjectLoadPayload, options?: { force?: boolean; skipHtml?: boolean }) => {
      if (data.project?.id) {
        projectPbIdRef.current = data.project.id;
      }

      const skipBody =
        !options?.force &&
        pendingRequestIdRef.current !== null &&
        wsConnectedRef.current;

      if (!skipBody) {
        pendingAssistantIdRef.current = null;
        pendingRequestIdRef.current = null;
        clearGenerationWatchdog();
        const rows = data.messages ?? [];
        setChatMessages(
          rows.map((m: any) => ({
            id: m.id,
            type: m.role,
            content: m.content ?? '',
            thinking: m.thinking?.trim() ? m.thinking : undefined,
            timestamp: new Date(m.created),
            attachments: m.attachments,
          })),
        );
        if (typeof data.html === 'string' && !options?.skipHtml) {
          htmlSourceRef.current = data.html;
          setHtmlSource(data.html);
        }
        if (
          data.project?.visibility === 'public' ||
          data.project?.visibility === 'private'
        ) {
          setChatVisibility(data.project.visibility as VisibilityOption);
        }
        let st = data.project?.status ?? 'completed';
        const lastAssistant = [...rows]
          .reverse()
          .find((m) => m.role === 'assistant');
        const assistantHasText =
          !!lastAssistant &&
          typeof lastAssistant.content === 'string' &&
          lastAssistant.content.trim().length > 0;
        if (st === 'generating' && assistantHasText) {
          st = 'completed';
        }
        setProjectLoadStatus(st);
        setStatus(mapProjectStatusFromPb(st));
      }
    },
    [clearGenerationWatchdog, setStatus, setChatVisibility],
  );

  useEffect(() => {
    const raw = projectIdFromUrl?.trim();
    if (!raw) {
      loadedProjectKeyRef.current = null;
      return;
    }
    const decoded = decodeURIComponent(raw);
    if (!sessionAuthed) {
      loadedProjectKeyRef.current = null;
      return;
    }
    if (loadedProjectKeyRef.current === decoded) return;

    let cancelled = false;
    loadedProjectKeyRef.current = decoded;

    (async () => {
      const data = await fetchProjectLoadData();
      if (cancelled) return;
      if (!data || data === 'not-found') {
        loadedProjectKeyRef.current = null;
        return;
      }
      applyProjectLoad(data);
      setProjectName(decoded);
    })();

    return () => {
      cancelled = true;
      if (loadedProjectKeyRef.current === decoded) {
        loadedProjectKeyRef.current = null;
      }
    };
  }, [
    projectIdFromUrl,
    sessionAuthed,
    setProjectName,
    fetchProjectLoadData,
    applyProjectLoad,
  ]);

  useEffect(() => {
    if (!sessionAuthed || !projectIdFromUrl?.trim()) return;
    if (projectLoadStatus !== 'generating') return;
    let cancelled = false;
    const id = setInterval(() => {
      void (async () => {
        const data = await fetchProjectLoadData();
        // Discard the result if the effect was cleaned up while the fetch was
        // in flight (e.g. user clicked "New Project" mid-poll).
        if (cancelled) return;
        if (!data || data === 'not-found') {
          if (data === 'not-found') {
            setProjectLoadStatus('completed');
            setStatus('completed');
          }
          return;
        }
        applyProjectLoad(data);
      })();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    sessionAuthed,
    projectIdFromUrl,
    projectLoadStatus,
    fetchProjectLoadData,
    applyProjectLoad,
  ]);

  // Rebuild the preview iframe's blob URL from the latest htmlSource. During
  // an active generation this is throttled to PREVIEW_THROTTLE_MS so the
  // dozens of chunk-driven htmlSource updates per second don't reload the
  // iframe constantly; outside of generation (load, diff-typewriter
  // animation, etc.) every change is reflected immediately.
  useEffect(() => {
    const isGenerating =
      ctxProjectStatus === 'generating' || projectLoadStatus === 'generating';

    if (previewThrottleTimeoutRef.current) {
      clearTimeout(previewThrottleTimeoutRef.current);
      previewThrottleTimeoutRef.current = null;
    }

    const flush = () => {
      lastPreviewFlushAtRef.current = Date.now();
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      const currentHtml = htmlSourceRef.current;
      if (!currentHtml.trim()) {
        setPreviewUrl(null);
        return;
      }
      // Inject forced light-mode isolation. We surgically inject into the head if it exists to maintain valid HTML structure.
      const isolationSnippet = `<meta name="color-scheme" content="light"><style>:root { color-scheme: light !important; } body { background-color: white; color: black; margin: 0; min-height: 100vh; }</style>`;
      let isolatedHtml = currentHtml;
      if (currentHtml.includes('<head>')) {
        isolatedHtml = currentHtml.replace('<head>', '<head>' + isolationSnippet);
      } else if (currentHtml.includes('<html>')) {
        isolatedHtml = currentHtml.replace('<html>', '<html><head>' + isolationSnippet + '</head>');
      } else {
        isolatedHtml = isolationSnippet + currentHtml;
      }
      const blob = new Blob([isolatedHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      previewObjectUrlRef.current = url;
      setPreviewUrl(url);
    };

    if (!isGenerating) {
      flush();
      return;
    }

    const elapsed = Date.now() - lastPreviewFlushAtRef.current;
    if (elapsed >= PREVIEW_THROTTLE_MS) {
      flush();
    } else {
      previewThrottleTimeoutRef.current = setTimeout(flush, PREVIEW_THROTTLE_MS - elapsed);
    }
  }, [htmlSource, setPreviewUrl, ctxProjectStatus, projectLoadStatus]);

  // Revoke the last live blob URL and any pending throttled flush only on
  // true unmount — per-run cleanup would revoke a URL that's still on
  // screen while a throttled update is pending.
  useEffect(() => {
    return () => {
      if (previewThrottleTimeoutRef.current) {
        clearTimeout(previewThrottleTimeoutRef.current);
        previewThrottleTimeoutRef.current = null;
      }
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const titleName = projectName?.trim();
    document.title = titleName ? `${titleName} - Anybody.dev` : 'Chat - Anybody.dev';
  }, [projectName]);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      wsConnectedRef.current = true;
      setWsConnected(true);
      // Capture the project the user is on right now so we can bail if it
      // changes while the async fetch is in flight (navigation race).
      const expectedProject = projectIdFromUrlRef.current;
      void (async () => {
        const data = await fetchProjectLoadData();
        if (!data || data === 'not-found') return;
        // Bail if the user navigated away while the fetch was running.
        if (projectIdFromUrlRef.current !== expectedProject) return;
        const st = data?.project?.status;
        if (st === 'generating') {
          const pbId = data.project?.id;
          if (pbId) {
            projectPbIdRef.current = pbId;
            // Apply whatever partial state is in DB so the UI isn't blank.
            applyProjectLoad(data);
            // Subscribe to the live broadcast room to receive future chunks
            // and a catch-up snapshot of everything streamed so far.
            getSocket().emit('subscribe_project', { project_id: pbId });
          }
        } else if (st === 'completed' || st === 'error' || st === 'cancelled') {
          applyProjectLoad(data, { force: true });
        }
      })();
    };
    const onDisconnect = () => {
      wsConnectedRef.current = false;
      setWsConnected(false);
    };

    const onProjectSnapshot = (payload: {
      active: boolean;
      request_id?: string;
      thinking?: string;
      html?: string;
      reply?: string;
    }) => {
      if (!payload.active) return;

      const t = Date.now();
      const pendingId = `pending-${t}`;

      // Restore streamed HTML so the code/preview panes show progress.
      if (payload.html) {
        htmlSourceRef.current = payload.html;
        setHtmlSource(payload.html);
      }

      // Replace the last assistant message with a pending-* one that carries
      // the accumulated thinking/reply so the live-generation UI takes over.
      setChatMessages((prev) => {
        const newMessages = [...prev];
        let found = false;
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].type === 'assistant') {
            newMessages[i] = {
              ...newMessages[i],
              id: pendingId,
              thinking: payload.thinking ?? newMessages[i].thinking ?? '',
              content: payload.reply ?? newMessages[i].content ?? '',
            };
            found = true;
            break;
          }
        }
        if (!found) {
          newMessages.push({
            id: pendingId,
            type: 'assistant',
            content: payload.reply ?? '',
            thinking: payload.thinking ?? '',
            timestamp: new Date(),
          });
        }
        return newMessages;
      });

      // Wire up the pending refs so future thinking_chunk / code_chunk /
      // assistant_reply / generation_done events are routed correctly.
      pendingAssistantIdRef.current = pendingId;
      pendingRequestIdRef.current = payload.request_id ?? null;
      firstCodeChunkRef.current = false;
      setStatus('generating');
      setProjectLoadStatus('generating');
      clearGenerationWatchdog();
    };

    const onThinkingChunk = (payload: {
      request_id: string;
      chunk: string;
    }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      // Server is alive — cancel the "no response" watchdog on first chunk.
      clearGenerationWatchdog();
      const aid = pendingAssistantIdRef.current;
      if (!aid) return;
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === aid
            ? { ...m, thinking: (m.thinking ?? '') + payload.chunk }
            : m,
        ),
      );
    };

    const onMessageChunk = (payload: { request_id: string; chunk: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      clearGenerationWatchdog();
      const aid = pendingAssistantIdRef.current;
      if (!aid) return;
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === aid
            ? { ...m, content: (m.content ?? '') + payload.chunk }
            : m,
        ),
      );
    };

    const onCodeChunk = (payload: { request_id: string; chunk: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      clearGenerationWatchdog();
      if (isModifyTurnRef.current) {
        // Modify turns don't render the raw re-streamed file live — it's
        // the *entire* file re-sent quickly, not a meaningful "typing"
        // signal. The code panel stays on the pre-edit HTML until the
        // diff-typewriter animation runs in onGenerationDone, once the
        // real before/after difference is known.
        return;
      }
      setHtmlSource((prev) => {
        // First code chunk clears the previous HTML so new output starts fresh.
        const base = firstCodeChunkRef.current ? prev : '';
        firstCodeChunkRef.current = true;
        const next = base + payload.chunk;
        htmlSourceRef.current = next;
        return next;
      });
    };

    const onAssistantReply = (payload: {
      request_id: string;
      message: string;
    }) => {
      // Final sync — only overwrites if message_chunk didn't already populate the content
      // (handles reconnect / missed-chunk edge cases).
      if (payload.request_id !== pendingRequestIdRef.current) return;
      const aid = pendingAssistantIdRef.current;
      if (!aid) return;
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === aid ? { ...m, content: payload.message } : m,
        ),
      );
    };

    const finalizePending = () => {
      clearGenerationWatchdog();
      pendingAssistantIdRef.current = null;
      pendingRequestIdRef.current = null;
    };

    // Agentic small-patch modify loop: the server emits one `patch_applied`
    // per verified step, well before `generation_done`. Each one gets its
    // own diff-typewriter animation (old shown code -> that step's updated
    // full HTML), chained so steps always animate strictly in order even if
    // the next patch_applied arrives before the previous animation finishes.
    const onPatchApplied = (payload: {
      request_id: string;
      step: number;
      html: string;
    }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      if (typeof payload.html !== 'string') return;
      clearGenerationWatchdog();
      receivedPatchAppliedRef.current = true;

      const myToken = animationTokenRef.current;
      const myStep = payload.step;
      const targetHtml = payload.html;
      const stillCurrent = () => animationTokenRef.current === myToken;
      latestPatchStepRef.current = myStep;

      patchAnimationChainRef.current = patchAnimationChainRef.current
        .then(async () => {
          if (!stillCurrent()) return;

          // A newer step already landed while this one was queued behind a
          // slower predecessor — skip straight to it instead of animating,
          // so the display catches back up to real time immediately.
          const isStale = myStep !== latestPatchStepRef.current;

          if (prefersReducedMotion() || isStale) {
            htmlSourceRef.current = targetHtml;
            setHtmlSource(targetHtml);
            return;
          }

          const previousStickBottom = codeStickBottomRef.current;
          codeStickBottomRef.current = false;
          await animateHtmlDiff({
            before: htmlSourceRef.current,
            after: targetHtml,
            isCancelled: () => !stillCurrent(),
            // Small per-step edits should read as a quick, snappy typing
            // burst, not a deliberate reveal — keep the whole step's
            // animation within well under a second even with several hunks.
            maxTotalDurationMs: 500,
            onUpdate: (text) => {
              // Update the ref synchronously (not just via the htmlSource
              // effect) so the NEXT patch_applied — or the final
              // reconciliation in onGenerationDone — always sees the true
              // current buffer, even if React hasn't committed yet.
              htmlSourceRef.current = text;
              setHtmlSource(text);
            },
            onScrollToLine: scrollCodeToLine,
          });
          codeStickBottomRef.current = previousStickBottom;
        })
        .catch(() => {
          /* never let one bad animation break the chain for later steps */
        });
    };

    const onGenerationDone = (payload: { request_id: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      if (!pendingAssistantIdRef.current) return;
      finalizePending();
      playGenerationCompleteSound();

      const myToken = animationTokenRef.current;
      const wasModifyTurn = isModifyTurnRef.current;
      const preEditHtml = preEditHtmlRef.current;
      const usedIncrementalPatches = receivedPatchAppliedRef.current;

      if (!wasModifyTurn) {
        // First-prompt behavior, unchanged: the file already streamed in
        // live via code_chunk, so flip to Preview immediately.
        setIframeKey((k) => k + 1);
        setViewMode('preview');
      }

      void (async () => {
        // Let any still-queued per-patch animations for this turn finish
        // before reconciling with the server's persisted final state.
        try {
          await patchAnimationChainRef.current;
        } catch {
          /* individual step failures are already swallowed above */
        }

        const data = await fetchProjectLoadData();
        if (!data || data === 'not-found') return;

        const finalHtml = typeof data.html === 'string' ? data.html : null;
        const stillCurrent = () => animationTokenRef.current === myToken;
        // If per-patch animations already ran, the code panel is already at
        // (or very near) the final state — animate from THERE, not from the
        // original pre-turn snapshot. This also correctly handles the rare
        // case where some steps patched successfully before the loop had to
        // escalate to a full-file fallback: any remaining gap between what
        // the patches produced and the fallback's final file still animates,
        // instead of silently snapping.
        const baseline = usedIncrementalPatches ? htmlSourceRef.current : preEditHtml;
        const shouldAnimate =
          wasModifyTurn &&
          finalHtml !== null &&
          baseline !== null &&
          baseline !== finalHtml &&
          !prefersReducedMotion() &&
          stillCurrent();

        applyProjectLoad(data, {
          force: true,
          skipHtml: shouldAnimate || (wasModifyTurn && usedIncrementalPatches),
        });

        if (shouldAnimate && finalHtml !== null && baseline !== null) {
          const previousStickBottom = codeStickBottomRef.current;
          codeStickBottomRef.current = false;
          await animateHtmlDiff({
            before: baseline,
            after: finalHtml,
            isCancelled: () => !stillCurrent(),
            onUpdate: (text) => {
              htmlSourceRef.current = text;
              setHtmlSource(text);
            },
            onScrollToLine: scrollCodeToLine,
          });
          codeStickBottomRef.current = previousStickBottom;
        } else if (
          wasModifyTurn &&
          usedIncrementalPatches &&
          finalHtml !== null &&
          stillCurrent()
        ) {
          // Baseline already matches finalHtml (the common case) — plain,
          // no-op-looking sync so state is guaranteed consistent.
          htmlSourceRef.current = finalHtml;
          setHtmlSource(finalHtml);
        }

        if (wasModifyTurn && stillCurrent()) {
          setIframeKey((k) => k + 1);
          setViewMode('preview');
        }
      })();
    };

    const onGenerationError = (payload: {
      request_id: string;
      message: string;
    }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      if (!pendingAssistantIdRef.current) return;
      finalizePending();
      void (async () => {
        const data = await fetchProjectLoadData();
        if (!data || data === 'not-found') return;
        applyProjectLoad(data, { force: true });
      })();
    };

    const onGenerationStopped = (payload: { request_id: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      if (!pendingAssistantIdRef.current) return;
      finalizePending();
      void (async () => {
        const data = await fetchProjectLoadData();
        if (!data || data === 'not-found') return;
        applyProjectLoad(data, { force: true });
      })();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('project_snapshot', onProjectSnapshot);
    socket.on('thinking_chunk', onThinkingChunk);
    socket.on('message_chunk', onMessageChunk);
    socket.on('code_chunk', onCodeChunk);
    socket.on('patch_applied', onPatchApplied);
    socket.on('assistant_reply', onAssistantReply);
    socket.on('generation_done', onGenerationDone);
    socket.on('generation_error', onGenerationError);
    socket.on('generation_stopped', onGenerationStopped);

    wsConnectedRef.current = socket.connected;
    setWsConnected(socket.connected);
    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      clearGenerationWatchdog();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('project_snapshot', onProjectSnapshot);
      socket.off('thinking_chunk', onThinkingChunk);
      socket.off('message_chunk', onMessageChunk);
      socket.off('code_chunk', onCodeChunk);
      socket.off('patch_applied', onPatchApplied);
      socket.off('assistant_reply', onAssistantReply);
      socket.off('generation_done', onGenerationDone);
      socket.off('generation_error', onGenerationError);
      socket.off('generation_stopped', onGenerationStopped);
    };
  }, [clearGenerationWatchdog, fetchProjectLoadData, applyProjectLoad, setViewMode]);

  const handleStopGeneration = useCallback(() => {
    const req = pendingRequestIdRef.current;
    const aid = pendingAssistantIdRef.current;
    if (!req || !aid) return;
    clearGenerationWatchdog();
    // Cancel any in-flight diff animation for this turn.
    animationTokenRef.current += 1;
    getSocket().emit('stop_generation', { request_id: req });
    setChatMessages((prev) =>
      prev.map((m) =>
        m.id === aid
          ? {
            ...m,
            id: `assistant-${Date.now()}`,
            content: m.content?.trim()
              ? `${m.content}\n\nGeneration stopped.`
              : 'Generation stopped.',
          }
          : m,
      ),
    );
    pendingAssistantIdRef.current = null;
    pendingRequestIdRef.current = null;
  }, [clearGenerationWatchdog]);

  const handleNewProject = () => {
    const req = pendingRequestIdRef.current;
    if (req) {
      getSocket().emit('stop_generation', { request_id: req });
    }
    clearGenerationWatchdog();
    // Cancel any in-flight diff animation from the project being left behind.
    animationTokenRef.current += 1;
    isModifyTurnRef.current = false;
    preEditHtmlRef.current = null;
    receivedPatchAppliedRef.current = false;
    patchAnimationChainRef.current = Promise.resolve();
    latestPatchStepRef.current = 0;
    pendingAssistantIdRef.current = null;
    pendingRequestIdRef.current = null;
    // Clear all project-specific refs so stale data can never bleed into the new session.
    projectPbIdRef.current = null;
    loadedProjectKeyRef.current = null;
    chatStickBottomRef.current = true;
    codeStickBottomRef.current = true;

    // Always reset project name regardless of whether a URL slug is present.
    setProjectName(null);
    setStatus('completed');
    setProjectLoadStatus(null);
    setMobileShowPreview(false);
    // Clear saved prompt and last-slug so returning to /chat starts fresh.
    clearPrompt(projectIdFromUrlRef.current?.trim());
    clearLastChatSlug();
    setChatInput('');
    htmlSourceRef.current = '';
    setHtmlSource('');
    setChatMessages([]);
    setIframeKey((k) => k + 1);
    router.push('/chat', { scroll: false });
  };

  const busy =
    chatMessages.some((m) => m.id.startsWith('pending-')) ||
    ctxProjectStatus === 'generating' ||
    projectLoadStatus === 'generating';

  const handleSubmit = async (textOverride?: string, filesOverride?: File[]) => {
    const text = (textOverride !== undefined ? textOverride : chatInput).trim();
    // Removed strict !text block here since we might only be sending attachments
    // Use the ref so this works when called directly from the connect handler
    // before the wsConnected state update has been committed.
    if (!wsConnectedRef.current) return;
    if (busy) return;
    if (submitInFlightRef.current) return;

    // Unlock the shared AudioContext now, synchronously inside this
    // user-gesture-triggered handler, so the completion chime can play
    // later (once generation finishes) without hitting autoplay blocks.
    unlockAudio();

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      // ── Credit pre-check ────────────────────────────────────────────────────
      // Do this before touching any state so we can bail cleanly.
      if (pb.authStore.isValid) {
        try {
          const creditRes = await fetch('/api/user/check-credits');
          if (creditRes.ok) {
            const creditData = (await creditRes.json()) as {
              canGenerate: boolean;
              plan: 'free' | 'pro';
              autoReloadEnabled: boolean;
              availableCredits: number;
            };
            if (!creditData.canGenerate) {
              blockedPromptRef.current = text;
              submitInFlightRef.current = false;
              if (creditData.plan === 'free') {
                setShowSubscriptionPopup(true);
              } else {
                setShowAutoReloadDialog(true);
              }
              return;
            }
          }
        } catch {
          // Fail open — don't block generation on a network error
        }
      }
      // ────────────────────────────────────────────────────────────────────────
      const urlName = projectIdFromUrl?.trim()
        ? decodeURIComponent(projectIdFromUrl.trim()).trim()
        : '';

      // Only reuse an existing name when there is a matching URL slug.
      // When starting fresh (/chat with no slug), always generate a new name
      // so a stale projectName from a previous session can never bleed in.
      let resolvedProjectName = urlName ? projectName?.trim() || '' : '';

      if (urlName) {
        resolvedProjectName = urlName;
      } else if (!resolvedProjectName) {
        let name = '';
        try {
          const res = await fetch('/api/random-project-name');
          if (res.ok) {
            const data = (await res.json()) as { name?: string };
            if (typeof data.name === 'string' && data.name.trim()) {
              name = data.name.trim();
            }
          }
        } catch {
          /* ignore */
        }
        if (!name) {
          name = `project-${Date.now().toString(36)}`;
        }
        resolvedProjectName = name;
        setProjectName(name);
      }

      projectNameRef.current = resolvedProjectName;

      let pocketbaseProjectId: string | undefined;
      if (pb.authStore.isValid && resolvedProjectName) {
        try {
          const res = await fetch('/api/projects/create', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: resolvedProjectName,
              visibility: chatVisibility,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { id?: string };
            if (typeof data.id === 'string' && data.id.trim()) {
              pocketbaseProjectId = data.id.trim();
              projectPbIdRef.current = pocketbaseProjectId;
            }
          }
        } catch {
          /* non-blocking */
        }
      }

      const urlSlug = projectIdFromUrl?.trim();
      if (!urlSlug && resolvedProjectName) {
        startTransition(() => {
          routerRef.current.replace(
            `/chat/${encodeURIComponent(resolvedProjectName)}`,
            { scroll: false },
          );
        });
      }

      // Snapshot attachments before clearing state
      const pendingFiles = filesOverride || [...chatAttachments];

      // Build optimistic local previews (blob URLs) so attachments show immediately
      type LocalAttachment = AttachmentMeta & { objectUrl?: string };
      const localAttachments: LocalAttachment[] = pendingFiles.map((f) => {
        const objectUrl = URL.createObjectURL(f);
        return {
          name: f.name,
          url: objectUrl,
          mimeType: f.type || 'application/octet-stream',
          objectUrl,
        };
      });

      const userContent = text;

      const t = Date.now();
      const pendingId = `pending-${t}`;
      const requestId = `req-${t}`;

      // Snapshot pre-edit state before anything else changes: a non-empty
      // htmlSource means this is a modify turn (2nd+ prompt) editing an
      // existing project, which drives the diff-typewriter animation once
      // generation finishes. Bumping the token here cancels any animation
      // still playing from a previous turn.
      animationTokenRef.current += 1;
      isModifyTurnRef.current = htmlSourceRef.current.trim().length > 0;
      preEditHtmlRef.current = htmlSourceRef.current;
      receivedPatchAppliedRef.current = false;
      patchAnimationChainRef.current = Promise.resolve();
      latestPatchStepRef.current = 0;
      // Let this turn's first preview update land immediately rather than
      // inheriting the throttle window from whatever the last turn did.
      lastPreviewFlushAtRef.current = 0;

      pendingAssistantIdRef.current = pendingId;
      pendingRequestIdRef.current = requestId;
      firstCodeChunkRef.current = false;
      setStatus('generating');
      setProjectLoadStatus('generating');
      setViewMode('code');

      const socket = getSocket();
      if (!socket.connected) {
        socket.connect();
      }

      codeStickBottomRef.current = true;

      flushSync(() => {
        // Keep the existing HTML visible until the first code_chunk arrives
        // so the user still sees the previous result even if generation fails.
        setChatMessages((prev) => [
          ...prev,
          {
            id: `user-${t}`,
            type: 'user',
            content: userContent,
            timestamp: new Date(),
            attachments: localAttachments.length > 0 ? localAttachments : undefined,
          },
          {
            id: pendingId,
            type: 'assistant',
            content: '',
            timestamp: new Date(),
            thinking: '',
          },
        ]);
      });
      setChatInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setChatAttachments([]);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
      clearPrompt(projectIdFromUrlRef.current?.trim());
      clearGenerationWatchdog();
      generationWatchdogRef.current = setTimeout(() => {
        generationWatchdogRef.current = null;
        if (pendingRequestIdRef.current !== requestId) return;
        const aid = pendingAssistantIdRef.current;
        if (!aid) return;
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === aid
              ? {
                ...m,
                id: `assistant-${Date.now()}`,
                content:
                  'No response from the server. Run `npm run dev:ws` (port 5000) and ensure `NEXT_PUBLIC_WS_URL` matches, then try again.',
              }
              : m,
          ),
        );
        pendingAssistantIdRef.current = null;
        pendingRequestIdRef.current = null;
        setStatus('completed');
        setProjectLoadStatus('completed');
        setHtmlSource((h) => {
          const next = h.length > 0 ? h : '';
          htmlSourceRef.current = next;
          return next;
        });
      }, 30000);

      // If there are attachments and we have a project, create the user message
      // client-side (multipart) so the files are persisted before socket emit.
      let preCreatedUserMessageId: string | undefined;
      if (pendingFiles.length > 0 && pocketbaseProjectId && pb.authStore.isValid) {
        try {
          const msgForm = new FormData();
          msgForm.set('project_id', pocketbaseProjectId);
          msgForm.set('role', 'user');
          msgForm.set('content', userContent);
          msgForm.set('request_id', requestId);
          for (const f of pendingFiles) {
            msgForm.append('attachments', f, f.name);
          }
          const msgRes = await fetch('/api/projects/messages/create', {
            method: 'POST',
            body: msgForm,
            credentials: 'include',
          });
          if (msgRes.ok) {
            const msgData = (await msgRes.json()) as { id?: string };
            if (typeof msgData.id === 'string' && msgData.id.trim()) {
              preCreatedUserMessageId = msgData.id.trim();
            }
          }
        } catch {
          /* non-blocking — best-effort attachment upload */
        }
        // Revoke optimistic blob URLs now that we have real PB URLs
        // (the chat will refresh from DB after generation_done)
        for (const la of localAttachments) {
          if (la.objectUrl) URL.revokeObjectURL(la.objectUrl);
        }
      }

      // Read every attachment so the AI gets the full context:
      //   • images   → raw base64 (sent as multimodal vision blocks)
      //   • all else → UTF-8 text (appended inline to the prompt)
      // Large text files are truncated to 50 000 characters to stay within
      // model context limits.
      const TEXT_TRUNCATE = 50_000;
      type AiAttachment =
        | { kind: 'image'; name: string; mimeType: string; base64: string }
        | { kind: 'text';  name: string; mimeType: string; text: string };
      const aiAttachments: AiAttachment[] = [];

      for (const f of pendingFiles) {
        try {
          if (f.type.startsWith('image/')) {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1] ?? '');
              };
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
            aiAttachments.push({ kind: 'image', name: f.name, mimeType: f.type, base64 });
          } else {
            const text = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve((reader.result as string) ?? '');
              reader.onerror = reject;
              reader.readAsText(f);
            });
            aiAttachments.push({
              kind: 'text',
              name: f.name,
              mimeType: f.type || 'text/plain',
              text: text.length > TEXT_TRUNCATE
                ? text.slice(0, TEXT_TRUNCATE) + '\n[...truncated]'
                : text,
            });
          }
        } catch {
          /* non-fatal — skip this attachment if reading fails */
        }
      }

      socket.emit('user_message', {
        text: userContent,
        request_id: requestId,
        ...(pocketbaseProjectId ? { project_id: pocketbaseProjectId } : {}),
        ...(preCreatedUserMessageId ? { user_message_id: preCreatedUserMessageId } : {}),
        attachments: aiAttachments,
      });

      // Deduct credit and trigger auto-reload if needed (fire-and-forget)
      void (async () => {
        try {
          const res = await fetch('/api/user/deduct-credit', { method: 'POST' });
          if (!res.ok) return;
          const data = (await res.json()) as {
            creditsRemaining: number;
            autoReloaded: boolean;
            creditsAdded?: number;
            autoReloadError?: string;
            insufficientCredits: boolean;
          };

          // Auto-reload: charge silently — no notification per product design.
          // Only surface failures so the user knows to act.
          if (data.autoReloadError) {
            toast.warning(`Auto-reload failed: ${data.autoReloadError}`);
          } else if (data.insufficientCredits) {
            // Shouldn't reach here (pre-check guards against it), but handle defensively.
            toast.warning('Out of credits. Please top up to continue generating.');
          } else if (!data.autoReloaded && data.creditsRemaining <= 100) {
            toast.info(`${data.creditsRemaining} credit${data.creditsRemaining === 1 ? '' : 's'} remaining`);
          }
        } catch {
          // silent — credit deduction failure should not disrupt the UX
        }
      })();
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };


  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setChatInput(value);
    savePrompt(projectIdFromUrl?.trim(), value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const MAX_ATTACHMENT_FILES = 5;
  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;

    const oversized = selected.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length) {
      toast.error(
        `${oversized.map((f) => f.name).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 5 MB limit and will not be attached.`,
      );
    }
    const valid = selected.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);

    setChatAttachments((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_ATTACHMENT_FILES) {
        toast.error(`You can attach up to ${MAX_ATTACHMENT_FILES} files. Extra files were removed.`);
        return combined.slice(0, MAX_ATTACHMENT_FILES);
      }
      return combined;
    });
    // Reset so the same file can be picked again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (attachment: AttachmentMeta) => {
    setChatAttachments((prev) =>
      prev.filter((f) => f.name !== attachment.name || f.size !== attachment.size),
    );
  };



  const handleVisibilityChange = async (newVisibility: VisibilityOption) => {
    if (newVisibility === chatVisibility) return;

    const userId = pb.authStore.model?.id;
    if (!userId) return;

    if (newVisibility === "private") {
      const res = await fetch("/api/subscription/can-create-private", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!data.canCreatePrivate) {
        setSubscriptionReason("private_project");
        setShowSubscriptionPopup(true);
        return;
      }
    }

    const previousVisibility = chatVisibility;
    setChatVisibility(newVisibility);

    const projectId = projectPbIdRef.current;
    const username = (pb.authStore.model as { username?: string } | null)?.username;
    const resolvedName =
      projectNameRef.current?.trim() ||
      projectName?.trim() ||
      (projectIdFromUrl ? decodeURIComponent(projectIdFromUrl.trim()) : '');

    if (!projectId || !username || !resolvedName) {
      showToast({
        title: "Visibility updated",
        description: `New projects will be created as ${newVisibility}.`,
      });
      return;
    }

    try {
      const res = await fetch("/api/projects/update-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: `${username}/${resolvedName}`,
          visibility: newVisibility,
          userId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setChatVisibility(previousVisibility);
        showToastError(data.error, "Failed to update visibility.");
      } else {
        showToast({
          title: "Visibility updated",
          description: `Project is now ${newVisibility}.`,
        });
      }
    } catch {
      setChatVisibility(previousVisibility);
      showToastError(null, "Failed to update visibility.");
    }
  };

  const hasProject = !!projectName?.trim();
  const pendingAssistantId =
    chatMessages.find((m) => m.id.startsWith('pending-'))?.id ?? null;
  const hasLocalPendingTurn = pendingAssistantId !== null;
  const remoteGenerationSuggested =
    !hasLocalPendingTurn &&
    (projectLoadStatus === 'generating' ||
      ctxProjectStatus === 'generating');
  const canStartNewProject =
    !!projectIdFromUrl ||
    chatMessages.length > 0 ||
    !!htmlSource.trim() ||
    hasProject;

  return (
    <div className="flex h-screen flex-col bg-background">
      <Sidebar />
      <NavigationBar variant="chat" />
      <div className="flex h-full flex-col lg:flex-row md:ml-16 overflow-hidden">
        <div className={cn(
          "w-full lg:w-96 flex-col h-full border-r border-border bg-card overflow-hidden",
          mobileShowPreview ? "hidden lg:flex" : "flex",
        )}>
          <div className="flex items-center justify-between border-b border-border px-4 h-14 flex-shrink-0 m-0">
            {hasProject ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {projectName}
                </span>
                {!wsConnected ? (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-destructive/15 text-destructive"
                    title="Check your internet connection. Refresh the page if you think it's an issue."
                  >
                    Offline
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">
                New Project
              </span>
            )}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleNewProject}
                disabled={!canStartNewProject}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New</span>
              </Button>
            </div>
          </div>

          <div
            ref={chatContainerRef}
            onScroll={onChatScroll}
            className="flex-1 overflow-y-auto min-h-0"
          >
            {chatMessages.length === 0 && !busy ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-6 flex items-center justify-center">
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                    <div className="relative flex items-center justify-center h-20 w-20 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                      <Rocket className="h-10 w-10 text-primary" />
                    </div>
                  </div>
                </div>
                <h3 className="font-semibold text-base mb-2 text-foreground">
                  What do you want to build?
                </h3>
                <p className="text-sm text-muted-foreground max-w-[260px] leading-relaxed">
                  Describe your idea, whether it&apos;s a website, app, dashboard, or anything else, and watch it come to life.
                </p>

                {authResolved &&
                  projectIdFromUrl?.trim() &&
                  !sessionAuthed ? (
                  <p className="mt-3 text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                    Sign in to load your saved project.
                  </p>
                ) : null}
              </div>
            ) : (
              <ChatMessages
                messages={chatMessages}
                pendingStreamingAssistantId={pendingAssistantId}
                generationActive={hasLocalPendingTurn}
                remoteGenerationSuggested={remoteGenerationSuggested}
              />
            )}
          </div>

          <div className="border-t border-border p-4 pb-20 md:pb-4 flex-shrink-0">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              disabled={busy || !wsConnected || chatAttachments.length >= MAX_ATTACHMENT_FILES}
            />
            <div className="relative group">
              <div className="bg-white dark:bg-black border-2 border-border rounded-2xl p-3 sm:p-4 transition-all duration-300 flex flex-col">
                {/* Attachment preview strip */}
                {chatAttachments.length > 0 && (
                  <div className="px-1 pt-1">
                    <AttachmentPreviews
                      attachments={attachmentMetas}
                      onRemove={removeAttachment}
                      variant="input"
                    />
                  </div>
                )}
                <div className="mb-3">
                  <Textarea
                    ref={textareaRef}
                    value={chatInput}
                    onChange={handleTextareaChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSubmit();
                      }
                    }}
                    placeholder={
                      hasProject
                        ? 'Describe changes...'
                        : 'What do you want to build?'
                    }
                    className="w-full min-h-[40px] max-h-[150px] bg-transparent border-0 text-sm sm:text-base text-black dark:text-white placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 resize-none overflow-y-auto"
                    disabled={busy || !wsConnected}
                  />
                </div>
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    {/* Paperclip button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy || !wsConnected || chatAttachments.length >= MAX_ATTACHMENT_FILES}
                      title={chatAttachments.length >= MAX_ATTACHMENT_FILES ? 'Maximum 5 attachments reached' : 'Attach files (max 5, 5 MB each)'}
                      className="flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <VisibilityDropdown
                      value={chatVisibility}
                      onValueChange={handleVisibilityChange}
                      disabled={busy || !wsConnected}
                      side="top"
                    />
                  </div>
                  {busy ? (
                    <Button
                      type="button"
                      onClick={handleStopGeneration}
                      variant="outline"
                      size="icon"
                      title="Stop generation"
                      className="rounded-full h-8 w-8 sm:h-10 sm:w-10 border-destructive/60 text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/15"
                    >
                      <Square className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => void handleSubmit()}
                      disabled={
                        isSubmitting ||
                        !wsConnected ||
                        (!chatInput.trim() && chatAttachments.length === 0)
                      }
                      variant="default"
                      size="icon"
                      className="rounded-full h-8 w-8 sm:h-10 sm:w-10 bg-black dark:bg-white text-white dark:text-black hover:bg-black/70 dark:hover:bg-white/70"
                    >
                      {isSubmitting
                        ? <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                        : <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
                      }
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          id="preview-container"
          className={cn(
            "relative flex-1 flex-col min-h-0 bg-card overflow-hidden pt-14",
            mobileShowPreview ? "flex" : "hidden lg:flex",
          )}
        >
          {viewMode === 'code' ? (
            <div className="flex h-full w-full flex-col min-h-0 p-4 pb-20 md:pb-4">
              <div
                ref={codeScrollRef}
                onScroll={onCodeScroll}
                className="flex-1 min-h-0 overflow-auto rounded-lg bg-muted/30 p-3 sm:p-4 dark:bg-muted/20"
              >
                {htmlSource.trim() ? (
                  <CodeHighlight code={htmlSource} language="html" />
                ) : (
                  <div className="flex h-full min-h-[320px] flex-col items-center justify-center p-6 select-none">
                    {/* Browser window illustration */}
                    <div className="w-full max-w-[260px] mb-6">
                      {/* Browser chrome */}
                      <div className="flex items-center gap-2 rounded-t-xl border border-border bg-muted/50 px-3 py-2">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/20" />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/20" />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/20" />
                        <div className="ml-2 flex-1 h-3.5 rounded-full bg-muted/70 border border-border" />
                      </div>
                      {/* Page layout skeleton */}
                      <div className="rounded-b-xl border border-t-0 border-border bg-background/60 p-3 space-y-2.5">
                        {/* Nav bar */}
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded bg-primary/20" />
                          <div className="h-2 flex-1 rounded-full bg-muted/60" />
                          <div className="h-5 w-10 rounded-full bg-primary/15 border border-primary/20" />
                        </div>
                        {/* Hero */}
                        <div className="h-20 rounded-lg bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 flex flex-col items-center justify-center gap-1.5 p-3">
                          <div className="h-2.5 w-3/4 rounded-full bg-primary/20" />
                          <div className="h-2 w-1/2 rounded-full bg-primary/10" />
                          <div className="mt-1 h-4 w-16 rounded-full bg-primary/20 border border-primary/20" />
                        </div>
                        {/* Cards row */}
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="h-8 rounded-lg bg-muted/50 border border-border" />
                          <div className="h-8 rounded-lg bg-muted/50 border border-border" />
                          <div className="h-8 rounded-lg bg-muted/50 border border-border" />
                        </div>
                        {/* Footer */}
                        <div className="h-2.5 rounded-full bg-muted/30 border border-border" />
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-foreground mb-1.5">
                      Your app will appear here
                    </h3>
                    <p className="text-xs text-muted-foreground/70 text-center max-w-[210px] leading-relaxed">
                      Describe what you want to build and watch it come to life
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-muted/30 p-4 pb-20 md:pb-4">
              {previewUrl ? (
                <div
                  id="iframe-container"
                  className={cn(
                    'h-full overflow-hidden rounded-lg transition-all duration-300',
                    deviceSize === 'desktop' && 'w-full',
                    deviceSize !== 'desktop' && 'mx-auto',
                  )}
                  style={{
                    width:
                      deviceSize === 'desktop' ? '100%' : deviceSizes[deviceSize],
                    maxWidth: '100%',
                    backgroundColor: 'white',
                    colorScheme: 'light',
                  }}
                >
                  <iframe
                    key={iframeKey}
                    src={previewUrl}
                    className="w-full h-full border-0"
                    title="Preview"
                    style={{ backgroundColor: 'white', colorScheme: 'light' }}
                    sandbox="allow-scripts allow-forms allow-popups"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-8 select-none">
                  {/* Phone/screen mockup */}
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-primary/10 rounded-3xl blur-2xl animate-pulse" />
                    <div className="relative w-28 rounded-2xl border-2 border-border bg-background overflow-hidden">
                      {/* Status bar */}
                      <div className="h-2 bg-muted/60" />
                      {/* Screen content skeleton */}
                      <div className="bg-gradient-to-b from-primary/5 to-transparent p-2 space-y-1.5">
                        <div className="h-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/10" />
                        <div className="h-2 w-3/4 rounded-full bg-muted/50" />
                        <div className="h-2 w-1/2 rounded-full bg-muted/40" />
                        <div className="grid grid-cols-2 gap-1 mt-0.5">
                          <div className="h-5 rounded bg-muted/40 border border-border" />
                          <div className="h-5 rounded bg-muted/40 border border-border" />
                        </div>
                        <div className="h-2 w-2/3 rounded-full bg-muted/30" />
                      </div>
                      {/* Bottom bar */}
                      <div className="h-1.5 bg-muted/30" />
                    </div>
                  </div>
                  <h3 className="font-semibold text-base mb-2 text-foreground">
                    Nothing to preview yet
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed">
                    Start a conversation and your creation will come to life here.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Credit gate dialogs */}
      <SubscriptionPopup
        open={showSubscriptionPopup}
        onOpenChange={setShowSubscriptionPopup}
        reason={subscriptionReason}
        returnTo={
          projectIdFromUrl?.trim()
            ? `/chat/${encodeURIComponent(decodeURIComponent(projectIdFromUrl.trim()))}`
            : "/chat"
        }
        pendingPrompt={blockedPromptRef.current ?? chatInput ?? ""}
        pendingVisibility={chatVisibility}
      />
      <AutoReloadDialog
        open={showAutoReloadDialog}
        onOpenChange={setShowAutoReloadDialog}
      />
    </div>
  );
}
