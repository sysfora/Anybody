"use client"

import { useState, useEffect, useCallback } from "react"
import { Edit, Download, Trash2, Plus, Eye, Loader2 } from "lucide-react"
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

type Project = {
    id: string
    name: string
    dateCreated: string
    expiresIn: string | "Never" | "Expired"
    deployed: boolean
    visibility: string
    username: string
    status: string
}

export function ProjectsList() {
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
    const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null)

    const fetchProjects = useCallback(async () => {
        if (!pb.authStore.isValid) {
            setProjects([])
            setLoading(false)
            setLoadError(null)
            return
        }
        const model = pb.authStore.model as { id?: string } | undefined
        const userId = model?.id
        if (!userId) {
            setProjects([])
            setLoading(false)
            return
        }
        setLoading(true)
        setLoadError(null)
        try {
            const res = await fetch(
                `/api/projects?userId=${encodeURIComponent(userId)}&perPage=100`,
            )
            const data = (await res.json()) as {
                success?: boolean
                projects?: Project[]
                error?: string
            }
            if (!res.ok) {
                setLoadError(data.error || "Failed to load projects")
                setProjects([])
                return
            }
            setProjects(data.projects ?? [])
        } catch {
            setLoadError("Failed to load projects")
            setProjects([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void fetchProjects()
        return pb.authStore.onChange(() => {
            void fetchProjects()
        })
    }, [fetchProjects])

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
                setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id))
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

    if (!pb.authStore.isValid && !loading) {
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
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 rounded-md px-3 text-xs sm:h-9 sm:px-4 sm:py-2 sm:text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                        <Plus className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">New Project</span>
                    </Link>
                </div>

                {loadError ? (
                    <p className="text-sm text-destructive">{loadError}</p>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[150px]">Project Name</TableHead>
                                <TableHead className="min-w-[120px]">Date Created</TableHead>
                                <TableHead className="min-w-[120px]">Expiring In</TableHead>
                                <TableHead className="min-w-[120px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-32 text-center">
                                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                                    </TableCell>
                                </TableRow>
                            ) : projects.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-32 text-center">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <p className="text-muted-foreground">No projects yet</p>
                                            <Link
                                                href="/chat"
                                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 rounded-md px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                                            >
                                                <Plus className="mr-2 h-4 w-4" />
                                                Create your first project
                                            </Link>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                projects.map((project) => {
                                    const isBusy = isProjectBusy(project)
                                    const isModifying = isProjectModifying(project)
                                    const statusLabel = getProjectStatusLabel(project)
                                    const isActive = isBusy || isModifying

                                    return (
                                        <TableRow key={project.id}>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    {project.name}
                                                    {statusLabel && (
                                                        <Badge
                                                            variant={project.status === 'error' ? 'destructive' : project.status === 'cancelled' ? 'secondary' : 'outline'}
                                                            className="text-xs"
                                                        >
                                                            {isActive && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                                            {statusLabel}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">{formatDate(project.dateCreated)}</TableCell>
                                            <TableCell>
                                                {project.expiresIn === "Never" ? (
                                                    <Badge variant="secondary">Never</Badge>
                                                ) : project.expiresIn === "Expired" ? (
                                                    <Badge variant="destructive">Expired</Badge>
                                                ) : (
                                                    <span className="text-muted-foreground text-sm">{project.expiresIn}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1 sm:gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        type="button"
                                                        disabled={isBusy || !project.username}
                                                        onClick={() => openPreview(project)}
                                                        title="Open public preview"
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                        <span className="sr-only">Preview</span>
                                                    </Button>
                                                    <Link
                                                        href={`/chat/${encodeURIComponent(project.name)}`}
                                                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 rounded-md px-3 text-xs hover:bg-accent hover:text-accent-foreground"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                        <span className="sr-only">Edit</span>
                                                    </Link>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        type="button"
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
                                                        size="sm"
                                                        type="button"
                                                        onClick={() => handleDelete(project)}
                                                        disabled={isBusy || isModifying || deletingId === project.id}
                                                        title={isBusy || isModifying ? `Project is ${statusLabel?.toLowerCase()}` : "Delete"}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                        <span className="sr-only">Delete</span>
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="text-center text-sm text-muted-foreground">
                    {!loading && projects.length > 0
                        ? `Showing ${projects.length} project${projects.length === 1 ? '' : 's'}`
                        : null}
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
        </>
    )
}
