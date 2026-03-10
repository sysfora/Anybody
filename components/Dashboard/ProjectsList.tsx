"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Edit, Download, Trash2, Plus, Eye, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import pb from "@/lib/pocketbase"
import { useToast } from "@/hooks/use-toast"
import { SubscriptionPopup } from "@/components/SubscriptionPopup"
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination"
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
    status: string // Status from PocketBase: generating, modifying, building, uploading, completed, error, cancelled
}

export function ProjectsList() {
    const router = useRouter()
    const { toast } = useToast()
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(true)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false)
    const [downloadingProject, setDownloadingProject] = useState<string | null>(null)
    const [totalItems, setTotalItems] = useState(0)
    const perPage = 50

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

    const fetchProjects = useCallback(async () => {
        try {
            setLoading(true)
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to view your projects",
                    variant: "destructive",
                })
                router.push('/login')
                return
            }

            const response = await fetch(
                `/api/projects?userId=${encodeURIComponent(userId)}&page=${page}&perPage=${perPage}`
            )

            if (!response.ok) {
                throw new Error('Failed to fetch projects')
            }

            const data = await response.json()

            if (data.success) {
                setProjects(data.projects)
                setTotalPages(data.totalPages)
                setTotalItems(data.totalItems)
            }
        } catch (error) {
            console.error('Error fetching projects:', error)
            toast({
                title: "Error",
                description: "Failed to load projects. Please try again.",
                variant: "destructive",
            })
        } finally {
            setLoading(false)
        }
    }, [page, perPage, router, toast])

    useEffect(() => {
        fetchProjects()
    }, [fetchProjects])

    // Poll for project updates every 10 seconds to refresh status
    useEffect(() => {
        if (projects.length === 0) return
        
        const interval = setInterval(() => {
            fetchProjects()
        }, 10000)
        
        return () => clearInterval(interval)
    }, [projects.length, fetchProjects])

    const handleDelete = (project: Project) => {
        setProjectToDelete(project)
        setDeleteDialogOpen(true)
    }

    const confirmDelete = async () => {
        if (!projectToDelete) return

        try {
            setDeletingId(projectToDelete.id)
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to delete projects",
                    variant: "destructive",
                })
                return
            }

            const response = await fetch('/api/projects', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId,
                    projectId: projectToDelete.id,
                    projectName: projectToDelete.name,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete project')
            }

            toast({
                title: "Project deleted",
                description: `Project "${projectToDelete.name}" has been deleted successfully.`,
            })

            // Refresh projects list
            await fetchProjects()
        } catch (error) {
            console.error('Error deleting project:', error)
            toast({
                title: "Delete failed",
                description: error instanceof Error ? error.message : 'Failed to delete project. Please try again.',
                variant: "destructive",
            })
        } finally {
            setDeletingId(null)
            setDeleteDialogOpen(false)
            setProjectToDelete(null)
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

    const handlePreview = (project: Project) => {
        if (typeof window !== 'undefined') {
            window.open(`/p/${project.username}/${project.name}`, '_blank')
        }
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
                                        <div className="flex items-center justify-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span className="text-muted-foreground">Loading projects...</span>
                                        </div>
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
                                                        onClick={() => handlePreview(project)}
                                                        disabled={isBusy}
                                                        title={isBusy ? `Project is ${statusLabel?.toLowerCase()}` : isModifying ? "Preview (modifying)" : "Preview"}
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
                                                        disabled={isBusy || downloadingProject === project.id}
                                                        title={isBusy ? `Project is ${statusLabel?.toLowerCase()}` : isModifying ? "Download (modifying)" : "Download"}
                                                        onClick={async () => {
                                                            if (isBusy) return
                                                            
                                                            const userId = pb.authStore.model?.id;
                                                            if (!userId) {
                                                                toast({
                                                                    title: "Please log in",
                                                                    description: "You need to log in to download projects.",
                                                                    variant: "destructive",
                                                                });
                                                                return;
                                                            }

                                                            // Check download permission via API
                                                            const checkResponse = await fetch('/api/subscription/can-download', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ userId }),
                                                            });

                                                            if (!checkResponse.ok) {
                                                                const checkData = await checkResponse.json();
                                                                if (checkData.reason === 'subscription_required') {
                                                                    setShowSubscriptionPopup(true);
                                                                    return;
                                                                }
                                                            }

                                                            const checkData = await checkResponse.json();
                                                            if (!checkData.canDownload) {
                                                                setShowSubscriptionPopup(true);
                                                                return;
                                                            }
                                                            
                                                            setDownloadingProject(project.id);
                                                            try {
                                                                const response = await fetch('/api/projects/download', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ 
                                                                        username: project.username, 
                                                                        projectName: project.name 
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
                                                                a.download = `${project.name}.zip`;
                                                                document.body.appendChild(a);
                                                                a.click();
                                                                window.URL.revokeObjectURL(url);
                                                                document.body.removeChild(a);

                                                                toast({
                                                                    title: "Success",
                                                                    description: "Project downloaded successfully",
                                                                });
                                                            } catch (error) {
                                                                toast({
                                                                    title: "Error",
                                                                    description: error instanceof Error ? error.message : "Failed to download project",
                                                                    variant: "destructive",
                                                                });
                                                            } finally {
                                                                setDownloadingProject(null);
                                                            }
                                                        }}
                                                    >
                                                        {downloadingProject === project.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Download className="h-4 w-4" />
                                                        )}
                                                        <span className="sr-only">Download</span>
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(project)}
                                                        disabled={isBusy || isModifying || deletingId === project.id}
                                                        title={isBusy || isModifying ? `Project is ${statusLabel?.toLowerCase()}` : "Delete"}
                                                    >
                                                        {deletingId === project.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Trash2 className="h-4 w-4" />
                                                        )}
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

                {totalPages > 1 && (
                    <Pagination>
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        if (page > 1) setPage(page - 1)
                                    }}
                                    className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                                />
                            </PaginationItem>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                                if (
                                    pageNum === 1 ||
                                    pageNum === totalPages ||
                                    (pageNum >= page - 2 && pageNum <= page + 2)
                                ) {
                                    return (
                                        <PaginationItem key={pageNum}>
                                            <PaginationLink
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    setPage(pageNum)
                                                }}
                                                isActive={pageNum === page}
                                            >
                                                {pageNum}
                                            </PaginationLink>
                                        </PaginationItem>
                                    )
                                } else if (pageNum === page - 3 || pageNum === page + 3) {
                                    return (
                                        <PaginationItem key={pageNum}>
                                            <span className="flex h-9 w-9 items-center justify-center text-muted-foreground">
                                                ...
                                            </span>
                                        </PaginationItem>
                                    )
                                }
                                return null
                            })}
                            <PaginationItem>
                                <PaginationNext
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        if (page < totalPages) setPage(page + 1)
                                    }}
                                    className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                )}

                {totalItems > 0 && (
                    <div className="text-center text-sm text-muted-foreground">
                        Showing {((page - 1) * perPage) + 1} to {Math.min(page * perPage, totalItems)} of {totalItems} projects
                    </div>
                )}
            </div>

            <SubscriptionPopup
                open={showSubscriptionPopup}
                onOpenChange={setShowSubscriptionPopup}
            />

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Project</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete &quot;{projectToDelete?.name}&quot;? This action cannot be undone and will permanently delete the project from R2 storage and the database.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
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
