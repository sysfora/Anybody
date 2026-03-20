'use client';

import { useEffect, useRef, useState } from 'react';
import { File, FileCode, FileJson, FileText, Image, Settings, Package, FileType, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeHighlight } from '@/components/Dashboard/CodeHighlight';
import { cn } from '@/lib/utils';

interface FileStreamProps {
  filePath: string;
  fileName: string;
  content: string;
  step: number;
  isVisible?: boolean;
  isBinary?: boolean;
  isComplete?: boolean;
  canAnimate?: boolean;
  onAnimationComplete?: (filePath: string) => void;
}

// Function to get icon and color based on file extension
function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { icon: FileCode, color: 'text-yellow-500' };
    case 'ts':
    case 'tsx':
      return { icon: FileCode, color: 'text-blue-500' };
    case 'json':
    case 'jsonc':
      return { icon: FileJson, color: 'text-green-500' };
    case 'html':
    case 'htm':
      return { icon: FileType, color: 'text-orange-500' };
    case 'xml':
    case 'svg':
      return { icon: FileType, color: 'text-purple-500' };
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return { icon: Settings, color: 'text-pink-500' };
    case 'md':
    case 'mdx':
      return { icon: FileText, color: 'text-blue-400' };
    case 'txt':
      return { icon: FileText, color: 'text-gray-400' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'ico':
      return { icon: Image, color: 'text-cyan-500' };
    case 'lock':
    case 'toml':
    case 'yaml':
    case 'yml':
      return { icon: Package, color: 'text-amber-500' };
    default:
      return { icon: File, color: 'text-gray-500' };
  }
}

function getFileLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'jsx',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'ts': 'typescript',
    'tsx': 'tsx',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'css',
    'json': 'json',
    'md': 'markdown',
    'mdx': 'markdown',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'hpp': 'cpp',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'yml': 'yaml',
    'yaml': 'yaml',
    'xml': 'html',
    'sql': 'sql',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'vue': 'html',
    'svelte': 'html',
    'astro': 'html',
  };
  return langMap[ext || ''] || 'text';
}

export default function FileStream({ filePath, fileName, content, step, isVisible = true, isBinary = false, isComplete = false, canAnimate = true, onAnimationComplete }: FileStreamProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayContent, setDisplayContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const charIndexRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFilePathRef = useRef<string>('');
  const contentRef = useRef<string>('');
  const lastContentLengthRef = useRef(0);
  const hasAnimatedRef = useRef(false); // Track if this file has been animated
  const animationCompleteRef = useRef(false); // Track if animation is complete
  const isCompleteRef = useRef(isComplete); // Ref for isComplete to access in interval

  const fileIconData = getFileIcon(fileName);
  const FileIcon = fileIconData.icon;
  const iconColor = fileIconData.color;

  // Reset when file path changes
  useEffect(() => {
    if (currentFilePathRef.current !== filePath) {
      // File changed, reset everything
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      currentFilePathRef.current = filePath;
      setDisplayContent('');
      charIndexRef.current = 0;
      setIsStreaming(true);
      contentRef.current = content || '';
      lastContentLengthRef.current = 0;
      hasAnimatedRef.current = false; // Reset animation flag for new file
      animationCompleteRef.current = false; // Reset completion flag

      console.log(`FileStream: Reset for new file ${filePath}`);
    }
  }, [filePath]);

  // Keep isCompleteRef in sync
  useEffect(() => {
    isCompleteRef.current = isComplete;
  }, [isComplete]);

  // Update content reference when content changes
  useEffect(() => {
    if (currentFilePathRef.current === filePath && content !== undefined) {
      const previousLength = contentRef.current.length;
      contentRef.current = content;

      // If step is not 3, don't animate - show content immediately
      // Using Number() for robust comparison as step might be a string from backend
      if (Number(step) !== 3) {
        setDisplayContent(content);
        charIndexRef.current = content.length;
        hasAnimatedRef.current = true;
        animationCompleteRef.current = true;
        setIsStreaming(false);
        onAnimationComplete?.(filePath);

        // Auto-scroll when new content arrives
        if (content.length > previousLength) {
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          });
        }
        return;
      }

      // If animation is already complete, show content immediately without re-animating
      if (animationCompleteRef.current) {
        setDisplayContent(content);
        charIndexRef.current = content.length;
        // Auto-scroll when new content arrives
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
        onAnimationComplete?.(filePath);
        return;
      }

      // If content exists but animation hasn't started, check if we should animate or show immediately
      if (content.length > 0 && !hasAnimatedRef.current && !intervalRef.current) {
        // If file is marked as complete, show content immediately without animation
        // This handles completed projects where files are loaded from state
        // IMPORTANT: In Step 3, we want to animate even if the backend says it's complete (e.g. bulk load)
        if (isComplete && Number(step) !== 3) {
          setDisplayContent(content);
          charIndexRef.current = content.length;
          hasAnimatedRef.current = true;
          animationCompleteRef.current = true;
          setIsStreaming(false);
        } else if (content.length > 50 || (Number(step) === 3 && content.length > 0)) {
          // Check if this is a fresh load (content appeared all at once)
          // If previous length was 0 and now we have substantial content, it's likely a state restore
          // In Step 3, we ALWAYS want to animate if it's a fresh load of content
          const isStateRestore = previousLength === 0 && content.length > 0;

          if (isStateRestore && Number(step) === 3) {
            if (canAnimate === false) {
              setDisplayContent(content);
              charIndexRef.current = content.length;
              hasAnimatedRef.current = true;
              animationCompleteRef.current = true;
              setIsStreaming(false);
              onAnimationComplete?.(filePath);
            } else {
              charIndexRef.current = 0;
            }
          } else if (isStateRestore && content.length > 50) {
            setDisplayContent(content);
            charIndexRef.current = content.length;
            hasAnimatedRef.current = true;
            animationCompleteRef.current = true;
            setIsStreaming(false);
            onAnimationComplete?.(filePath);
          } else {
            // Manual selection of file with existing content or non-Step 3 small file
            setDisplayContent(content);
            charIndexRef.current = content.length;
            hasAnimatedRef.current = true;
            animationCompleteRef.current = true;
            setIsStreaming(false);
            onAnimationComplete?.(filePath);
          }
        }
      }

      // Auto-scroll when new content arrives
      if (content.length > previousLength) {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
      }
    }
  }, [content, filePath, isComplete, step]);

  // Auto-scroll when displayContent changes
  useEffect(() => {
    if (displayContent && containerRef.current) {
      // Smooth scroll to bottom
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [displayContent]);

  // Initialize and maintain streaming interval
  useEffect(() => {
    if (!isVisible || currentFilePathRef.current !== filePath) {
      return;
    }

    // If animation is already complete, just show content immediately
    if ((animationCompleteRef.current || Number(step) !== 3) && content) {
      setDisplayContent(content);
      charIndexRef.current = content.length;
      setIsStreaming(false);
      return;
    }

    // If content exists but animation hasn't started and we are in Step 3
    if (content && content.length > 0 && Number(step) === 3 && canAnimate !== false) {
      if (hasAnimatedRef.current && !animationCompleteRef.current) {
        // Animation is in progress, let it continue
        // Don't do anything, interval is already running
      } else if (!hasAnimatedRef.current) {
        // Haven't started animating yet
        // Always start animation for streaming files, even if content is substantial
        // This ensures files loaded from state will animate when content arrives
        if (!intervalRef.current) {
          // Start animation for streaming files
          setIsStreaming(true);
          hasAnimatedRef.current = true; // Mark that we've started animating

          console.log(`Starting animation for ${filePath}, content length: ${contentRef.current.length}`);

          intervalRef.current = setInterval(() => {
            const currentContent = contentRef.current;
            const currentLength = currentContent.length;

            // Continue animating if there's more content to display
            if (charIndexRef.current < currentLength) {
              // Animate next character
              const newDisplayContent = currentContent.slice(0, charIndexRef.current + 1);
              setDisplayContent(newDisplayContent);
              charIndexRef.current++;

              // Auto-scroll to bottom of container
              requestAnimationFrame(() => {
                if (containerRef.current) {
                  containerRef.current.scrollTop = containerRef.current.scrollHeight;
                }
              });
            } else {
              // Check if new content arrived
              if (currentLength > lastContentLengthRef.current) {
                // New content arrived, continue animating
                lastContentLengthRef.current = currentLength;
              } else if (currentLength === charIndexRef.current && currentLength > 0) {
                // Only mark as complete if we've caught up AND the file is marked complete from backend
                if (isCompleteRef.current) {
                  // All content has been animated AND file is complete
                  animationCompleteRef.current = true;
                  setIsStreaming(false);

                  // Clear interval - animation is complete
                  if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                  }

                  // Show full content immediately
                  setDisplayContent(currentContent);
                  onAnimationComplete?.(filePath);
                  console.log(`Animation complete for ${filePath}`);
                }
                // If not complete yet, just keep the interval running to catch new content
              }
            }

          }, 1); // Typewriter speed: 1ms per character (fast animation)
        }
      } else if (animationCompleteRef.current) {
        // Animation complete, show content immediately
        setDisplayContent(content);
        charIndexRef.current = content.length;
        setIsStreaming(false);
      }
    } else if (content && content.length === 0 && displayContent.length === 0) {
      // No content yet, but file is selected - show empty state
      setDisplayContent('');
      setIsStreaming(true);
    } else if (content && Number(step) !== 3) {
      // Not in Step 3, show content immediately
      setDisplayContent(content);
      charIndexRef.current = content.length;
      setIsStreaming(false);
    }

    // Cleanup only on unmount or file change
    return () => {
      // Don't clear interval here - let it run continuously
    };
  }, [isVisible, filePath, content, step]); // Add content to dependencies so it re-runs when content arrives

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const handleCopyCode = async () => {
    if (!displayContent || isBinary) return;

    try {
      await navigator.clipboard.writeText(displayContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  if (!isVisible) return null;

  // For binary files, show a message instead of content
  if (isBinary) {
    return (
      <div className="rounded-lg border border-border bg-card animate-fade-in h-full flex flex-col">
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
          <div className="flex items-center gap-2">
            <FileIcon className={cn('h-4 w-4', iconColor)} />
            <span className="font-mono text-sm text-foreground">{fileName}</span>
            <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-amber-500 text-xs">
              Binary
            </span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center p-8">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <File className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mb-2 font-semibold text-lg">Binary File</h3>
          <p className="text-muted-foreground text-sm">
            This file contains binary data and cannot be displayed as text.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card animate-fade-in h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <FileIcon className={cn('h-4 w-4', iconColor)} />
          <span className="font-mono text-sm text-foreground">{fileName}</span>
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-primary text-xs">
            {getFileLanguage(fileName)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyCode}
          className="h-7 gap-2 px-2"
        >
          {isCopied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span className="text-xs">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="text-xs">Copy</span>
            </>
          )}
        </Button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto bg-[#1e1e1e] scrollbar-code"
      >
        <div className="p-4 w-full" style={{ boxSizing: 'border-box' }}>
          {displayContent ? (
            <div style={{ boxSizing: 'border-box' }}>
              <CodeHighlight
                code={displayContent}
                language={getFileLanguage(fileName)}
                variant="dark"
              />
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
              )}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              {isStreaming ? 'Loading...' : 'No content'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

