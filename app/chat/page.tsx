'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, Paperclip, X, FileText, Image, File, Loader2, Plus, Rocket, Eye, Code } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import { uploadFiles, cancelProject } from '@/lib/api';
import FileStream from '@/components/FileStream';
import FileTree from '@/components/FileTree';
import { Sidebar } from '@/components/Dashboard/Sidebar';
import { NavigationBar } from '@/components/NavigationBar';
import { ChatMessages, type ChatMessage } from '@/components/Dashboard/ChatMessages';
import { useProject } from '@/context/ProjectContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VisibilityDropdown, type VisibilityOption } from '@/components/ui/visibility-dropdown';
import { SubscriptionPopup } from '@/components/SubscriptionPopup';
import { canCreatePrivateProject } from '@/lib/subscription';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import pb from '@/lib/pocketbase';
import { useRouter, usePathname } from 'next/navigation';

interface StatusUpdate {
  project_id: string;
  step: number;
  message: string;
  timestamp: number;
}

interface FileData {
  filePath: string;
  fileName: string;
  content: string;
  step: number;
  isComplete?: boolean;
  order?: number;
  isBinary?: boolean;
  shouldAnimate?: boolean;
  isAnimating?: boolean;
}

interface AttachedFile {
  file: File;
  preview?: string;
}

const deviceSizes = {
  mobile: '375px',
  tablet: '768px',
  desktop: '100%'
};

export default function Chat({ projectIdFromUrl }: { projectIdFromUrl?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [projectName, setProjectName] = useState('');
  const usernameRef = useRef('');
  const projectNameRef = useRef('');

  // Keep refs in sync with state
  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);
  const [prompt, setPrompt] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [visibility, setVisibility] = useState<VisibilityOption>('public');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);
  const [subscriptionReason, setSubscriptionReason] = useState<"private_project" | "out_of_limits">("out_of_limits");
  const [statuses, setStatuses] = useState<StatusUpdate[]>([]);
  const [files, setFiles] = useState<Map<string, FileData>>(new Map());
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [visibleFiles, setVisibleFiles] = useState<Set<string>>(new Set());
  const [fileOrder, setFileOrder] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [loadedSteps, setLoadedSteps] = useState<any[]>([]);
  const [projectKey, setProjectKey] = useState<string>(''); // Key to force FileStream reset on new project
  const [showUpgradeToProDialog, setShowUpgradeToProDialog] = useState(false);
  const [showAutoReloadDialog, setShowAutoReloadDialog] = useState(false);
  const [showVisibilityConfirmDialog, setShowVisibilityConfirmDialog] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<VisibilityOption | null>(null);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [isProUser, setIsProUser] = useState(false);
  const [creditsEndData, setCreditsEndData] = useState<{
    available_credits?: number;
    required_credits?: number;
    user_plan?: string;
    auto_reload_enabled?: boolean;
  } | null>(null);

  const socketRef = useRef<any>(null);
  const projectIdRef = useRef<string | null>(null);
  const manualSelectionRef = useRef<boolean>(false);
  const projectStateLoadedRef = useRef<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const hasProcessedPendingSubmission = useRef<boolean>(false);
  const overridePromptRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const isModificationRef = useRef<boolean>(false);

  // Sync with ProjectContext
  const {
    setProjectName: setContextProjectName,
    setUserId,
    setStatus,
    setPreviewUrl,
    setViewMode,
    viewMode,
    deviceSize,
    previewUrl,
    status: contextStatus,
    pendingSubmission,
    clearPendingSubmission,
    setRefreshCallback
  } = useProject();

  // Store setViewMode in ref to avoid dependency array issues
  const setViewModeRef = useRef(setViewMode);
  useEffect(() => {
    setViewModeRef.current = setViewMode;
  }, [setViewMode]);

  // Custom refresh handler that reloads the iframe
  const handleRefreshPreview = useCallback(() => {
    // Increment iframe key to force reload
    setIframeKey(prev => prev + 1);
  }, []);

  // Audio ref to avoid autoplay policy issues
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio on component mount
  useEffect(() => {
    audioRef.current = new Audio('/success.mp3');
    audioRef.current.load();
  }, []);

  const playSuccessSound = useCallback(() => {
    try {
      if (audioRef.current) {
        console.log('🎵 Attempting to play success sound');
        // Reset audio to beginning in case it was played before
        audioRef.current.currentTime = 0;
        audioRef.current.volume = 1; // Ensure volume is at 100%
        audioRef.current.play().then(() => {
          console.log('✅ Success sound played successfully');
        }).catch(err => {
          console.error('❌ Error playing success sound:', err);
          // Fallback: show a toast notification if sound fails
          toast({
            title: "✅ Project Complete!",
            description: "Your project has been generated successfully.",
          });
        });
      }
    } catch (err) {
      console.error('Failed to play audio:', err);
    }
  }, [toast]);

  const handleAnimationComplete = useCallback((filePath: string) => {
    setFiles(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(filePath);
      if (existing) {
        newMap.set(filePath, {
          ...existing,
          isAnimating: false
        });
      }
      return newMap;
    });

    // Notify backend that animation is complete
    const socket = getSocket();
    const projectId = `${usernameRef.current}/${projectNameRef.current}`;
    socket.emit('animation_complete', {
      project_id: projectId,
      file_path: filePath
    });
  }, []);

  // Register refresh callback with context
  useEffect(() => {
    setRefreshCallback(handleRefreshPreview);
    return () => setRefreshCallback(null);
  }, [handleRefreshPreview, setRefreshCallback]);

  // Update page title based on project state
  useEffect(() => {
    if (projectName && projectName.trim()) {
      document.title = `${projectName} - Anybody.dev`;
    } else {
      document.title = 'Chat - Anybody.dev';
    }
  }, [projectName]);

  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', () => {
      console.log('🔌 Socket connected, ID:', socket.id);
      setError('');
    });

    socket.on('connected', (data: any) => {
      console.log('Server confirmed connection:', data);
    });

    socket.on('generation_started', (data: any) => {
      console.log('Generation started:', data);
      projectIdRef.current = data.project_id;
      projectStateLoadedRef.current = false;
      setIsGenerating(true);
      setStatuses([]);
      setFiles(new Map());
      setCurrentFile(null);
      setVisibleFiles(new Set());
      setLoadedSteps([]);
      setFileOrder(0);
      manualSelectionRef.current = false;
      setCurrentStep(null);
      setStatusMessage(null);
      isModificationRef.current = false;

      // Generate new project key to force FileStream reset
      setProjectKey(`project-${Date.now()}`);

      // Automatically switch to code tab when generation starts
      setViewModeRef.current('code');

      // User message should already be added in handleSubmit
      // Don't add duplicate message here

      // Update context
      const [user, proj] = data.project_id.split('/');
      setContextProjectName(proj);
      setUserId(user);
      setStatus('generating');

      // Update URL without navigation to prevent prompt disappearing
      window.history.replaceState(null, '', `/chat/${proj}`);
    });

    socket.on('status_update', (data: StatusUpdate) => {
      // Only process updates for the current project
      const currentProjectId = `${usernameRef.current}/${projectNameRef.current}`;
      console.log('📨 Received status update:', data.project_id, 'current:', currentProjectId);

      if (data.project_id === currentProjectId) {
        console.log('✅ Status update for current project:', data);

        // Update statuses immediately for all steps
        setStatuses(prev => {
          const existing = prev.findIndex(s => s.step === data.step);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = data;
            return updated;
          }
          return [...prev, data].sort((a, b) => a.step - b.step);
        });

        // Update loaded steps to reflect current status
        setLoadedSteps(prev => {
          const stepNum = data.step;
          const stepId = String(stepNum);

          // Check if step already exists
          const existingIndex = prev.findIndex(s => s.id === stepId);

          if (existingIndex >= 0) {
            // Update existing step
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'active' as const,
              message: data.message,
              label: data.message || updated[existingIndex].label
            };

            // Mark previous steps as completed
            updated.forEach((step, index) => {
              const stepNum = parseInt(step.id);
              if (stepNum < data.step) {
                step.status = 'completed' as const;
              } else if (stepNum > data.step && step.status === 'active') {
                step.status = 'pending' as const;
              }
            });

            return updated.sort((a, b) => parseInt(a.id) - parseInt(b.id));
          } else {
            // Add new step if it doesn't exist
            const newStep = {
              id: stepId,
              label: data.message || `Step ${stepNum}`,
              status: 'active' as const,
              message: data.message,
              timestamp: new Date(data.timestamp * 1000)
            };

            // Mark previous steps as completed
            const updated = prev.map(step => {
              const stepNum = parseInt(step.id);
              if (stepNum < data.step) {
                return { ...step, status: 'completed' as const };
              }
              return step;
            });

            updated.push(newStep);
            return updated.sort((a, b) => parseInt(a.id) - parseInt(b.id));
          }
        });

        // Update step and message for ChatMessages
        setCurrentStep(String(data.step));
        setStatusMessage(data.message);

        // Update context status based on step
        if (data.step === 1) setStatus('generating');
        else if (data.step === 2) setStatus('generating');
        else if (data.step === 3) {
          if (data.message.toLowerCase().includes('writing')) {
            setStatus('generating');
            isModificationRef.current = false;
          } else if (data.message.toLowerCase().includes('modifying')) {
            setStatus('modifying');
            isModificationRef.current = true;
          }
        }
        else if (data.step === 5) setStatus('building');
        else if (data.step === 6) setStatus('uploading');
        else if (data.step === 7) {
          // Handle project completion on step 7 (fallback for when project_completed event is missed)
          console.log('Project completed via step 7:', data);
          setIsGenerating(false);
          setStatus('completed');
          setCurrentStep('7');
          setStatusMessage('Project generation completed');
          setIsSubmitting(false);

          // Add step 7 to statuses if not already present
          setStatuses(prev => {
            const existing = prev.findIndex(s => s.step === 7);
            if (existing >= 0) {
              return prev;
            }
            return [...prev, {
              project_id: data.project_id,
              step: 7,
              message: 'Project generation completed',
              timestamp: Date.now() / 1000,
            }];
          });

          // Mark all steps as completed in loadedSteps
          setLoadedSteps(prev => {
            // Add step 7 if it doesn't exist
            const hasStep7 = prev.some(step => step.id === '7');
            const updated = hasStep7
              ? prev.map(step => ({ ...step, status: 'completed' as const }))
              : [...prev.map(step => ({ ...step, status: 'completed' as const })), {
                id: '7',
                label: 'Project generation completed',
                status: 'completed' as const,
                message: 'Project generation completed',
                timestamp: new Date()
              }];
            return updated;
          });

          // Generate cache-busting parameter for preview refresh
          const currentTime = Date.now();
          const randomNumber = Math.floor(Math.random() * 1000000);
          const cacheBuster = `${currentTime}-${randomNumber}`;

          // Extract userId and projectName from project_id
          const [userId, projectName] = data.project_id.split('/');

          // Get username from PocketBase authStore or use userId as fallback
          const authModel = pb.authStore.model;
          const username = authModel?.username || userId;

          // Construct frontend preview URL
          const frontendBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
          const basePreviewUrl = `${frontendBaseUrl}/p/${username}/${projectName}`;
          const previewUrlWithCacheBuster = `${basePreviewUrl}?t=${cacheBuster}`;
          setPreviewUrl(previewUrlWithCacheBuster);

          // Play success sound
          playSuccessSound();

          // Automatically switch to preview tab
          setViewModeRef.current('preview');
        }
      } else {
        console.log('🚫 Status update for different project:', data.project_id, 'expected:', currentProjectId);
      }
    });
    socket.on('file_start', (data: any) => {
      // Validate this event belongs to the current project
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId || !data.project_id || data.project_id !== currentProjectId) {
        console.log('🚫 Ignoring file_start from different project:', data.project_id, 'current:', currentProjectId);
        return;
      }

      // console.log('File start:', data);
      const fileKey = data.file_path;

      setFiles(prev => {
        const newMap = new Map(prev);
        const order = fileOrder;
        setFileOrder(order + 1);
        newMap.set(fileKey, {
          filePath: data.file_path,
          fileName: data.file_name,
          content: data.is_binary ? '[Binary file - not displayed]' : '',
          step: data.step,
          isComplete: data.is_binary || false,
          order: order,
          isBinary: data.is_binary || false,
          isAnimating: !data.is_binary && projectIdRef.current !== undefined, // Only animate if project is active
        });
        return newMap;
      });

      if (data.is_binary) {
        return;
      }

      if (!manualSelectionRef.current) {
        setCurrentFile(fileKey);
        setVisibleFiles(prev => {
          const newSet = new Set(prev);
          newSet.add(fileKey);
          return newSet;
        });
      } else {
        setVisibleFiles(prev => {
          const newSet = new Set(prev);
          newSet.add(fileKey);
          return newSet;
        });
      }
    });

    socket.on('file_content', (data: any) => {
      // Validate this event belongs to the current project
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId || !data.project_id || data.project_id !== currentProjectId) {
        console.log('🚫 Ignoring file_content from different project:', data.project_id, 'current:', currentProjectId);
        return;
      }

      const fileKey = data.file_path;
      setFiles(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(fileKey);
        if (existing) {
          // Preserve isComplete flag when updating content
          if (data.is_incremental !== false) {
            newMap.set(fileKey, {
              ...existing,
              content: existing.content + data.content,
              shouldAnimate: true,
              isAnimating: true,
              // Preserve isComplete if it was already set
            });
          } else {
            // Non-animated file (after 15-second window) - mark as complete immediately
            newMap.set(fileKey, {
              ...existing,
              content: data.content,
              shouldAnimate: false,
              isAnimating: false,
              isComplete: true,  // Auto-complete non-animated files
            });
          }
        } else {
          // File doesn't exist yet, create it
          // Check if project is not running to mark as complete
          const isProjectRunning = isGenerating || contextStatus === 'generating' || contextStatus === 'modifying' || contextStatus === 'building' || contextStatus === 'uploading';
          newMap.set(fileKey, {
            filePath: fileKey,
            fileName: fileKey.split('/').pop() || fileKey,
            content: data.content,
            step: 0,
            // Only mark as incomplete if project is actively running
            isComplete: !isProjectRunning,
            isBinary: false,
            shouldAnimate: data.is_incremental !== false,
          });
        }
        return newMap;
      });

      // Always auto-select the file that's receiving content (unless manual selection is active)
      if (!manualSelectionRef.current) {
        setCurrentFile(fileKey);
        setVisibleFiles(prev => {
          const newSet = new Set(prev);
          newSet.add(fileKey);
          return newSet;
        });
      }
    });

    socket.on('file_end', (data: any) => {
      // Validate this event belongs to the current project
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId || !data.project_id || data.project_id !== currentProjectId) {
        console.log('🚫 Ignoring file_end from different project:', data.project_id, 'current:', currentProjectId);
        return;
      }

      // console.log('File end:', data);
      const fileKey = data.file_path;
      setFiles(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(fileKey);
        if (existing) {
          newMap.set(fileKey, {
            ...existing,
            isComplete: true,
            isAnimating: false,  // Clear animation flag so tick appears
          });
        }
        return newMap;
      });
    });

    socket.on('project_completed', (data: any) => {
      console.log('Project completed:', data);


      setIsGenerating(false);
      setStatus('completed');
      setCurrentStep('7');
      const completionMessage = isModificationRef.current ? 'Project modification completed' : 'Project generation completed';
      setStatusMessage(data.message || completionMessage);
      setIsSubmitting(false);

      // Add step 7 to statuses if not already present
      setStatuses(prev => {
        const existing = prev.findIndex(s => s.step === 7);
        if (existing >= 0) {
          return prev;
        }
        return [...prev, {
          project_id: data.project_id,
          step: 7,
          message: 'Project generation completed',
          timestamp: Date.now() / 1000,
        }];
      });

      // Mark all steps as completed in loadedSteps
      setLoadedSteps(prev => {
        // Add step 7 if it doesn't exist
        const hasStep7 = prev.some(step => step.id === '7');
        const updated = hasStep7
          ? prev.map(step => ({ ...step, status: 'completed' as const }))
          : [...prev.map(step => ({ ...step, status: 'completed' as const })), {
            id: '7',
            label: 'Project generation completed',
            status: 'completed' as const,
            message: 'Project generation completed',
            timestamp: new Date()
          }];
        return updated;
      });

      // Generate cache-busting parameter: currenttime-randomnumber
      const currentTime = Date.now();
      const randomNumber = Math.floor(Math.random() * 1000000);
      const cacheBuster = `${currentTime}-${randomNumber}`;

      // Extract userId and projectName from project_id (format: userId/projectName)
      const [userId, projectName] = data.project_id.split('/');

      // Get username from PocketBase authStore or use userId as fallback
      const authModel = pb.authStore.model;
      const username = authModel?.username || userId;

      // Construct frontend preview URL: /p/username/projectName
      const frontendBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const basePreviewUrl = `${frontendBaseUrl}/p/${username}/${projectName}`;
      const previewUrlWithCacheBuster = `${basePreviewUrl}?t=${cacheBuster}`;
      setPreviewUrl(previewUrlWithCacheBuster);

      // Play success sound
      playSuccessSound();

      // Automatically switch to preview tab
      setViewModeRef.current('preview');
    });

    socket.on('project_cancelled', (data: any) => {
      console.log('Project cancelled:', data);
      setIsGenerating(false);
      setStatus('cancelled');
    });

    socket.on('project_error', (data: any) => {
      console.error('Project error:', data);
      setError(data.error || 'An error occurred');
      setIsGenerating(false);
      setStatus('error');
    });

    socket.on('credits_end', (data: any) => {
      console.log('Credits end:', data);

      // If auto-reload is enabled, backend should have handled it
      // Only show popup if auto-reload failed or is not enabled
      const autoReloadEnabled = data.auto_reload_enabled || false;
      const autoReloadFailed = data.auto_reload_failed || false;

      // If auto-reload is enabled and didn't fail, we shouldn't be here
      // But if we are, it means auto-reload failed, so show settings dialog
      if (autoReloadEnabled && !autoReloadFailed) {
        // Auto-reload is enabled and should have worked - don't show popup
        // This shouldn't happen, but just in case
        console.warn('Credits end received but auto-reload is enabled and not failed');
        return;
      }

      setCreditsEndData({
        available_credits: data.available_credits || 0,
        required_credits: data.required_credits || 10,
        user_plan: data.user_plan || 'free',
        auto_reload_enabled: autoReloadEnabled
      });

      setIsSubmitting(false);
      setIsGenerating(false);
      setError('Insufficient credits to start generation');

      // Determine which popup to show based on backend data
      const userPlan = data.user_plan || 'free';
      const isPro = userPlan === 'pro' || userPlan === 'Pro';

      if (isPro) {
        // Pro user - show enable auto-reload dialog (or check settings if auto-reload failed)
        setShowAutoReloadDialog(true);
      } else {
        // Free user - show upgrade to pro dialog
        setShowUpgradeToProDialog(true);
      }
    });

    socket.on('build_error', (data: any) => {
      console.error('Build error:', data);
      setError(data.message || 'Build failed');
    });

    socket.on('upload_error', (data: any) => {
      console.error('Upload error:', data);
      setError(data.message || 'Upload failed');
    });

    socket.on('error', (data: any) => {
      // Handle different error formats and skip empty objects
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        // Skip empty objects to avoid console errors
        return;
      }

      let errorMessage = 'An error occurred';

      if (data instanceof Error) {
        errorMessage = data.message || errorMessage;
      } else if (typeof data === 'string') {
        errorMessage = data;
      } else if (data.message) {
        errorMessage = data.message;
      } else if (data.error) {
        errorMessage = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
      } else if (typeof data === 'object') {
        errorMessage = JSON.stringify(data);
      }

      console.error('Socket error:', errorMessage);
      setError(errorMessage);
    });

    socket.on('project_state', (data: any) => {
      console.log('Project state:', data);
      if (data.status && data.status !== 'completed' && data.status !== 'cancelled') {
        setIsGenerating(true);
        projectIdRef.current = data.project_id;
      }
    });

    socketRef.current = socket;

    return () => {
      socket.off('connect');
      socket.off('connected');
      socket.off('generation_started');
      socket.off('status_update');
      socket.off('file_start');
      socket.off('file_content');
      socket.off('file_end');
      socket.off('project_completed');
      socket.off('project_cancelled');
      socket.off('project_error');
      socket.off('build_error');
      socket.off('upload_error');
      socket.off('error');
      socket.off('project_state');
    };
  }, [prompt, setContextProjectName, setUserId, setStatus, setPreviewUrl]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages, statuses]);

  // Auto-populate username from PocketBase userid
  useEffect(() => {
    const authModel = pb.authStore.model;
    if (authModel && authModel.id && !username) {
      setUsername(authModel.id);
      setUserId(authModel.id);
    }
  }, [username, setUserId]);


  // Check user subscription status and set default visibility
  useEffect(() => {
    const checkSubscription = async () => {
      const userId = pb.authStore.model?.id;
      if (!userId) {
        setIsProUser(false);
        setVisibility('public'); // Default to public for non-authenticated users
        return;
      }

      try {
        const response = await fetch('/api/subscription/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId }),
        });

        if (response.ok) {
          const data = await response.json();
          const isPro = data.hasActiveSubscription && data.plan === 'pro';
          setIsProUser(isPro);
          // Set default visibility: private for pro, public for free
          // Only set if no project is loaded yet (visibility will be loaded from database if project exists)
          if (!projectName) {
            setVisibility(isPro ? 'private' : 'public');
          }
        } else {
          // Fallback: check user's plan field
          const user = await pb.collection('users').getOne(userId);
          const isPro = user.plan === 'pro' || user.plan === 'Pro';
          setIsProUser(isPro);
          if (!projectName) {
            setVisibility(isPro ? 'private' : 'public');
          }
        }
      } catch (error) {
        console.error('Error checking subscription:', error);
        setIsProUser(false);
        if (!projectName) {
          setVisibility('public');
        }
      }
    };

    checkSubscription();
  }, [projectName]);

  // Load project from URL on mount or when pathname/projectIdFromUrl changes
  useEffect(() => {
    // Use projectIdFromUrl prop if available (from dynamic route), otherwise extract from pathname
    const pathParts = pathname.split('/');
    const projectNameFromUrl = projectIdFromUrl || (pathParts.length >= 3 && pathParts[1] === 'chat' && pathParts[2] ? pathParts[2] : null);

    if (projectNameFromUrl) {
      // Get user ID from PocketBase
      const authModel = pb.authStore.model;
      if (!authModel || !authModel.id) {
        console.error('User not authenticated');
        return;
      }

      const currentUserId = authModel.id;
      setIsLoadingProject(true);
      setUsername(currentUserId);
      setProjectName(projectNameFromUrl);
      setContextProjectName(projectNameFromUrl);
      setUserId(currentUserId);
      projectIdRef.current = `${currentUserId}/${projectNameFromUrl}`;

      // Subscribe to project to load state and chat history
      const socket = getSocket();

      // Function to subscribe to project
      const subscribeToProject = () => {
        console.log('🔌 Socket connected status:', socket.connected);
        console.log('🔌 Socket ID:', socket.id);

        if (socket.connected) {
          console.log('📡 Subscribing to project:', currentUserId, projectNameFromUrl);
          socket.emit('subscribe_to_project', {
            username: currentUserId,
            project_name: projectNameFromUrl
          });
        } else {
          console.log('⏳ Socket not connected, waiting...');
          // Wait for connection with timeout
          const connectTimeout = setTimeout(() => {
            console.error('⏰ Socket connection timeout, retrying subscription...');
            // Retry after timeout
            if (!socket.connected) {
              socket.connect();
            }
          }, 5000);

          socket.once('connect', () => {
            clearTimeout(connectTimeout);
            console.log('🔌 Socket connected, now subscribing...');
            socket.emit('subscribe_to_project', {
              username: currentUserId,
              project_name: projectNameFromUrl
            });
          });
        }
      };

      // Store project info for later subscription
      const currentSubscription = {
        userId: currentUserId,
        projectName: projectNameFromUrl
      };

      // Listen for generation_started to trigger subscription
      const handleGenerationStarted = (data: any) => {
        const expectedProjectId = `${currentSubscription.userId}/${currentSubscription.projectName}`;
        if (data.project_id === expectedProjectId) {
          console.log('🎯 Generation started for current project, subscribing...');
          subscribeToProject();
        }
      };

      // Also listen for reconnection - resubscribe if we were already subscribed
      const handleReconnect = () => {
        // Only resubscribe if we were previously subscribed (generation started)
        if (projectIdRef.current) {
          console.log('🔄 Socket reconnected, resubscribing to project...', currentSubscription.projectName);
          socket.emit('subscribe_to_project', {
            username: currentSubscription.userId,
            project_name: currentSubscription.projectName
          });
        }
      };

      socket.on('generation_started', handleGenerationStarted);
      socket.on('connect', handleReconnect);

      // Trigger subscription immediately
      subscribeToProject();

      // Cleanup function
      return () => {
        socket.off('generation_started', handleGenerationStarted);
        socket.off('connect', handleReconnect);
      };
    }
  }, [projectIdFromUrl, pathname, setContextProjectName, setUserId]);

  // Handle chat_data event from backend
  useEffect(() => {
    const socket = getSocket();

    const handleChatData = (data: any) => {
      console.log('Chat data received:', data);

      // Load messages
      if (data.messages && Array.isArray(data.messages)) {
        const formattedMessages: ChatMessage[] = data.messages.map((msg: any) => ({
          id: `msg-${msg.timestamp || Date.now()}`,
          type: msg.type || 'user',
          content: msg.content || '',
          timestamp: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
          steps: msg.steps ? msg.steps.map((step: any) => ({
            id: String(step.step),
            label: step.message,
            status: 'completed', // Archived steps are always completed
            message: step.message,
            timestamp: step.timestamp ? new Date(step.timestamp * 1000) : new Date()
          })) : undefined
        }));
        setChatMessages(formattedMessages);
      }

      // Load steps from chat history
      if (data.steps && Array.isArray(data.steps)) {
        let rawSteps: any[] = data.steps;

        // Deduplicate steps by step number, keeping the last one
        const uniqueStepsMap = new Map();
        if (Array.isArray(rawSteps)) {
          rawSteps.forEach((step: any) => {
            if (step && typeof step.step !== 'undefined') {
              uniqueStepsMap.set(step.step, step);
            }
          });
          rawSteps = Array.from(uniqueStepsMap.values());
        }

        // If we have current statuses (active modification session), 
        // they take precedence over historic steps from chat_data
        setStatuses(prev => {
          if (prev.length > 0) {
            // Already have active session steps, don't overwrite with old data
            return prev;
          }

          const formattedSteps: StatusUpdate[] = rawSteps.map((step: any) => ({
            project_id: projectIdRef.current || '',
            step: step.step || 0,
            message: step.message || '',
            timestamp: step.timestamp || Date.now() / 1000
          }));

          // Sort steps by step number
          formattedSteps.sort((a, b) => a.step - b.step);
          return formattedSteps;
        });

        // Update loadedSteps based on formatting
        const formattedSteps: StatusUpdate[] = rawSteps.map((step: any) => ({
          project_id: projectIdRef.current || '',
          step: step.step || 0,
          message: step.message || '',
          timestamp: step.timestamp || Date.now() / 1000
        }));
        formattedSteps.sort((a, b) => a.step - b.step);

        // Convert to StatusStep format for ChatMessages
        const statusSteps = formattedSteps.map((step) => {
          let status: 'pending' | 'active' | 'completed' = 'pending';

          if (projectStateLoadedRef.current && contextStatus === 'completed') {
            status = 'completed';
          } else {
            const maxStep = Math.max(...formattedSteps.map(s => s.step));
            if (step.step === maxStep) {
              status = 'active';
            } else if (step.step < maxStep) {
              status = 'completed';
            } else {
              status = 'pending';
            }
          }

          return {
            id: String(step.step),
            label: step.message || `Step ${step.step}`,
            status,
            message: step.message,
            timestamp: new Date(step.timestamp * 1000)
          };
        });

        setLoadedSteps(prev => prev.length > 0 ? prev : statusSteps);

        // Set current step and message from the last step
        if (formattedSteps.length > 0) {
          const lastStep = formattedSteps[formattedSteps.length - 1];
          setCurrentStep(String(lastStep.step));
          setStatusMessage(lastStep.message);
        }
      }
    };

    socket.on('chat_data', handleChatData);

    return () => {
      socket.off('chat_data', handleChatData);
    };
  }, []);

  // Handle project_state event
  useEffect(() => {
    const socket = getSocket();

    const handleProjectState = (state: any) => {
      console.log('Project state received:', state);
      projectStateLoadedRef.current = true;

      // Set project ID and generation status for active projects
      if (state.project_id) {
        projectIdRef.current = state.project_id;
      }
      if (state.status && state.status !== 'completed' && state.status !== 'cancelled') {
        setIsGenerating(true);
      }

      // Load files
      if (state.files && Array.isArray(state.files) && state.files.length > 0) {
        const filesMap = new Map<string, FileData>();
        const isProjectRunning = state.status && ['generating', 'building', 'uploading'].includes(state.status);
        // Mark files as complete if project is completed OR not currently running (old/completed project)
        const shouldMarkComplete = state.status === 'completed' || !isProjectRunning;

        console.log('Loading files from project_state:', {
          status: state.status,
          isProjectRunning,
          shouldMarkComplete,
          fileCount: state.files.length
        });

        state.files.forEach((filePath: string) => {
          filesMap.set(filePath, {
            filePath,
            fileName: filePath.split('/').pop() || filePath,
            content: '',
            step: 0,
            // Mark as complete if project is finished or not running (old project)
            // Or if they are coming from state, they are already written once
            isComplete: shouldMarkComplete
          });
        });
        setFiles(filesMap);

        // Auto-select the first file if no file is selected and project is still running
        if (!currentFile && !manualSelectionRef.current && isProjectRunning) {
          const firstFile = state.files[0];
          if (firstFile) {
            setCurrentFile(firstFile);
            setVisibleFiles(new Set([firstFile]));
          }
        }
      }

      // Load visibility from database if available
      if (state.visibility) {
        setVisibility(state.visibility as VisibilityOption);
      }

      // Restore status and current step
      if (state.status) {
        setStatus(state.status);
        if (state.status === 'completed') {
          setIsGenerating(false);
          setIsSubmitting(false);  // Add this line
          // Mark all steps as completed
          setLoadedSteps(prev => prev.map(step => ({ ...step, status: 'completed' as const })));
          // Set default tab to preview for completed projects
          setViewModeRef.current('preview');
        } else if (['generating', 'building', 'uploading'].includes(state.status)) {
          setIsGenerating(true);
          // Set default tab to code for active projects
          setViewModeRef.current('code');
        }
      }

      // Restore current step and message
      if (state.current_step) {
        setCurrentStep(String(state.current_step));
        // Update loaded steps to show current step as active (only if steps are already loaded)
        setLoadedSteps(prev => {
          if (prev.length === 0) {
            // Steps not loaded yet, chat_data will set them with correct initial status
            return prev;
          }

          const currentStepNum = state.current_step;
          const isCompleted = state.status === 'completed';

          return prev.map(step => {
            const stepNum = parseInt(step.id);
            if (stepNum === currentStepNum) {
              return { ...step, status: isCompleted ? 'completed' : 'active' as const };
            } else if (stepNum < currentStepNum) {
              return { ...step, status: 'completed' as const };
            } else {
              return { ...step, status: 'pending' as const };
            }
          });
        });
      }
      if (state.current_message) {
        setStatusMessage(state.current_message);
      }

      // If project is completed or has files and is not running, ensure preview URL is set
      const isCompleted = state.status === 'completed';
      const hasFilesAndNotRunning = (!state.status || state.status === 'idle') && state.files && state.files.length > 0;

      if (isCompleted || hasFilesAndNotRunning) {
        const projectId = projectIdRef.current || state.project_id;
        if (projectId) {
          // Generate cache-busting parameter: currenttime-randomnumber
          const currentTime = Date.now();
          const randomNumber = Math.floor(Math.random() * 1000000);
          const cacheBuster = `${currentTime}-${randomNumber}`;

          // Extract userId and projectName from project_id (format: userId/projectName)
          const [userId, projectName] = projectId.split('/');

          // Get username from PocketBase authStore or use userId as fallback
          const authModel = pb.authStore.model;
          const username = authModel?.username || userId;

          // Construct frontend preview URL: /p/username/projectName
          const frontendBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
          const basePreviewUrl = `${frontendBaseUrl}/p/${username}/${projectName}`;
          const previewUrlWithCacheBuster = `${basePreviewUrl}?t=${cacheBuster}`;
          setPreviewUrl(previewUrlWithCacheBuster);
        }
      }

      setIsLoadingProject(false);
    };

    socket.on('project_state', handleProjectState);

    return () => {
      socket.off('project_state', handleProjectState);
    };
  }, [setStatus, currentFile]);

  const handleSubmit = async () => {
    // Check for override prompt from ref first, then use state
    const promptToUse = overridePromptRef.current || prompt;
    overridePromptRef.current = null; // Clear after use

    if (!promptToUse.trim()) {
      setError('Please enter a prompt');
      return;
    }

    if (isSubmitting || isGenerating) return;

    setIsSubmitting(true);
    setError('');

    // Prime audio on user interaction to avoid autoplay policy issues
    if (audioRef.current) {
      // Start with low volume instead of 0 to ensure it counts as "unmuted" interaction
      audioRef.current.volume = 0.05;

      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          // Pause after a short delay to ensure the browser registers the playback
          // This "blesses" the audio element for future playback
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
              audioRef.current.volume = 1.0; // Reset to full volume
            }
          }, 100);
        }).catch((err) => {
          // Try to reset volume anyway
          if (audioRef.current) {
            audioRef.current.volume = 1.0;
          }
        });
      }
    }


    try {
      // Get username from PocketBase if not set
      let currentUsername = username;
      if (!currentUsername) {
        const authModel = pb.authStore.model;
        if (authModel && authModel.id) {
          currentUsername = authModel.id;
          setUsername(currentUsername);
          setUserId(currentUsername);
        } else {
          setError('Please log in to create a project');
          setIsSubmitting(false);
          return;
        }
      }

      // Check if user can create private project
      if (visibility === "private") {
        const canCreate = await canCreatePrivateProject(currentUsername);
        if (!canCreate) {
          setSubscriptionReason("private_project");
          setShowSubscriptionPopup(true);
          setIsSubmitting(false);
          return;
        }
      }

      // Generate project name if not set
      let currentProjectName = projectName;
      if (!currentProjectName) {
        try {
          const response = await fetch('/api/project/generate-name', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId: currentUsername }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.projectName) {
              currentProjectName = data.projectName;
              setProjectName(currentProjectName);
              setContextProjectName(currentProjectName);
            } else {
              setError('Failed to generate project name');
              setIsSubmitting(false);
              return;
            }
          } else {
            setError('Failed to generate project name');
            setIsSubmitting(false);
            return;
          }
        } catch (error) {
          console.error('Error generating project name:', error);
          setError('Failed to generate project name');
          setIsSubmitting(false);
          return;
        }
      }

      // Upload files if any
      let uploadedAttachments: any[] = [];
      if (attachedFiles.length > 0) {
        uploadedAttachments = await uploadFiles(attachedFiles.map(af => af.file));
      }

      // Store prompt before clearing (for message display)
      const promptToSend = promptToUse.trim();

      // Note: Don't add user message to local state here - the backend will add it
      // via add_user_message() and send it back via chat_data event to avoid duplicates

      // Start generation via WebSocket
      const socket = getSocket();
      socket.emit('start_generation', {
        username: currentUsername,
        project_name: currentProjectName,
        prompt: promptToSend,
        attachments: uploadedAttachments,
        visibility: visibility,
      });

      projectIdRef.current = `${currentUsername}/${currentProjectName}`;

      // Clear attached files and prompt after submission
      setAttachedFiles([]);
      setPrompt('');
    } catch (err: any) {
      setError(err.message || 'Failed to start generation');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset processed flag when pathname changes to /chat (without project ID)
  useEffect(() => {
    const pathParts = pathname.split('/');
    const isChatRoot = pathname === '/chat' || (pathParts.length === 2 && pathParts[1] === 'chat');
    if (isChatRoot) {
      hasProcessedPendingSubmission.current = false;
      console.log('[AutoSubmit] Reset processed flag for /chat');
    }
  }, [pathname]);

  // Auto-submit from pending submission context when navigating to /chat
  useEffect(() => {
    console.log('[AutoSubmit] Effect triggered', {
      pathname,
      projectIdFromUrl,
      hasPendingMessage: !!pendingSubmission.message,
      hasPendingFiles: pendingSubmission.files.length > 0,
      isSubmitting,
      isGenerating,
      projectName,
      hasProcessed: hasProcessedPendingSubmission.current
    });

    // Check if we're loading a project from URL - if so, don't auto-submit
    const pathParts = pathname.split('/');
    const projectNameFromUrl = projectIdFromUrl || (pathParts.length >= 3 && pathParts[1] === 'chat' && pathParts[2] ? pathParts[2] : null);

    // Only auto-submit if we're on /chat (not /chat/[projectId])
    const isChatRoot = pathname === '/chat' || (pathParts.length === 2 && pathParts[1] === 'chat');

    if (!isChatRoot || projectNameFromUrl) {
      if (projectNameFromUrl) {
        // Clear pending if we're loading a project from URL
        const hasPendingData = pendingSubmission.message || pendingSubmission.files.length > 0;
        if (hasPendingData) {
          console.log('[AutoSubmit] Clearing pending submission - loading project from URL');
          clearPendingSubmission();
        }
      }
      return;
    }

    // Only auto-submit if we have pending submission data
    const hasPendingData = pendingSubmission.message || pendingSubmission.files.length > 0;
    if (!hasPendingData) {
      console.log('[AutoSubmit] No pending data, skipping');
      return;
    }

    // Don't process the same pending submission twice
    if (hasProcessedPendingSubmission.current) {
      console.log('[AutoSubmit] Already processed, skipping');
      return;
    }

    // Don't auto-submit if already working
    if (isSubmitting || isGenerating) {
      console.log('[AutoSubmit] Already submitting/generating, skipping');
      return;
    }

    console.log('[AutoSubmit] Starting auto-submit process');
    // Mark as processed immediately to prevent duplicate submissions
    hasProcessedPendingSubmission.current = true;

    const processAutoSubmit = async () => {
      console.log('[AutoSubmit] Waiting for component to be ready...');
      // Wait a bit to ensure component is fully mounted and username is set
      await new Promise(resolve => setTimeout(resolve, 500));

      // Double-check we still aren't submitting and no project name is set
      if (isSubmitting || isGenerating || projectName) {
        console.log('[AutoSubmit] Aborted - isSubmitting:', isSubmitting, 'isGenerating:', isGenerating, 'projectName:', projectName);
        hasProcessedPendingSubmission.current = false;
        return;
      }

      // Store the pending data before clearing
      const messageToSubmit = pendingSubmission.message;
      const filesToProcess = [...pendingSubmission.files];
      const visibilityToUse = pendingSubmission.visibility || 'public';

      console.log('[AutoSubmit] Processing submission', {
        message: messageToSubmit,
        filesCount: filesToProcess.length,
        visibility: visibilityToUse
      });

      // Clear pending submission immediately
      clearPendingSubmission();

      // Set prompt and visibility from context first
      if (messageToSubmit) {
        setPrompt(messageToSubmit);
        console.log('[AutoSubmit] Set prompt:', messageToSubmit);
      }

      // Set visibility from pending submission
      setVisibility(visibilityToUse);
      console.log('[AutoSubmit] Set visibility:', visibilityToUse);

      // Convert pending files to AttachedFile format
      let filesToAttach: AttachedFile[] = [];
      if (filesToProcess.length > 0) {
        console.log('[AutoSubmit] Converting', filesToProcess.length, 'files');
        for (const pendingFile of filesToProcess) {
          try {
            // Convert base64 data URL to File object
            const response = await fetch(pendingFile.data);
            const blob = await response.blob();
            // @ts-ignore - File constructor is available in browser
            const file = new File([blob], pendingFile.name, { type: pendingFile.type });

            const attachedFile: AttachedFile = { file };

            // Generate preview for images (use the data URL directly)
            if (file.type.startsWith('image/')) {
              attachedFile.preview = pendingFile.data;
            }

            filesToAttach.push(attachedFile);
          } catch (error) {
            console.error('[AutoSubmit] Error converting pending file:', pendingFile.name, error);
          }
        }
      }

      // Set files if any
      if (filesToAttach.length > 0) {
        setAttachedFiles(filesToAttach);
        console.log('[AutoSubmit] Set', filesToAttach.length, 'files');
      }

      // Wait for state to update, then submit
      // We need to wait long enough for React to update the state
      setTimeout(() => {
        // Check if we have something to submit
        const hasPrompt = messageToSubmit && messageToSubmit.trim().length > 0;
        const hasFiles = filesToAttach.length > 0;

        if (!hasPrompt && !hasFiles) {
          console.log('[AutoSubmit] No prompt or files, aborting');
          hasProcessedPendingSubmission.current = false;
          return;
        }

        // Final check before submitting
        if (isSubmitting || isGenerating || projectName) {
          console.log('[AutoSubmit] Final check failed - isSubmitting:', isSubmitting, 'isGenerating:', isGenerating, 'projectName:', projectName);
          hasProcessedPendingSubmission.current = false;
          return;
        }

        // Ensure prompt is set (use the stored value directly)
        if (messageToSubmit) {
          setPrompt(messageToSubmit);
        }

        // Wait a bit more for the prompt state to be set, then submit
        setTimeout(() => {
          if (!isSubmitting && !isGenerating && !projectName) {
            console.log('[AutoSubmit] Executing handleSubmit', {
              hasPrompt,
              hasFiles,
              messageLength: messageToSubmit?.length || 0,
              promptState: prompt,
              willUseOverride: !!messageToSubmit
            });
            // Set override prompt in ref to avoid state timing issues
            if (messageToSubmit) {
              overridePromptRef.current = messageToSubmit;
            }
            handleSubmit();
          } else {
            console.log('[AutoSubmit] Aborted - state changed during wait');
            hasProcessedPendingSubmission.current = false;
          }
        }, 300);
      }, 600);
    };

    processAutoSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, projectIdFromUrl, pendingSubmission]);

  const handleVisibilityChange = async (newVisibility: VisibilityOption) => {
    // Check if user is trying to switch to private
    if (newVisibility === "private") {
      const userId = pb.authStore.model?.id;
      if (!userId) {
        toast({
          title: "Please log in",
          description: "You need to log in to create private projects.",
          variant: "destructive",
        });
        return;
      }

      const canCreate = await canCreatePrivateProject(userId);
      if (!canCreate) {
        setSubscriptionReason("private_project");
        setShowSubscriptionPopup(true);
        return;
      }
    }

    // Check if project is already generated/completed
    const projectId = projectIdRef.current;
    const isProjectGenerated = projectId && (contextStatus === 'completed' || isGenerating || statuses.length > 0);

    if (isProjectGenerated && projectId) {
      // Show confirmation dialog for existing projects
      setPendingVisibility(newVisibility);
      setShowVisibilityConfirmDialog(true);
    } else {
      // For new projects, just update the state
      setVisibility(newVisibility);
    }
  };

  const confirmVisibilityChange = async () => {
    if (!pendingVisibility || !projectIdRef.current) {
      setShowVisibilityConfirmDialog(false);
      setPendingVisibility(null);
      return;
    }

    const userId = pb.authStore.model?.id;
    if (!userId) {
      toast({
        title: "Error",
        description: "You must be logged in to update project visibility.",
        variant: "destructive",
      });
      setShowVisibilityConfirmDialog(false);
      setPendingVisibility(null);
      return;
    }

    setIsUpdatingVisibility(true);
    try {
      const response = await fetch('/api/projects/update-visibility', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: projectIdRef.current,
          visibility: pendingVisibility,
          userId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setVisibility(pendingVisibility);
        toast({
          title: "Visibility updated",
          description: `Project visibility has been updated to ${pendingVisibility}.`,
        });
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to update visibility. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error updating visibility:', error);
      toast({
        title: "Error",
        description: "Failed to update visibility. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingVisibility(false);
      setShowVisibilityConfirmDialog(false);
      setPendingVisibility(null);
    }
  };

  const handleFileAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const MAX_FILES = 5;

    if (attachedFiles.length + files.length > MAX_FILES) {
      setError(`You can attach a maximum of ${MAX_FILES} files`);
      return;
    }

    const validFiles: AttachedFile[] = [];

    files.forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} exceeds the 10MB limit`);
        return;
      }

      const attachedFile: AttachedFile = { file };

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachedFiles(prev =>
            prev.map(af =>
              af.file === file
                ? { ...af, preview: e.target?.result as string }
                : af
            )
          );
        };
        reader.readAsDataURL(file);
      }

      validFiles.push(attachedFile);
    });

    setAttachedFiles(prev => [...prev, ...validFiles]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <Image className="h-4 w-4" />;
    } else if (file.type.startsWith('text/')) {
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

  const handleNewProject = async () => {
    // Get the socket instance
    const socket = getSocket();

    // If there's an active project, unsubscribe from its room (but don't cancel it)
    const oldProjectId = projectIdRef.current;
    if (oldProjectId) {
      console.log('� Unsubscribing from old project room:', oldProjectId);

      // Unsubscribe from the old project's socket room
      // This prevents events from the old project from appearing in the new project view
      // The old project will continue generating in the background
      const [oldUsername, oldProjectName] = oldProjectId.split('/');
      socket.emit('unsubscribe_from_project', {
        username: oldUsername,
        project_name: oldProjectName
      });
      console.log('✅ Unsubscribed from old project, it will continue in background');
    }

    // Clear all state
    setProjectName('');
    setPrompt('');
    setAttachedFiles([]);
    setChatMessages([]);
    projectStateLoadedRef.current = false;
    setStatuses([]);
    setFiles(new Map());
    setCurrentFile(null);
    setVisibleFiles(new Set());
    setFileOrder(0);
    setError('');
    setIsGenerating(false);
    setCurrentStep(null);
    setStatusMessage(null);
    setLoadedSteps([]);
    manualSelectionRef.current = false;
    projectIdRef.current = null;

    // Generate new project key to force FileStream reset
    setProjectKey(`project-${Date.now()}`);

    // Clear context status
    setStatus('idle');
    setPreviewUrl('');

    // Clear URL
    router.push('/chat', { scroll: false });

    // Regenerate project name
    const authModel = pb.authStore.model;
    if (authModel && authModel.id) {
      try {
        const response = await fetch('/api/project/generate-name', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: authModel.id }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.projectName) {
            setProjectName(data.projectName);
            setContextProjectName(data.projectName);
          }
        }
      } catch (error) {
        console.error('Error generating project name:', error);
      }
    }
  };

  // Determine status based on current step for more reliable status display
  const getStatusFromStep = (step: string | null): string => {
    if (!step) return contextStatus;
    const stepNum = parseInt(step);
    if (stepNum >= 7) return 'completed';
    if (stepNum >= 6) return 'uploading';
    if (stepNum >= 4) return 'building';
    if (stepNum >= 3) return contextStatus === 'modifying' ? 'modifying' : 'generating';
    if (stepNum >= 1) return 'generating';
    return contextStatus;
  };

  const derivedStatus = currentStep ? getStatusFromStep(currentStep) : (contextStatus === 'error' ? 'idle' : contextStatus);
  const isWorking = isGenerating || ['generating', 'modifying', 'building', 'uploading'].includes(derivedStatus);
  const hasProject = projectName && username;
  const currentStatus = derivedStatus;

  return (
    <div className="flex h-screen flex-col bg-background">
      <Sidebar />
      <NavigationBar variant="chat" />
      <div className="flex h-full flex-col lg:flex-row md:ml-16">
        {/* Left Panel - Chat */}
        <div className="w-full lg:w-96 flex flex-col h-full border-r border-border bg-card overflow-hidden">
          {/* Chat Header - Aligned with nav bar (both h-14, same px-4, same items-center) */}
          <div className="flex items-center justify-between border-b border-border px-4 h-14 flex-shrink-0 m-0">
            {hasProject ? (
              <span className="text-sm font-medium truncate min-w-0 flex-1">{projectName}</span>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">New Project</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewProject}
              disabled={!hasProject}
              className="h-7 gap-1.5 px-2 text-xs flex-shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Project</span>
            </Button>
          </div>

          {/* Chat Messages */}
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto min-h-0"
          >
            {chatMessages.length === 0 && !isWorking ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-6 flex items-center justify-center">
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                    <div className="relative flex items-center justify-center h-20 w-20 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                      <Rocket className="h-10 w-10 text-primary" />
                    </div>
                  </div>
                </div>
                <h3 className="font-semibold text-base mb-2 text-foreground">Ready to build something amazing?</h3>
                <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed">
                  Describe your project idea and I&apos;ll help you bring it to life
                </p>
              </div>
            ) : (
              <ChatMessages
                messages={chatMessages}
                currentStatus={currentStatus}
                statusMessage={statusMessage}
                currentStep={currentStep}
                error={error}
                isWorking={isWorking}
                initialSteps={loadedSteps}
              />
            )}
          </div>

          {/* Chat Input */}
          <div className="border-t border-border p-4 flex-shrink-0">

            {/* File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt"
            />

            {/* Attached Files */}
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
                      onClick={() => removeFile(index)}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input Area */}
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
                    placeholder={hasProject ? "Describe changes..." : "What do you want to build?"}
                    className="w-full h-full bg-transparent border-0 text-sm sm:text-base text-black dark:text-white placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                    disabled={isSubmitting || isWorking}
                  />
                </div>
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleFileAttach}
                      disabled={isSubmitting || isWorking}
                      className="flex items-center justify-center p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Paperclip className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground transition-colors" />
                    </button>
                    <VisibilityDropdown
                      value={visibility}
                      onValueChange={handleVisibilityChange}
                      disabled={isSubmitting || isWorking || isUpdatingVisibility}
                    />
                  </div>
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || isWorking || (!prompt.trim() && attachedFiles.length === 0)}
                    variant="default"
                    size="icon"
                    className="rounded-full h-8 w-8 sm:h-10 sm:w-10 bg-black dark:bg-white text-white dark:text-black hover:bg-black/70 dark:hover:bg-white/70"
                  >
                    {isSubmitting || isWorking ? (
                      <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Code/Preview */}
        <div
          id="preview-container"
          className="flex-1 flex flex-col min-h-0 bg-card overflow-hidden pt-14"
        >
          {viewMode === 'code' ? (
            <div className="h-full w-full flex flex-col gap-4 p-4">
              {files.size > 0 ? (
                <div className="flex h-full gap-4">
                  {/* File Tree */}
                  <FileTree
                    files={files}
                    onFileSelect={(filePath) => {
                      if (filePath === currentFile && !manualSelectionRef.current) {
                        manualSelectionRef.current = false;
                      } else if (filePath !== currentFile) {
                        manualSelectionRef.current = true;
                      }
                      setCurrentFile(filePath);
                      setVisibleFiles(prev => {
                        const newSet = new Set(prev);
                        newSet.add(filePath);
                        return newSet;
                      });

                      // If file doesn't have content and project is running, request it from server
                      const fileData = files.get(filePath);
                      if (fileData && (!fileData.content || fileData.content.length === 0) && (isGenerating || contextStatus === 'generating' || contextStatus === 'modifying' || contextStatus === 'building' || contextStatus === 'uploading')) {
                        const socket = getSocket();
                        socket.emit('request_file_content', {
                          username: username,
                          project_name: projectName,
                          file_path: filePath
                        });
                      }
                    }}
                    selectedFile={currentFile}
                    isGenerating={isWorking}
                  />
                  {/* Code Preview */}
                  <div className="flex-1 overflow-auto">
                    {currentFile && files.has(currentFile) ? (
                      <FileStream
                        key={`${projectKey}-${currentFile}`}
                        filePath={files.get(currentFile)!.filePath}
                        fileName={files.get(currentFile)!.fileName}
                        content={files.get(currentFile)!.content}
                        // Prioritize currentStep if it's '3' to ensure animation runs correctly
                        step={currentStep === '3' ? 3 : (files.get(currentFile)!.step || 0)}
                        isVisible={true}
                        isBinary={files.get(currentFile)!.isBinary || false}
                        isComplete={files.get(currentFile)!.isComplete || false}
                        canAnimate={files.get(currentFile)!.shouldAnimate !== false}
                        onAnimationComplete={handleAnimationComplete}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>Select a file from the tree to view its content</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-8 h-full">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl animate-pulse" />
                    <div className="relative flex items-center justify-center">
                      <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center">
                        <Code className="h-10 w-10 text-primary/60" />
                      </div>
                    </div>
                  </div>
                  <h3 className="font-semibold text-base mb-2 text-foreground">No project generated yet</h3>
                  <p className="text-sm text-muted-foreground max-w-[280px] leading-relaxed">
                    Start a conversation to generate your project and see the code here
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Preview with iframe */
            <div className="h-full w-full flex items-center justify-center bg-muted/30 p-4">
              {previewUrl ? (
                <div
                  id="iframe-container"
                  className={cn(
                    "h-full bg-white rounded-lg overflow-hidden border border-border transition-all duration-300",
                    deviceSize === 'desktop' && "w-full",
                    deviceSize !== 'desktop' && "mx-auto"
                  )}
                  style={{
                    width: deviceSize === 'desktop' ? '100%' : deviceSizes[deviceSize],
                    maxWidth: '100%'
                  }}
                >
                  <iframe
                    key={iframeKey}
                    ref={iframeRef}
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
                  <h3 className="font-semibold text-base mb-2 text-foreground">No project generated yet</h3>
                  <p className="text-sm text-muted-foreground max-w-[280px] leading-relaxed">
                    Start a conversation to generate your project and see the live preview here
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upgrade to Pro Dialog (for free users) */}
      <SubscriptionPopup
        open={showUpgradeToProDialog}
        onOpenChange={setShowUpgradeToProDialog}
        reason="out_of_limits"
      />

      {/* Enable Auto-Reload Dialog (for pro users without auto-reload) */}
      <Dialog open={showAutoReloadDialog} onOpenChange={setShowAutoReloadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable Auto-Reload</DialogTitle>
            <DialogDescription>
              You don't have enough credits to start generation.
              {creditsEndData && (
                <span className="block mt-2">
                  Available: {creditsEndData.available_credits} credits | Required: {creditsEndData.required_credits} credits
                </span>
              )}
              <span className="block mt-2">
                Enable auto-reload in settings to automatically add credits when they run low.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAutoReloadDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowAutoReloadDialog(false);
                router.push('/settings');
              }}
            >
              Go to Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subscription Popup */}
      <SubscriptionPopup
        open={showSubscriptionPopup}
        onOpenChange={setShowSubscriptionPopup}
        reason={subscriptionReason}
      />

      {/* Visibility Change Confirmation Dialog */}
      <Dialog open={showVisibilityConfirmDialog} onOpenChange={setShowVisibilityConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Project Visibility</DialogTitle>
            <DialogDescription>
              Are you sure you want to change the project visibility to {pendingVisibility === 'private' ? 'private' : 'public'}?
              {pendingVisibility === 'public' && (
                <span className="block mt-2 text-muted-foreground">
                  Making this project public will make it visible to everyone.
                </span>
              )}
              {pendingVisibility === 'private' && (
                <span className="block mt-2 text-muted-foreground">
                  Making this project private will hide it from public view.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowVisibilityConfirmDialog(false);
                setPendingVisibility(null);
              }}
              disabled={isUpdatingVisibility}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmVisibilityChange}
              disabled={isUpdatingVisibility}
            >
              {isUpdatingVisibility ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Visibility'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
