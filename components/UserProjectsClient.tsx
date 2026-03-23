"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Calendar, Loader2, Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import pb from '@/lib/pocketbase';
import { useProjectPagination } from '@/hooks/useProjectPagination';

interface Project {
  id: string;
  name: string;
  preview: string;
  created: string;
  deployed: boolean;
}

interface UserProjectsClientProps {
  username: string;
  userId: string;
  avatar: string;
}

export function UserProjectsClient({ username, userId, avatar }: UserProjectsClientProps) {
  const { items: projects, loading, hasMore, fetchMore } = useProjectPagination<any>({
    apiUrl: `/api/users/${username}/public-projects`,
    initialLimit: 12
  });

  const [remixingId, setRemixingId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const observerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          fetchMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, fetchMore]);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleRemix = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!pb.authStore.isValid) {
      toast({
        title: "Please log in",
        description: "You need to log in to remix projects.",
        variant: "destructive",
      });
      router.push('/login');
      return;
    }

    setRemixingId(projectId);
    try {
      const response = await fetch('/api/projects/remix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: "Project Remixed!",
          description: "We've created a copy for you.",
        });
        router.push(`/chat/${encodeURIComponent(data.projectName)}`);
      } else {
        throw new Error(data.error || 'Failed to remix project');
      }
    } catch (error) {
      console.error('Error remixing project:', error);
      toast({
        title: "Remix Failed",
        description: error instanceof Error ? error.message : "Failed to remix project",
        variant: "destructive",
      });
    } finally {
      setRemixingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
      {projects.map((project: any) => {
        const previewUrl = project.preview
          ? `${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/projects/${project.id}/${project.preview}`
          : null;

        return (
          <Card
            key={project.id}
            className="rounded-2xl border-border hover:border-primary/50 hover:shadow-xl transition-all overflow-hidden flex flex-col group"
          >
            {/* Project Link Area */}
            <Link
              href={`/p/${username}/${project.name as string}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col flex-1"
            >
              <div className="relative aspect-video w-full overflow-hidden border-b border-border bg-muted/50">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={`${project.name} preview`}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent to-secondary/10 group-hover:opacity-80 transition-opacity" />
                )}

                {/* Remix Overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                  <button
                    onClick={(e) => handleRemix(e, project.id)}
                    disabled={remixingId === project.id}
                    className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-full font-bold text-sm hover:bg-gray-200 transition-colors shadow-lg active:scale-95 transform duration-150"
                  >
                    {remixingId === project.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Remix this project
                  </button>
                </div>
              </div>

              <div className="p-5 flex flex-col flex-1 pb-3">
                <h3 className="text-xl font-semibold line-clamp-1 mb-2 group-hover:text-primary transition-colors">
                  {project.name as string}
                </h3>
                <div className="flex items-center text-sm text-muted-foreground gap-1.5 mt-auto pt-1 uppercase tracking-widest text-[11px] font-bold">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDate(project.created as string)}
                </div>
              </div>
            </Link>

            {/* User Attribution Footer */}
            <div className="px-5 py-3 border-t border-border/50 bg-muted/20">
              <div className="flex items-center gap-2 max-w-fit">
                <div className="relative h-7 w-7 rounded-full overflow-hidden border border-border shadow-sm">
                  {avatar ? (
                    <img
                      src={`${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/users/${userId}/${avatar}?thumb=50x50`}
                      alt={username}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-500 uppercase">
                      {username.slice(0, 2)}
                    </div>
                  )}
                </div>
                <span className="text-xs font-semibold text-muted-foreground truncate italic">
                  @{username}
                </span>
              </div>
            </div>
          </Card>
        );
      })}

      {/* Infinite Scroll Trigger */}
      <div ref={observerRef} className="col-span-1 md:col-span-2 lg:col-span-3 h-20 flex items-center justify-center mt-8">
        {loading && hasMore && (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        )}
        {!hasMore && projects.length > 0 && (
          <p className="text-muted-foreground text-sm font-medium italic">That&apos;s all of {username}&apos;s public projects.</p>
        )}
      </div>
    </div>
  );
}
