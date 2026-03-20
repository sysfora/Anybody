"use client"

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react"

type ViewMode = "code" | "preview"
type DeviceSize = "mobile" | "tablet" | "desktop"
export type ProjectStatus = "idle" | "generating" | "modifying" | "building" | "uploading" | "completed" | "cancelled" | "error"
type VisibilityOption = "public" | "private"

interface PendingFile {
  name: string
  type: string
  size: number
  data: string // base64 encoded
}

interface PendingSubmission {
  message: string | null
  visibility: VisibilityOption | null
  files: PendingFile[]
}

interface ProjectContextType {
  projectName: string | null
  userId: string | null
  status: ProjectStatus
  viewMode: ViewMode
  deviceSize: DeviceSize
  isFullscreen: boolean
  previewUrl: string | null
  pendingSubmission: PendingSubmission
  setProjectName: (name: string | null) => void
  setUserId: (id: string | null) => void
  setStatus: (status: ProjectStatus) => void
  setViewMode: (mode: ViewMode) => void
  setDeviceSize: (size: DeviceSize) => void
  setIsFullscreen: (fullscreen: boolean) => void
  setPreviewUrl: (url: string | null) => void
  setPendingSubmission: (submission: PendingSubmission) => void
  clearPendingSubmission: () => void
  refreshPreview: () => void
  setRefreshCallback: (callback: (() => void) | null) => void
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectName, setProjectName] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [status, setStatus] = useState<ProjectStatus>("idle")
  const [viewMode, setViewMode] = useState<ViewMode>("code")
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop")
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission>({
    message: null,
    visibility: null,
    files: []
  })

  const refreshCallbackRef = useRef<(() => void) | null>(null)

  const refreshPreview = useCallback(() => {
    // Call custom refresh callback if set (for iframe reload)
    if (refreshCallbackRef.current) {
      refreshCallbackRef.current()
    }
    
    // Also update URL with cache-busting parameter
    if (previewUrl) {
      const separator = previewUrl.includes("?") ? "&" : "?"
      setPreviewUrl(`${previewUrl}${separator}_refresh=${Date.now()}`)
    }
  }, [previewUrl])

  const setRefreshCallback = useCallback((callback: (() => void) | null) => {
    refreshCallbackRef.current = callback
  }, [])

  const clearPendingSubmission = useCallback(() => {
    setPendingSubmission({
      message: null,
      visibility: null,
      files: []
    })
  }, [])

  return (
    <ProjectContext.Provider
      value={{
        projectName,
        userId,
        status,
        viewMode,
        deviceSize,
        isFullscreen,
        previewUrl,
        pendingSubmission,
        setProjectName,
        setUserId,
        setStatus,
        setViewMode,
        setDeviceSize,
        setIsFullscreen,
        setPreviewUrl,
        setPendingSubmission,
        clearPendingSubmission,
        refreshPreview,
        setRefreshCallback,
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const context = useContext(ProjectContext)
  if (context === undefined) {
    throw new Error("useProject must be used within a ProjectProvider")
  }
  return context
}

