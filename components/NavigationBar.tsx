'use client';

import { useCallback, useEffect, useState } from 'react';
import { 
  Code, 
  Eye, 
  Smartphone, 
  Tablet, 
  Monitor, 
  Maximize, 
  Minimize, 
  RefreshCw, 
  ExternalLink, 
  Download, 
  Rocket,
  Copy,
  Check,
  Loader2
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProject } from '@/context/ProjectContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import pb from '@/lib/pocketbase';

type NavigationBarVariant = 'default' | 'chat' | 'sidebar';

interface NavigationBarProps {
  variant?: NavigationBarVariant;
  /** When true (e.g. chat UI demo), deploy/download do not call the API. */
  demoMode?: boolean;
}

export function NavigationBar({ variant = 'default', demoMode = false }: NavigationBarProps) {
  const {
    projectName,
    userId,
    status,
    viewMode,
    deviceSize,
    isFullscreen,
    previewUrl,
    setViewMode,
    setDeviceSize,
    setIsFullscreen,
    refreshPreview
  } = useProject();

  const hasProject = !!projectName && !!userId;
  const isWorking = status === 'generating' || status === 'modifying' || status === 'building' || status === 'uploading';

  // /p/username/projectname — used for open-in-new-tab and as the canonical deployed URL.
  const currentUsername = pb.authStore.record?.username as string | undefined;
  const publicProjectUrl =
    hasProject && currentUsername
      ? `/p/${encodeURIComponent(currentUsername)}/${encodeURIComponent(projectName!)}`
      : null;
  
  // Deploy dialog state
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [isDeployed, setIsDeployed] = useState(false);
  const [isCheckingDeployStatus, setIsCheckingDeployStatus] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string>('');
  
  // Download state
  const [isDownloading, setIsDownloading] = useState(false);

  // Handle fullscreen changes (only for default and chat variants)
  useEffect(() => {
    if (variant === 'sidebar') return;
    
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setIsFullscreen, variant]);

  const toggleFullscreen = useCallback(async () => {
    // Target the iframe container instead of the entire preview container
    const iframeContainer = document.getElementById('iframe-container');
    if (!iframeContainer) {
      // Fallback to preview-container if iframe-container doesn't exist
      const previewContainer = document.getElementById('preview-container');
      if (!previewContainer) return;
      
      try {
        if (!document.fullscreenElement) {
          await previewContainer.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (err) {
        console.error('Fullscreen error:', err);
      }
      return;
    }
    
    try {
      if (!document.fullscreenElement) {
        await iframeContainer.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  const handleDownload = async () => {
    if (!projectName || !userId) return;
    
    setIsDownloading(true);
    
    try {
      toast.success("Preparing download...", {
        description: "Your project is being packaged"
      });
      
      const response = await fetch('/api/projects/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId,
          projectName 
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download project');
      }

      // Get the blob and create download link
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Download complete", {
        description: "Your project has been downloaded successfully"
      });
    } catch (err) {
      toast.error("Download failed", {
        description: err instanceof Error ? err.message : "Could not download the project"
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // Check deployment status and open dialog
  const handleDeploy = async () => {
    if (!projectName || !userId) return;
    
    setShowDeployDialog(true);
    setIsCheckingDeployStatus(true);
    
    try {
      const statusResponse = await fetch(`/api/projects/deploy?userId=${userId}&projectName=${projectName}`);
      const statusData = await statusResponse.json();
      const deployed = statusData.deployed || false;
      setIsDeployed(deployed);
      
      // Generate deployed URL
      if (deployed) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setDeployedUrl(publicProjectUrl ? `${origin}${publicProjectUrl}` : '');
      } else {
        setDeployedUrl('');
      }
    } catch (err) {
      toast.error("Failed to check deployment status", {
        description: err instanceof Error ? err.message : "Could not check deployment status"
      });
      setShowDeployDialog(false);
    } finally {
      setIsCheckingDeployStatus(false);
    }
  };

  // Handle deploy action
  const handleDeployAction = async () => {
    if (!projectName || !userId) return;
    
    setIsDeploying(true);
    
    try {
      const response = await fetch('/api/projects/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId,
          projectName,
          action: 'deploy'
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to deploy project');
      }

      await response.json();
      setIsDeployed(true);

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setDeployedUrl(publicProjectUrl ? `${origin}${publicProjectUrl}` : '');
      
      toast.success("Deployed successfully", {
        description: "Your project is now live and accessible"
      });
    } catch (err) {
      toast.error("Deploy failed", {
        description: err instanceof Error ? err.message : "Could not deploy the project"
      });
    } finally {
      setIsDeploying(false);
    }
  };

  // Handle undeploy action
  const handleUndeployAction = async () => {
    if (!projectName || !userId) return;
    
    setIsDeploying(true);
    
    try {
      const response = await fetch('/api/projects/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId,
          projectName,
          action: 'undeploy'
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to undeploy project');
      }

      setIsDeployed(false);
      setDeployedUrl('');
      
      toast.success("Undeployed successfully", {
        description: "Your project has been undeployed"
      });
    } catch (err) {
      toast.error("Undeploy failed", {
        description: err instanceof Error ? err.message : "Could not undeploy the project"
      });
    } finally {
      setIsDeploying(false);
    }
  };

  // Handle copy link
  const handleCopyLink = async () => {
    if (!deployedUrl) return;
    
    setIsCopying(true);
    
    try {
      await navigator.clipboard.writeText(deployedUrl);
      setCopied(true);
      toast.success("Link copied", {
        description: "Deployed project link copied to clipboard"
      });
      
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      toast.error("Failed to copy link", {
        description: "Could not copy link to clipboard"
      });
    } finally {
      setIsCopying(false);
    }
  };

  // Sidebar variant: only theme button, starting from sidebar
  if (variant === 'sidebar') {
    return (
      <nav className="fixed top-0 left-0 md:left-16 right-0 z-50 border-b border-border bg-background h-14">
        <div className="flex h-full items-center justify-end px-4">
          <ThemeToggle />
        </div>
      </nav>
    );
  }

  // Chat variant: full navbar for chat page
  if (variant === 'chat') {
    return (
      <>
      <nav className="fixed top-0 left-0 md:left-16 lg:left-[calc(4rem+24rem)] right-0 z-50 border-b border-border bg-background h-14">
        <div className="flex h-full items-center justify-between px-4">
          {/* Left: View Toggle & Device Size */}
          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center rounded-lg border border-border p-0.5">
              <button
                onClick={() => setViewMode('code')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewMode === 'code' 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Code className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Code</span>
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewMode === 'preview' 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Preview</span>
              </button>
            </div>

            {/* Device Size Buttons */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
              <button
                onClick={() => setDeviceSize('mobile')}
                disabled={!hasProject || viewMode !== 'preview'}
                className={cn(
                  "flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                  deviceSize === 'mobile' && viewMode === 'preview'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  (!hasProject || viewMode !== 'preview') && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
                )}
                title="Mobile (375px)"
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeviceSize('tablet')}
                disabled={!hasProject || viewMode !== 'preview'}
                className={cn(
                  "flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                  deviceSize === 'tablet' && viewMode === 'preview'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  (!hasProject || viewMode !== 'preview') && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
                )}
                title="Tablet (768px)"
              >
                <Tablet className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeviceSize('desktop')}
                disabled={!hasProject || viewMode !== 'preview'}
                className={cn(
                  "flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                  deviceSize === 'desktop' && viewMode === 'preview'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  (!hasProject || viewMode !== 'preview') && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
                )}
                title="Desktop (100%)"
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshPreview}
              disabled={!hasProject}
              className="h-8 w-8 p-0"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1">
            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              disabled={!hasProject}
              className="h-8 w-8 p-0"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize className="h-3.5 w-3.5" />
              ) : (
                <Maximize className="h-3.5 w-3.5" />
              )}
            </Button>

            {/* External Link */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => publicProjectUrl && window.open(publicProjectUrl, '_blank')}
              disabled={!hasProject || !publicProjectUrl}
              className="h-8 w-8 p-0"
              title="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>

            {/* Theme Toggle */}
            <ThemeToggle />

            <div className="w-px h-5 bg-border mx-1" />

            {/* Deploy */}
            <Button
              variant="default"
              size="sm"
              onClick={handleDeploy}
              disabled={demoMode || !hasProject || isWorking}
              className="h-8 gap-1.5 px-3 flex items-center"
              title={demoMode ? 'Not available in demo' : 'Deploy project'}
            >
              <Rocket className="h-3.5 w-3.5" />
              <span className="hidden lg:inline text-xs">Deploy</span>
            </Button>

            {/* Download */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={demoMode || !hasProject || isWorking || isDownloading}
              className="h-8 gap-1.5 px-3 flex items-center"
              title={demoMode ? 'Not available in demo' : 'Download project'}
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="hidden lg:inline text-xs">Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline text-xs">Download</span>
                </>
              )}
            </Button>

          </div>
        </div>
      </nav>
      {/* Deploy Dialog */}
      <Dialog open={showDeployDialog} onOpenChange={setShowDeployDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deploy Project</DialogTitle>
            <DialogDescription>
              {isCheckingDeployStatus 
                ? "Checking deployment status..." 
                : isDeployed 
                  ? "Your project is deployed and accessible at the link below."
                  : "Deploy your project to make it publicly accessible."}
            </DialogDescription>
          </DialogHeader>
          
          {isCheckingDeployStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isDeployed ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Deployed URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={deployedUrl}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-muted"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLink}
                    disabled={isCopying || !deployedUrl}
                    className="gap-2"
                  >
                    {isCopying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Deploy your project to make it publicly accessible. Once deployed, you'll get a shareable link.
              </p>
            </div>
          )}
          
          <DialogFooter>
            {isDeployed ? (
              <Button
                variant="destructive"
                onClick={handleUndeployAction}
                disabled={isDeploying}
                className="gap-2"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Undeploying...
                  </>
                ) : (
                  'Undeploy'
                )}
              </Button>
            ) : (
              <Button
                onClick={handleDeployAction}
                disabled={isDeploying}
                className="gap-2"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Deploy
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
    );
  }

  // Default variant: full functionality for projects page
  return (
    <>
    <nav className="fixed top-0 left-0 md:left-16 lg:left-[calc(4rem+24rem)] right-0 z-50 border-b border-border bg-background h-14">
      <div className="flex h-full items-center justify-between px-4">
        {/* Left: View Toggle & Device Size */}
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button
              onClick={() => setViewMode('code')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                viewMode === 'code' 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Code</span>
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                viewMode === 'preview' 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          </div>

          {/* Device Size Buttons */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
            <button
              onClick={() => setDeviceSize('mobile')}
              disabled={!hasProject || viewMode !== 'preview'}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                deviceSize === 'mobile' && viewMode === 'preview'
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                (!hasProject || viewMode !== 'preview') && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
              )}
              title="Mobile (375px)"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeviceSize('tablet')}
              disabled={!hasProject || viewMode !== 'preview'}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                deviceSize === 'tablet' && viewMode === 'preview'
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                (!hasProject || viewMode !== 'preview') && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
              )}
              title="Tablet (768px)"
            >
              <Tablet className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeviceSize('desktop')}
              disabled={!hasProject || viewMode !== 'preview'}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                deviceSize === 'desktop' && viewMode === 'preview'
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                (!hasProject || viewMode !== 'preview') && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
              )}
              title="Desktop (100%)"
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Refresh Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshPreview}
            disabled={!hasProject}
            className="h-8 w-8 p-0"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            disabled={!hasProject}
            className="h-8 w-8 p-0"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-3.5 w-3.5" />
            ) : (
              <Maximize className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* External Link */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => publicProjectUrl && window.open(publicProjectUrl, '_blank')}
            disabled={!hasProject || !publicProjectUrl}
            className="h-8 w-8 p-0"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>

          {/* Theme Toggle */}
          <ThemeToggle />

          <div className="w-px h-5 bg-border mx-1" />

          {/* Deploy */}
          <Button
            variant="default"
            size="sm"
            onClick={handleDeploy}
            disabled={!hasProject || isWorking}
            className="h-8 gap-1.5 px-3 flex items-center"
            title="Deploy project"
          >
            <Rocket className="h-3.5 w-3.5" />
            <span className="hidden lg:inline text-xs">Deploy</span>
          </Button>

          {/* Download */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={!hasProject || isWorking || isDownloading}
            className="h-8 gap-1.5 px-3 flex items-center"
            title="Download project"
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="hidden lg:inline text-xs">Downloading...</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span className="hidden lg:inline text-xs">Download</span>
              </>
            )}
          </Button>

        </div>
      </div>
    </nav>
    
    {/* Deploy Dialog */}
    <Dialog open={showDeployDialog} onOpenChange={setShowDeployDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deploy Project</DialogTitle>
            <DialogDescription>
              {isCheckingDeployStatus 
                ? "Checking deployment status..." 
                : isDeployed 
                  ? "Your project is deployed and accessible at the link below."
                  : "Deploy your project to make it publicly accessible."}
            </DialogDescription>
          </DialogHeader>
          
          {isCheckingDeployStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isDeployed ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Deployed URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={deployedUrl}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-muted"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLink}
                    disabled={isCopying || !deployedUrl}
                    className="gap-2"
                  >
                    {isCopying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Deploy your project to make it publicly accessible. Once deployed, you'll get a shareable link.
              </p>
            </div>
          )}
          
          <DialogFooter>
            {isDeployed ? (
              <Button
                variant="destructive"
                onClick={handleUndeployAction}
                disabled={isDeploying}
                className="gap-2"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Undeploying...
                  </>
                ) : (
                  'Undeploy'
                )}
              </Button>
            ) : (
              <Button
                onClick={handleDeployAction}
                disabled={isDeploying}
                className="gap-2"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Deploy
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
