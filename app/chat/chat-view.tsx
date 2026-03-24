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
  Plus,
  Rocket,
  Eye,
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
import pb from '@/lib/pocketbase';
import { SUBSCRIPTION_RESUME_KEY, SubscriptionPopup, type SubscriptionResumeData } from '@/components/SubscriptionPopup';
import { AutoReloadDialog } from '@/components/AutoReloadDialog';
import { clearLastChatSlug } from '@/app/chat/chat-shell';
import { toast } from 'sonner';
import * as htmlToImage from 'html-to-image';

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
  const [prompt, setPrompt] = useState('');
  const [visibility, setVisibility] = useState<VisibilityOption>('public');
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
  const submitInFlightRef = useRef(false);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  // File attachments state
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const htmlSourceRef = useRef('');
  const projectNameRef = useRef<string | null>(null);
  const projectPbIdRef = useRef<string | null>(null);
  // Holds a message typed on the home page that should be auto-submitted once
  // the socket connects on the /chat page.
  const autoSubmitMessageRef = useRef<string | null>(null);
  const autoSubmitVisibilityRef = useRef<VisibilityOption>('public');
  const projectIdFromUrlRef = useRef<string | undefined>(projectIdFromUrl);
  const routerRef = useRef(router);
  const wsConnectedRef = useRef(false);
  const sessionAuthedRef = useRef(false);

  const [projectLoadStatus, setProjectLoadStatus] = useState<string | null>(
    null,
  );
  const [attachmentMetas, setAttachmentMetas] = useState<AttachmentMeta[]>([]);

  useEffect(() => {
    const metas = attachments.map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
      mimeType: f.type,
      size: f.size,
    }));
    setAttachmentMetas(metas);
    return () => {
      metas.forEach((m) => URL.revokeObjectURL(m.url));
    };
  }, [attachments]);

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
    pendingSubmission,
    clearPendingSubmission,
  } = useProject();

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
            setVisibility('private');
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

  const capturePreview = useCallback(() => {
    // Capture preview after layout is ready
    setTimeout(async () => {
      try {
        const pbId = projectPbIdRef.current;
        if (!pbId || !sessionAuthedRef.current) return;

        const iframe = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement;
        if (!iframe || !iframe.contentWindow?.document.body) return;

        const body = iframe.contentWindow.document.body;
        const dataUrl = await htmlToImage.toJpeg(body, {
          quality: 0.8,
          backgroundColor: '#ffffff',
          height: 720,
          width: 1280,
          style: { overflow: 'hidden' }
        });

        const res = await fetch(dataUrl);
        const blob = await res.blob();

        const formData = new FormData();
        formData.append('project_id', pbId);
        formData.append('preview', blob, 'preview.jpg');

        const uploadRes = await fetch('/api/projects/preview', {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok) {
          console.warn("Failed to upload project preview via API");
        }
      } catch (err) {
        console.warn("Failed to capture project preview:", err);
      }
    }, 3000);
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
    if (saved) setPrompt(saved);
    // Only run when the slug first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdFromUrl]);

  // On mount, capture any pending message to auto-submit once the socket connects.
  // Sources (checked in priority order):
  //   1. localStorage subscription resume — user returned after subscribing
  //   2. pendingSubmission context    — user navigated from the home page
  // Only applies to a fresh /chat (no existing project in the URL).
  useEffect(() => {
    if (projectIdFromUrl?.trim()) return;

    // 1. Subscription resume: user went through Stripe and came back to /chat
    try {
      const raw = localStorage.getItem(SUBSCRIPTION_RESUME_KEY);
      if (raw) {
        const data = JSON.parse(raw) as SubscriptionResumeData;
        if (data.returnTo === '/chat' && data.pendingPrompt?.trim()) {
          autoSubmitMessageRef.current = data.pendingPrompt.trim();
          autoSubmitVisibilityRef.current =
            (data.pendingVisibility as VisibilityOption) ?? 'public';
          localStorage.removeItem(SUBSCRIPTION_RESUME_KEY);
          return;
        }
      }
    } catch {
      // ignore
    }

    // 2. Normal home → chat navigation via context
    const msg = pendingSubmission.message?.trim();
    if (!msg) return;
    autoSubmitMessageRef.current = msg;
    autoSubmitVisibilityRef.current =
      (pendingSubmission.visibility as VisibilityOption) ?? 'public';
    clearPendingSubmission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // When the socket connects, fire the pending auto-submit from the home page.
  useEffect(() => {
    if (!wsConnected) return;
    const msg = autoSubmitMessageRef.current;
    if (!msg) return;
    autoSubmitMessageRef.current = null;
    setVisibility(autoSubmitVisibilityRef.current);
    void handleSubmit(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected]); // handleSubmit intentionally omitted — uses wsConnectedRef internally

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
    (data: ProjectLoadPayload, options?: { force?: boolean }) => {
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
        if (typeof data.html === 'string') {
          htmlSourceRef.current = data.html;
          setHtmlSource(data.html);
        }
        if (
          data.project?.visibility === 'public' ||
          data.project?.visibility === 'private'
        ) {
          setVisibility(data.project.visibility as VisibilityOption);
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

        // Auto-generate preview if missing and project is completed
        if (!data.project?.preview && st === 'completed' && typeof data.html === 'string' && data.html.trim().length > 0) {
          capturePreview();
        }
      }
    },
    [clearGenerationWatchdog, setStatus, setVisibility, capturePreview],
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

  useEffect(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    if (!htmlSource.trim()) {
      setPreviewUrl(null);
      return;
    }
    // Inject forced light-mode isolation. We surgically inject into the head if it exists to maintain valid HTML structure.
    const isolationSnippet = `<meta name="color-scheme" content="light"><style>:root { color-scheme: light !important; } body { background-color: white; color: black; margin: 0; min-height: 100vh; }</style>`;
    let isolatedHtml = htmlSource;
    if (htmlSource.includes('<head>')) {
      isolatedHtml = htmlSource.replace('<head>', '<head>' + isolationSnippet);
    } else if (htmlSource.includes('<html>')) {
        isolatedHtml = htmlSource.replace('<html>', '<html><head>' + isolationSnippet + '</head>');
    } else {
      isolatedHtml = isolationSnippet + htmlSource;
    }
    const blob = new Blob([isolatedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    previewObjectUrlRef.current = url;
    setPreviewUrl(url);
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, [htmlSource, setPreviewUrl]);

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
      setStatus('generating');
      setProjectLoadStatus('generating');
      clearGenerationWatchdog();
    };

    const onThinkingChunk = (payload: {
      request_id: string;
      chunk: string;
    }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
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

    const onCodeChunk = (payload: { request_id: string; chunk: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      setHtmlSource((prev) => {
        const next = prev + payload.chunk;
        htmlSourceRef.current = next;
        return next;
      });
    };

    const onAssistantReply = (payload: {
      request_id: string;
      message: string;
    }) => {
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

    const onGenerationDone = (payload: { request_id: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      if (!pendingAssistantIdRef.current) return;
      finalizePending();
      setIframeKey((k) => k + 1);
      setViewMode('preview');
      void (async () => {
        const data = await fetchProjectLoadData();
        if (!data || data === 'not-found') return;
        applyProjectLoad(data, { force: true });
      })();

      // Capture preview after layout is ready
      capturePreview();
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
    socket.on('code_chunk', onCodeChunk);
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
      socket.off('code_chunk', onCodeChunk);
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
    // Clear saved prompt and last-slug so returning to /chat starts fresh.
    clearPrompt(projectIdFromUrlRef.current?.trim());
    clearLastChatSlug();
    setPrompt('');
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

  const handleSubmit = async (textOverride?: string) => {
    const text = (textOverride !== undefined ? textOverride : prompt).trim();
    if (!text) return;
    // Use the ref so this works when called directly from the connect handler
    // before the wsConnected state update has been committed.
    if (!wsConnectedRef.current) return;
    if (busy) return;
    if (submitInFlightRef.current) return;

    submitInFlightRef.current = true;
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
              visibility,
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
      const pendingFiles = [...attachments];

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

      pendingAssistantIdRef.current = pendingId;
      pendingRequestIdRef.current = requestId;
      setStatus('generating');
      setProjectLoadStatus('generating');

      const socket = getSocket();
      if (!socket.connected) {
        socket.connect();
      }

      codeStickBottomRef.current = true;

      flushSync(() => {
        htmlSourceRef.current = '';
        setHtmlSource('');
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
      setPrompt('');
      setAttachments([]);
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

      socket.emit('user_message', {
        text: userContent,
        request_id: requestId,
        ...(pocketbaseProjectId ? { project_id: pocketbaseProjectId } : {}),
        ...(preCreatedUserMessageId ? { user_message_id: preCreatedUserMessageId } : {}),
        attachments: pendingFiles.map((f) => ({ name: f.name, size: f.size })),
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
    }
  };


  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPrompt(value);
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

    setAttachments((prev) => {
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
    setAttachments((prev) =>
      prev.filter((f) => f.name !== attachment.name || f.size !== attachment.size),
    );
  };



  const handleVisibilityChange = async (newVisibility: VisibilityOption) => {
    if (newVisibility === "private") {
      const userId = pb.authStore.record?.id;
      if (!userId) return;

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
    setVisibility(newVisibility);
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
      <div className="flex h-full flex-col lg:flex-row md:ml-16">
        <div className="w-full lg:w-96 flex flex-col h-full border-r border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 h-14 flex-shrink-0 m-0">
            {hasProject ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {projectName}
                </span>
                {!wsConnected ? (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-destructive/15 text-destructive"
                    title="Start: npm run dev:ws (port 5000)"
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewProject}
              disabled={!canStartNewProject}
              className="h-7 gap-1.5 px-2 text-xs flex-shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Project</span>
            </Button>
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
                  Describe your idea — a landing page, portfolio, dashboard, or
                  anything else — and watch it come to life.
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

          <div className="border-t border-border p-4 flex-shrink-0">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              disabled={busy || !wsConnected || attachments.length >= MAX_ATTACHMENT_FILES}
            />
            <div className="relative group">
              <div className="bg-white dark:bg-black border-2 border-border rounded-2xl p-3 sm:p-4 transition-all duration-300 flex flex-col">
                {/* Attachment preview strip */}
                {attachments.length > 0 && (
                  <div className="px-1 pt-1">
                    <AttachmentPreviews
                      attachments={attachmentMetas}
                      onRemove={removeAttachment}
                    />
                  </div>
                )}
                <div className="flex-1 mb-3 min-h-0">
                  <Textarea
                    ref={textareaRef}
                    value={prompt}
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
                    className="w-full h-full bg-transparent border-0 text-sm sm:text-base text-black dark:text-white placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                    disabled={busy || !wsConnected}
                  />
                </div>
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    {/* Paperclip button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy || !wsConnected || attachments.length >= MAX_ATTACHMENT_FILES}
                      title={attachments.length >= MAX_ATTACHMENT_FILES ? 'Maximum 5 attachments reached' : 'Attach files (max 5, 5 MB each)'}
                      className="flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <VisibilityDropdown
                      value={visibility}
                      onValueChange={handleVisibilityChange}
                      disabled={busy || !wsConnected}
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
                        !wsConnected ||
                        (!prompt.trim() && attachments.length === 0)
                      }
                      variant="default"
                      size="icon"
                      className="rounded-full h-8 w-8 sm:h-10 sm:w-10 bg-black dark:bg-white text-white dark:text-black hover:bg-black/70 dark:hover:bg-white/70"
                    >
                      <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          id="preview-container"
          className="flex-1 flex flex-col min-h-0 bg-card overflow-hidden pt-14"
        >
          {viewMode === 'code' ? (
            <div className="flex h-full w-full flex-col min-h-0 p-4">
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
            <div className="h-full w-full flex items-center justify-center bg-muted/30 p-4">
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
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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
        returnTo={`/chat/${projectIdFromUrl ?? ''}`}
        pendingPrompt={blockedPromptRef.current ?? prompt ?? ''}
        pendingVisibility={visibility}
      />
      <AutoReloadDialog
        open={showAutoReloadDialog}
        onOpenChange={setShowAutoReloadDialog}
      />
    </div>
  );
}
