'use client';

import { useState, ReactElement, useEffect } from 'react';
import { ChevronRight, ChevronDown, File, FileCode, FileJson, FileText, Image, Settings, Package, FileType, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileNode {
  filePath: string;
  fileName: string;
  content: string;
  step: number;
  isComplete?: boolean;
  order?: number;
  isAnimating?: boolean;
}

interface FileTreeProps {
  files: Map<string, FileNode>;
  onFileSelect: (filePath: string) => void;
  selectedFile: string | null;
  isGenerating?: boolean;
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

export default function FileTree({ files, onFileSelect, selectedFile, isGenerating = false }: FileTreeProps) {
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  // Automatically expand parent directories when a file is selected
  useEffect(() => {
    if (selectedFile) {
      const parts = selectedFile.split('/').filter(p => p);
      const parentPaths: string[] = [];

      // Build all parent directory paths
      for (let i = 1; i < parts.length; i++) {
        parentPaths.push(parts.slice(0, i).join('/'));
      }

      // Add all parent paths to openFiles
      if (parentPaths.length > 0) {
        setOpenFiles(prev => {
          const newSet = new Set(prev);
          parentPaths.forEach(path => newSet.add(path));
          return newSet;
        });
      }
    }
  }, [selectedFile]);

  // Organize files into tree structure
  const buildTree = () => {
    const tree: any = {};

    Array.from(files.entries()).forEach(([filePath, fileData]) => {
      const parts = filePath.split('/').filter(p => p);
      let current = tree;

      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          // It's a file
          current[part] = {
            ...fileData,
            isFile: true,
            fullPath: filePath,
            name: fileData.fileName || part
          };
        } else {
          // It's a directory
          if (!current[part]) {
            current[part] = { isFile: false, children: {} };
          }
          current = current[part].children;
        }
      });
    });

    return tree;
  };

  const toggleDirectory = (path: string) => {
    setOpenFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const renderTree = (node: any, path: string = '', level: number = 0) => {
    const items: ReactElement[] = [];

    // Sort: directories first, then files
    const entries = Object.entries(node).sort(([a, aData]: [string, any], [b, bData]: [string, any]) => {
      if (aData.isFile && !bData.isFile) return 1;
      if (!aData.isFile && bData.isFile) return -1;
      return a.localeCompare(b);
    });

    entries.forEach(([name, data]: [string, any]) => {
      const fullPath = path ? `${path}/${name}` : name;

      if (data.isFile) {
        // It's a file
        const isSelected = selectedFile === data.fullPath;
        const fileIconData = getFileIcon(name);
        const FileIcon = fileIconData.icon;
        const iconColor = fileIconData.color;

        // Determine file status for indicators
        // A file is actively being written if: generation is active, file has content, but is not complete
        const hasContent = data.content && data.content.length > 0;
        const isComplete = data.isComplete === true;
        const isWriting = isGenerating && !isComplete && hasContent;

        // Show loader for files currently being written OR animating
        // Show checkmark only when completed and not animating
        const showLoader = isWriting || data.isAnimating;
        const showCheckmark = isComplete && !data.isAnimating;

        items.push(
          <button
            key={fullPath}
            onClick={() => onFileSelect(data.fullPath)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted transition-colors",
              isSelected && "bg-muted"
            )}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
          >
            <FileIcon className={cn('h-4 w-4', iconColor)} />
            <span className="font-mono text-xs flex-1 truncate">{name}</span>
            {(showCheckmark || showLoader) && (
              <div className="flex-shrink-0 ml-auto">
                {showLoader ? (
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                ) : showCheckmark ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : null}
              </div>
            )}
          </button>
        );
      } else {
        // It's a directory
        const isOpen = openFiles.has(fullPath);
        items.push(
          <div key={fullPath}>
            <button
              onClick={() => toggleDirectory(fullPath)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted transition-colors"
              style={{ paddingLeft: `${level * 12 + 8}px` }}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="font-mono text-xs">{name}</span>
            </button>
            {isOpen && data.children && (
              <div>
                {renderTree(data.children, fullPath, level + 1)}
              </div>
            )}
          </div>
        );
      }
    });

    return items;
  };

  const tree = buildTree();

  return (
    <div className="w-64 h-full rounded-lg border border-border bg-card flex flex-col">
      <div className="border-b border-border bg-muted/50 px-4 py-2">
        <span className="font-medium text-sm">Files</span>
      </div>
      <div className="flex-1 p-2 overflow-y-auto scrollbar-tree">
        {Object.keys(tree).length > 0 ? (
          renderTree(tree)
        ) : (
          <div className="p-4 text-center">
            <p className="text-muted-foreground text-sm">
              No files yet...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

