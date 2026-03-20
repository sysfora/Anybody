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
  Paperclip,
  X,
  FileText,
  Image,
  File,
  Plus,
  Rocket,
  Eye,
  Square,
} from 'lucide-react';
import { Sidebar } from '@/components/Dashboard/Sidebar';
import { NavigationBar } from '@/components/NavigationBar';
import {
  ChatMessages,
  type ChatMessage,
} from '@/components/Dashboard/ChatMessages';
import { CodeHighlight } from '@/components/Dashboard/CodeHighlight';
import { useProject, type ProjectStatus } from '@/context/ProjectContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { VisibilityDropdown, type VisibilityOption } from '@/components/ui/visibility-dropdown';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import pb from '@/lib/pocketbase';

interface AttachedFile {
  file: File;
  preview?: string;
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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [visibility, setVisibility] = useState<VisibilityOption>('public');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [htmlSource, setHtmlSource] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);
  const chatStickBottomRef = useRef(true);
  const codeStickBottomRef = useRef(true);
  const previewObjectUrlRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);
  const generationWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const htmlSourceRef = useRef('');
  const projectNameRef = useRef<string | null>(null);
  const projectPbIdRef = useRef<string | null>(null);
  const projectIdFromUrlRef = useRef<string | undefined>(projectIdFromUrl);
  const routerRef = useRef(router);
  const wsConnectedRef = useRef(false);
  const sessionAuthedRef = useRef(false);

  const [projectLoadStatus, setProjectLoadStatus] = useState<string | null>(
    null,
  );

  const {
    projectName,
    setProjectName,
    setUserId,
    setStatus,
    status: ctxProjectStatus,
    setPreviewUrl,
    viewMode,
    deviceSize,
    previewUrl,
    setRefreshCallback,
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

  useEffect(() => {
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
      setStatus('completed');
      setProjectLoadStatus(null);
    }
  }, [projectIdFromUrl, setProjectName, setStatus]);

  const loadedProjectKeyRef = useRef<string | null>(null);

  const fetchProjectLoadData =
    useCallback(async (): Promise<ProjectLoadPayload | null> => {
      const raw = projectIdFromUrlRef.current?.trim();
      if (!raw || !sessionAuthedRef.current) return null;
      const decoded = decodeURIComponent(raw);
      try {
        const res = await fetch(
          `/api/projects/load?projectName=${encodeURIComponent(decoded)}`,
          { credentials: 'include' },
        );
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
          rows.map((m) => ({
            id: m.id,
            type: m.role,
            content: m.content ?? '',
            thinking: m.thinking?.trim() ? m.thinking : undefined,
            timestamp: new Date(m.created),
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
      }
    },
    [clearGenerationWatchdog, setStatus, setVisibility],
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
      if (!data) {
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
    const id = setInterval(() => {
      void (async () => {
        const data = await fetchProjectLoadData();
        if (data) applyProjectLoad(data);
      })();
    }, 2000);
    return () => clearInterval(id);
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
    const blob = new Blob([htmlSource], { type: 'text/html' });
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
      void (async () => {
        const data = await fetchProjectLoadData();
        if (!data) return;
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
      void (async () => {
        const data = await fetchProjectLoadData();
        if (data) applyProjectLoad(data, { force: true });
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
        if (data) applyProjectLoad(data, { force: true });
      })();
    };

    const onGenerationStopped = (payload: { request_id: string }) => {
      if (payload.request_id !== pendingRequestIdRef.current) return;
      if (!pendingAssistantIdRef.current) return;
      finalizePending();
      void (async () => {
        const data = await fetchProjectLoadData();
        if (data) applyProjectLoad(data, { force: true });
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
  }, [clearGenerationWatchdog, fetchProjectLoadData, applyProjectLoad]);

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
    chatStickBottomRef.current = true;
    codeStickBottomRef.current = true;

    if (!projectIdFromUrl) {
      setProjectName(null);
    }

    setStatus('completed');
    setProjectLoadStatus(null);
    setPrompt('');
    setAttachedFiles([]);
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

  const handleSubmit = async () => {
    const text = prompt.trim();
    if (!text && attachedFiles.length === 0) return;
    if (!wsConnected) return;
    if (busy) return;
    if (submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    try {
      let resolvedProjectName = projectName?.trim() || '';
      const urlName = projectIdFromUrl?.trim()
        ? decodeURIComponent(projectIdFromUrl.trim()).trim()
        : '';

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

      const userContent =
        text ||
        (attachedFiles.length
          ? `[${attachedFiles.length} file(s) attached — demo]`
          : '');

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
      setAttachedFiles([]);

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

      socket.emit('user_message', {
        text: userContent,
        request_id: requestId,
        ...(pocketbaseProjectId
          ? { project_id: pocketbaseProjectId }
          : {}),
      });
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const handleFileAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const MAX_FILES = 5;

    if (attachedFiles.length + picked.length > MAX_FILES) return;

    const validFiles: AttachedFile[] = [];

    picked.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) return;
      const attachedFile: AttachedFile = { file };
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachedFiles((prev) =>
            prev.map((af) =>
              af.file === file
                ? { ...af, preview: ev.target?.result as string }
                : af,
            ),
          );
        };
        reader.readAsDataURL(file);
      }
      validFiles.push(attachedFile);
    });

    setAttachedFiles((prev) => [...prev, ...validFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <Image className="h-4 w-4" />;
    }
    if (file.type.startsWith('text/')) {
      return <FileText className="h-4 w-4" />;
    }
    return <File className="h-4 w-4" />;
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
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
      <NavigationBar variant="chat" demoMode />
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
                  Ready to build something amazing?
                </h3>
                <p className="text-sm text-muted-foreground max-w-[260px] leading-relaxed">
                  Messages are sent to the Python Socket.IO server; streamed reasoning
                  and HTML appear in the thread and in the code / preview panes.
                </p>
                {!wsConnected ? (
                  <p className="mt-3 text-xs text-destructive max-w-[260px] leading-relaxed">
                    Server offline — run{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                      npm run dev:ws
                    </code>{' '}
                    (see <code className="font-mono text-[11px]">server/README.md</code>
                    ).
                  </p>
                ) : null}
                {authResolved &&
                projectIdFromUrl?.trim() &&
                !sessionAuthed ? (
                  <p className="mt-3 text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                    Sign in to load saved HTML for this project from your account.
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
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt"
            />

            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachedFiles.map((af, index) => (
                  <div
                    key={index}
                    className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted"
                  >
                    {af.preview ? (
                      <NextImage
                        src={af.preview}
                        alt={af.file.name}
                        fill
                        className="rounded-lg object-cover"
                      />
                    ) : (
                      getFileIcon(af.file)
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative group">
              <div className="bg-white dark:bg-black border-2 border-border rounded-2xl p-3 sm:p-4 transition-all duration-300 max-h-[200px] sm:max-h-[250px] flex flex-col">
                <div className="flex-1 mb-3 min-h-0">
                  <Textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={handleTextareaChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
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
                    <button
                      type="button"
                      onClick={handleFileAttach}
                      disabled={busy || !wsConnected}
                      className="flex items-center justify-center p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Paperclip className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground transition-colors" />
                    </button>
                    <VisibilityDropdown
                      value={visibility}
                      onValueChange={setVisibility}
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
                      onClick={handleSubmit}
                      disabled={
                        !wsConnected ||
                        (!prompt.trim() && attachedFiles.length === 0)
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
                  <p className="text-sm text-muted-foreground">
                    Generated HTML from the server will stream here after you send a
                    message.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-muted/30 p-4">
              {previewUrl ? (
                <div
                  id="iframe-container"
                  className={cn(
                    'h-full overflow-hidden rounded-lg bg-background transition-all duration-300',
                    deviceSize === 'desktop' && 'w-full',
                    deviceSize !== 'desktop' && 'mx-auto',
                  )}
                  style={{
                    width:
                      deviceSize === 'desktop' ? '100%' : deviceSizes[deviceSize],
                    maxWidth: '100%',
                  }}
                >
                  <iframe
                    key={iframeKey}
                    src={previewUrl}
                    className="w-full h-full border-0"
                    title="Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-8">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl animate-pulse" />
                    <div className="relative flex items-center justify-center">
                      <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center">
                        <Eye className="h-10 w-10 text-primary/60" />
                      </div>
                    </div>
                  </div>
                  <h3 className="font-semibold text-base mb-2 text-foreground">
                    No preview yet
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-[280px] leading-relaxed">
                    Preview uses the same HTML as the code panel once the server
                    streams a page.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
