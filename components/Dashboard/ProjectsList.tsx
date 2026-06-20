"use client"

import { useState, useEffect, useRef } from "react"
import { useProjectPagination } from '@/hooks/useProjectPagination';
import { Edit, Download, Trash2, Plus, Eye, Loader2 } from "lucide-react"
import { clearLastChatSlug } from "@/app/chat/chat-shell";
import { showToast, showToastError } from "@/lib/toast";
import { VisibilityDropdown, VisibilityOption } from "@/components/ui/visibility-dropdown";
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import pb from "@/lib/pocketbase"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { SubscriptionPopup } from "@/components/SubscriptionPopup";

type Project = {
    id: string
    name: string
    dateCreated: string
    deployed: boolean
    visibility: string
    username: string
    status: string
    previewUrl?: string | null
}

export function ProjectsList() {
    const [mounted, setMounted] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [userId, setUserId] = useState<string | undefined>(undefined);

    useEffect(() => {
        setMounted(true);
        if (pb.authStore.isValid) {
            setIsLoggedIn(true);
            setUserId((pb.authStore.model as { id?: string } | null)?.id);
        }
    }, []);

    const { items: projects, loading, hasMore, fetchMore } = useProjectPagination<Project>({
        apiUrl: userId ? `/api/projects?userId=${encodeURIComponent(userId)}` : '',
        initialLimit: 12
    });

    const [updatingVisibilityId, setUpdatingVisibilityId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);
    const [subscriptionReason, setSubscriptionReason] = useState<"private_project" | "out_of_limits">("out_of_limits");
    const [pendingProject, setPendingProject] = useState<Project | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
    const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
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

    // This component used to have a fetchProjects function for auth changes.
    // useProjectPagination handles the fetch, but we might need to handle projects list update after delete manually.
    const [displayProjects, setDisplayProjects] = useState<Project[]>([]);
    
    useEffect(() => {
        setDisplayProjects((prev) => {
            const visibilityById = new Map(prev.map((p) => [p.id, p.visibility]));
            return projects.map((p) => ({
                ...p,
                visibility: visibilityById.get(p.id) ?? p.visibility,
            }));
        });
    }, [projects]);

    const isProjectBusy = (project: Project): boolean => {
        const status = project.status?.toLowerCase()
        return status === 'generating' || status === 'building' || status === 'uploading'
    }

    const isProjectModifying = (project: Project): boolean => {
        const status = project.status?.toLowerCase()
        return status === 'modifying'
    }

    const getProjectStatusLabel = (project: Project): string | null => {
        const status = project.status?.toLowerCase()
        if (!status) return null

        switch (status) {
            case 'generating':
                return 'Generating'
            case 'modifying':
                return 'Modifying'
            case 'building':
                return 'Building'
            case 'uploading':
                return 'Uploading'
            case 'error':
                return 'Error'
            case 'cancelled':
                return 'Cancelled'
            case 'completed':
            default:
                return null
        }
    }

    const handleDelete = (project: Project) => {
        setProjectToDelete(project)
        setDeleteDialogOpen(true)
    }

    const handleVisibilityChange = async (project: Project, newVisibility: VisibilityOption) => {
        if (!userId) return;
        
        if (newVisibility === "private") {
            const res = await fetch("/api/subscription/can-create-private", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            });
            const data = await res.json();
            if (!data.canCreatePrivate) {
                setPendingProject(project);
                setSubscriptionReason("private_project");
                setShowSubscriptionPopup(true);
                return;
            }
        }

        setUpdatingVisibilityId(project.id);
        try {
            const res = await fetch("/api/projects/update-visibility", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_id: `${project.username}/${project.name}`,
                    visibility: newVisibility,
                    userId,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setDisplayProjects(prev => prev.map(p => 
                    p.id === project.id ? { ...p, visibility: newVisibility } : p
                ));
                showToast({
                    title: "Visibility updated",
                    description: `Project is now ${newVisibility}.`,
                });
            } else {
                showToastError(data.error, "Failed to update visibility.");
            }
        } catch (error) {
            console.error("Error updating visibility:", error);
            showToastError(error, "An unexpected error occurred.");
        } finally {
            setUpdatingVisibilityId(null);
        }
    };

    const confirmDelete = async () => {
        if (!projectToDelete) return
        const model = pb.authStore.model as { id?: string } | undefined
        const userId = model?.id
        if (!userId) return

        setDeletingId(projectToDelete.id)
        try {
            const res = await fetch("/api/projects", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    projectId: projectToDelete.id,
                    projectName: projectToDelete.name,
                }),
            })
            if (res.ok) {
                setDisplayProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id))
            }
        } finally {
            setDeletingId(null)
            setDeleteDialogOpen(false)
            setProjectToDelete(null)
        }
    }

    const openPreview = (project: Project) => {
        const u = project.username?.trim()
        if (!u) return
        const path = `/p/${encodeURIComponent(u)}/${encodeURIComponent(project.name)}`
        window.open(path, "_blank", "noopener,noreferrer")
    }

    const handleDownload = async (project: Project) => {
        const model = pb.authStore.model as { id?: string; username?: string } | undefined
        const userId = model?.id
        const username = model?.username
        if (!userId || !username) return
        setDownloadBusyId(project.id)
        try {
            const res = await fetch("/api/projects/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    username,
                    projectName: project.name,
                }),
            })
            if (!res.ok) {
                const err = (await res.json().catch(() => ({}))) as { error?: string }
                console.warn(err.error || res.statusText)
                return
            }
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${project.name}.zip`
            a.click()
            URL.revokeObjectURL(url)
        } finally {
            setDownloadBusyId(null)
        }
    }

    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
    }

    if (!mounted) {
        return (
            <div className="space-y-4">
                <div className="flex justify-end">
                    <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="aspect-video bg-muted animate-pulse" />
                            <div className="p-4 space-y-3">
                                <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!isLoggedIn || !userId) {
        return (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
                <p className="text-muted-foreground text-sm sm:text-base mb-4">
                    Sign in to see your saved projects and sync chat with PocketBase.
                </p>
                <Button asChild variant="default" size="sm">
                    <Link href="/login">Sign in</Link>
                </Button>
            </div>
        )
    }

    return (
        <>
            <div className="space-y-4">
                <div className="flex justify-end">
                    <Link
                        href="/chat"
                        onClick={() => clearLastChatSlug()}
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 rounded-md px-3 text-xs sm:h-9 sm:px-4 sm:py-2 sm:text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                        <Plus className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">New Project</span>
                    </Link>
                </div>

                {/* Error handling if needed */}

                {displayProjects.length === 0 && !loading ? (
                    <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground bg-card">
                        <div className="flex flex-col items-center justify-center gap-4">
                            <p className="text-lg">No projects yet</p>
                            <Link
                                href="/chat"
                                onClick={() => clearLastChatSlug()}
                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Create your first project
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {displayProjects.map((project) => {
                            const isBusy = isProjectBusy(project)
                            const isModifying = isProjectModifying(project)
                            const statusLabel = getProjectStatusLabel(project)
                            const isActive = isBusy || isModifying

                            return (
                                <div key={project.id} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:shadow-md hover:border-border/80 relative">
                                    {/* Preview Image / Gradient Area */}
                                    <div className="relative aspect-video w-full overflow-hidden border-b border-border bg-muted/50 cursor-pointer" onClick={() => !isBusy && project.username ? openPreview(project) : null}>
                                        {project.previewUrl ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img
                                                src={project.previewUrl}
                                                alt={`${project.name} preview`}
                                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                            />
                                        ) : (
                                            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent to-secondary/10 group-hover:opacity-80 transition-opacity" />
                                        )}

                                        {/* Status Badge overlay */}
                                        {statusLabel && (
                                            <div className="absolute top-3 left-3">
                                                <Badge
                                                    variant={project.status === 'error' ? 'destructive' : project.status === 'cancelled' ? 'secondary' : 'default'}
                                                    className="shadow-sm backdrop-blur-sm"
                                                >
                                                    {isActive && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                                                    {statusLabel}
                                                </Badge>
                                            </div>
                                        )}

                                        {/* Visibility Toggle Overlay */}
                                        <div 
                                            className="absolute top-3 right-3 z-10 transition-opacity"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <VisibilityDropdown
                                                value={project.visibility as VisibilityOption}
                                                onValueChange={(val) => handleVisibilityChange(project, val)}
                                                disabled={updatingVisibilityId === project.id}
                                                side="bottom"
                                                className="bg-background/80 backdrop-blur-sm border shadow-sm hover:bg-background h-8 transition-all"
                                            />
                                        </div>
                                    </div>

                                    {/* Content Area */}
                                    <div className="flex flex-col flex-1 p-4 sm:p-5">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="space-y-1.5 w-full">
                                                <h3 className="font-semibold text-base leading-tight tracking-tight line-clamp-1 truncate pr-2" title={project.name}>{project.name}</h3>
                                                <p className="text-xs text-muted-foreground font-medium">{formatDate(project.dateCreated)}</p>
                                            </div>
                                        </div>

                                        <div className="mt-auto pt-4 border-t flex flex-col gap-3">
                                            {/* Bottom row of footer: Actions */}
                                            <div className="flex justify-between items-center -mx-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                                                    disabled={isBusy || !project.username}
                                                    onClick={() => openPreview(project)}
                                                    title="Open public preview"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                    <span className="sr-only">Preview</span>
                                                </Button>

                                                <Link
                                                    href={`/chat/${encodeURIComponent(project.name)}`}
                                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                                                    title="Edit project"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                    <span className="sr-only">Edit</span>
                                                </Link>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                                                    disabled={isBusy || isModifying || downloadBusyId === project.id}
                                                    title="Download saved HTML as ZIP (requires active subscription)"
                                                    onClick={() => void handleDownload(project)}
                                                >
                                                    {downloadBusyId === project.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Download className="h-4 w-4" />
                                                    )}
                                                    <span className="sr-only">Download</span>
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => handleDelete(project)}
                                                    disabled={isBusy || isModifying || deletingId === project.id}
                                                    title={isBusy || isModifying ? `Project is ${statusLabel?.toLowerCase()}` : "Delete"}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    <span className="sr-only">Delete</span>
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                <div ref={observerRef} className="h-24 flex items-center justify-center mt-4">
                    {loading && hasMore && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
                    {!hasMore && displayProjects.length > 0 && (
                        <p className="text-muted-foreground text-sm italic">Showing all your projects</p>
                    )}
                </div>
            </div>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Project</AlertDialogTitle>
                        <AlertDialogDescription>
                            Remove &quot;{projectToDelete?.name}&quot; from your account? Saved HTML stored on the project record will be deleted with it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void confirmDelete()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <SubscriptionPopup
                open={showSubscriptionPopup}
                onOpenChange={setShowSubscriptionPopup}
                reason={subscriptionReason}
                returnTo="/projects"
                pendingPrompt=""
                pendingVisibility="private"
            />
        </>
    )
}
