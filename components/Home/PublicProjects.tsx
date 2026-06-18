"use client";

import React, { useEffect, useState, useRef } from 'react';
import pb from '@/lib/pocketbase';
import { Card } from '@/components/ui/card';
import { Calendar, ExternalLink, Loader2, Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

import { useProjectPagination } from '@/hooks/useProjectPagination';

interface Project {
  id: string;
  name: string;
  username: string;
  user_id: string;
  user_avatar: string;
  preview: string;
  created: string;
  deployed: boolean;
}

export const PublicProjects = () => {
  const { items: projects, loading, hasMore, fetchMore } = useProjectPagination<Project>({
    apiUrl: '/api/projects/all-public',
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

  if (projects.length === 0 && !loading) {
    return (
      <section className="max-w-7xl mx-auto px-4 pb-16 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">
            Explore Public Projects
          </h2>
          <p className="text-muted-foreground mt-1">
            Discover what others are building with Anybody.dev
          </p>
        </div>
        <p className="text-muted-foreground text-sm">No public projects yet. Check back soon!</p>
      </section>
    );
  }

  return (
    <section className="max-w-7xl mx-auto px-4 pb-16 lg:px-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">
            Explore Public Projects
          </h2>
          <p className="text-muted-foreground mt-1">
            Discover what others are building with Anybody.dev
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {projects.map((project) => {
          const previewUrl = project.preview
            ? `${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/projects/${project.id}/${project.preview}`
            : null;

          return (
            <Card
              key={project.id}
              className="group relative flex flex-col overflow-hidden rounded-2xl border-border bg-card hover:border-primary/50 hover:shadow-xl transition-all duration-300"
            >
              {/* Project Link Area */}
              <Link
                href={`/p/${project.username}/${project.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col flex-1"
              >
                {/* Preview Image */}
                <div className="relative aspect-video w-full overflow-hidden bg-muted/50">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`${project.name} preview`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/5 to-secondary/10 group-hover:opacity-80 transition-opacity" />
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

                <div className="p-4 flex flex-col flex-1 pb-2">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-bold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                  </div>
                  
                  <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(project.created)}
                    </div>
                  </div>
                </div>
              </Link>

              {/* User Attribution Footer */}
              <div className="px-4 py-3 border-t border-border/50 bg-muted/20">
                <Link
                  href={`/p/${project.username}`}
                  className="flex items-center gap-2 group/user max-w-fit"
                >
                  <div className="relative h-7 w-7 rounded-full overflow-hidden border border-border shadow-sm group-hover/user:border-primary/50 transition-colors">
                    {project.user_avatar ? (
                      <img
                        src={`${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/users/${project.user_id}/${project.user_avatar}?thumb=50x50`}
                        alt={project.username}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-500 uppercase">
                        {project.username.slice(0, 2)}
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground group-hover/user:text-primary transition-colors truncate italic">
                    @{project.username}
                  </span>
                </Link>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Infinite Scroll Trigger */}
      <div ref={observerRef} className="h-20 flex items-center justify-center mt-8">
        {loading && hasMore && (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        )}
        {!hasMore && projects.length > 0 && (
          <p className="text-muted-foreground text-sm">You&apos;ve reached the end of the showcase.</p>
        )}
      </div>
    </section>
  );
};
