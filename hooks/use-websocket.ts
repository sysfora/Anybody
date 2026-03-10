"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

export type ProjectStatus = 'idle' | 'generating' | 'modifying' | 'building' | 'uploading' | 'completed' | 'error'

export interface StatusUpdate {
    project_name: string
    status: ProjectStatus
    message?: string
    step?: string
    error?: string
    timestamp: string
    attempt?: number
    max_attempts?: number
    progress_percent?: number
    file_path?: string
    file_index?: number
    total_files?: number
}

export interface FileChange {
    project_name: string
    event_type: 'created' | 'modified' | 'deleted'
    file_path: string
    content?: string
    is_binary: boolean
    timestamp: string
}

export interface FileTreeUpdate {
    project_name: string
    file_tree: FileNode[]
    timestamp: string
}

export interface FileNode {
    name: string
    type: 'file' | 'folder'
    path?: string
    children?: FileNode[]
    is_binary?: boolean
}

export interface ChatlogUpdate {
    project_name: string
    messages: unknown[]
    timestamp: string
}

export interface CodePreview {
    project_name: string
    file_path: string
    content: string
    operation: 'create' | 'update' | 'delete'
    timestamp: string
}

export interface FileContentStream {
    project_name: string
    file_path: string
    content_chunk: string
    is_complete: boolean
    timestamp: string
}

export interface BuildProgress {
    project_name: string
    progress_type: string
    message: string
    progress_percent?: number
    timestamp: string
}

interface UseWebSocketOptions {
    projectName?: string
    onStatusUpdate?: (update: StatusUpdate) => void
    onFileChange?: (change: FileChange) => void
    onFileTreeUpdate?: (update: FileTreeUpdate) => void
    onChatlogUpdate?: (update: ChatlogUpdate) => void
    onCodePreview?: (preview: CodePreview) => void
    onFileContentStream?: (stream: FileContentStream) => void
    onBuildProgress?: (progress: BuildProgress) => void
    autoConnect?: boolean
}

interface UseWebSocketReturn {
    connected: boolean
    status: ProjectStatus
    statusMessage: string | null
    currentStep: string | null
    error: string | null
    joinProject: (projectName: string) => void
    leaveProject: (projectName: string) => void
    requestFileContent: (projectName: string, filePath: string) => void
    emit: (event: string, data: any) => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
    const {
        projectName,
        onStatusUpdate,
        onFileChange,
        onFileTreeUpdate,
        onChatlogUpdate,
        onCodePreview,
        onFileContentStream,
        onBuildProgress,
        autoConnect = true
    } = options

    const socketRef = useRef<Socket | null>(null)
    const [connected, setConnected] = useState(false)
    const [status, setStatus] = useState<ProjectStatus>('idle')
    const [statusMessage, setStatusMessage] = useState<string | null>(null)
    const [currentStep, setCurrentStep] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const currentProjectRef = useRef<string | null>(null)

    // Use refs for callbacks to prevent reconnection on callback changes
    const onStatusUpdateRef = useRef(onStatusUpdate)
    const onFileChangeRef = useRef(onFileChange)
    const onFileTreeUpdateRef = useRef(onFileTreeUpdate)
    const onChatlogUpdateRef = useRef(onChatlogUpdate)
    const onCodePreviewRef = useRef(onCodePreview)
    const onFileContentStreamRef = useRef(onFileContentStream)
    const onBuildProgressRef = useRef(onBuildProgress)

    // Keep refs updated with latest callbacks
    useEffect(() => {
        onStatusUpdateRef.current = onStatusUpdate
        onFileChangeRef.current = onFileChange
        onFileTreeUpdateRef.current = onFileTreeUpdate
        onChatlogUpdateRef.current = onChatlogUpdate
        onCodePreviewRef.current = onCodePreview
        onFileContentStreamRef.current = onFileContentStream
        onBuildProgressRef.current = onBuildProgress
    }, [onStatusUpdate, onFileChange, onFileTreeUpdate, onChatlogUpdate, onCodePreview, onFileContentStream, onBuildProgress])

    // Get the WebSocket URL from environment or derive from current location
    const getWebSocketUrl = useCallback(() => {
        // In browser, use NEXT_PUBLIC env vars
        if (typeof window !== 'undefined') {
            // Check for public env var first (available in browser)
            const publicUrl = process.env.NEXT_PUBLIC_ANYBODY_API_URL
            if (publicUrl) {
                // Socket.IO handles protocol conversion internally
                return publicUrl.replace(/\/api\/?$/, '')
            }
            
            // Fallback: assume backend is on same host, different port in dev
            // In production, this should use the same origin or configured URL
            const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            if (isDev) {
                // Default dev backend port
                return `http://${window.location.hostname}:5000`
            }
            
            // Production: use same origin (proxy setup assumed)
            return window.location.origin
        }
        
        return ''
    }, [])

    // Initialize socket connection - only depends on autoConnect
    useEffect(() => {
        if (!autoConnect) return

        const wsUrl = getWebSocketUrl()
        if (!wsUrl) {
            console.warn('WebSocket URL not available')
            return
        }

        // Don't create new socket if one already exists
        if (socketRef.current?.connected) {
            return
        }

        // Create socket connection
        socketRef.current = io(wsUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
        })

        const socket = socketRef.current

        // Connection events
        socket.on('connect', () => {
            console.log('🔌 WebSocket connected')
            setConnected(true)
            
            // Rejoin project room if we have a project name
            if (currentProjectRef.current) {
                socket.emit('join_project', { project_name: currentProjectRef.current })
            }
        })

        socket.on('disconnect', () => {
            console.log('🔌 WebSocket disconnected')
            setConnected(false)
        })

        socket.on('connect_error', (err) => {
            console.warn('WebSocket connection error:', err.message)
            setConnected(false)
        })

        // Status update events
        socket.on('status_update', (data: StatusUpdate) => {
            console.log('📡 Status update:', data)
            setStatus(data.status)
            setStatusMessage(data.message || null)
            setCurrentStep(data.step || null)
            if (data.status === 'error') {
                setError(data.error || data.message || 'Unknown error')
            } else {
                setError(null)
            }
            onStatusUpdateRef.current?.(data)
        })

        // File change events
        socket.on('file_change', (data: FileChange) => {
            console.log('📁 File change:', data.file_path, data.event_type)
            onFileChangeRef.current?.(data)
        })
        
        // File tree update events
        socket.on('file_tree_update', (data: FileTreeUpdate) => {
            console.log('🌳 File tree update')
            onFileTreeUpdateRef.current?.(data)
        })

        // Chatlog update events
        socket.on('chatlog_update', (data: ChatlogUpdate) => {
            console.log('💬 Chatlog update')
            onChatlogUpdateRef.current?.(data)
        })

        // Code preview events
        socket.on('code_preview', (data: CodePreview) => {
            console.log('👀 Code preview:', data.file_path)
            onCodePreviewRef.current?.(data)
        })

        // File content stream events (character-by-character streaming)
        socket.on('file_content_stream', (data: FileContentStream) => {
            console.log('🌊 File content stream:', data.file_path, data.is_complete ? '(complete)' : `(+${data.content_chunk.length} chars)`)
            onFileContentStreamRef.current?.(data)
        })

        // File selection events (to auto-select files when streaming starts)
        socket.on('file_selection', (data: { project_name: string; file_path: string; timestamp: string }) => {
            console.log('📌 File selection signal:', data.file_path)
            // This will be handled by the ProjectContext to auto-select the file
            // We emit it as a status update with file_path so the context can handle it
            onStatusUpdateRef.current?.({
                project_name: data.project_name,
                status: 'generating',
                message: `Selecting ${data.file_path}...`,
                step: 'selecting_file',
                file_path: data.file_path,
                timestamp: data.timestamp
            })
        })

        // Build progress events
        socket.on('build_progress', (data: BuildProgress) => {
            console.log('🔨 Build progress:', data.message)
            onBuildProgressRef.current?.(data)
        })

        // Directory change events
        socket.on('directory_change', (data: { project_name: string; event_type: string; path: string; timestamp: string }) => {
            console.log('📂 Directory change:', data.path, data.event_type)
            // Trigger file tree refresh
            onFileTreeUpdateRef.current?.({
                project_name: data.project_name,
                file_tree: [], // Empty to signal refresh needed
                timestamp: data.timestamp
            })
        })

        // File content response
        socket.on('file_content', (data: { project_name: string; file_path: string; content: string; timestamp: string }) => {
            console.log('📄 File content received:', data.file_path)
            onCodePreviewRef.current?.({
                project_name: data.project_name,
                file_path: data.file_path,
                content: data.content,
                operation: 'update',
                timestamp: data.timestamp
            })
        })

        // File content error
        socket.on('file_content_error', (data: { project_name: string; file_path: string; error: string }) => {
            console.error('❌ File content error:', data.file_path, data.error)
        })

        // Cleanup on unmount
        return () => {
            if (currentProjectRef.current) {
                socket.emit('leave_project', { project_name: currentProjectRef.current })
            }
            socket.disconnect()
            socketRef.current = null
        }
    }, [autoConnect, getWebSocketUrl])

    // Join project room when projectName changes
    useEffect(() => {
        if (!socketRef.current || !connected) return

        const socket = socketRef.current

        // Leave previous project room
        if (currentProjectRef.current && currentProjectRef.current !== projectName) {
            socket.emit('leave_project', { project_name: currentProjectRef.current })
        }

        // Join new project room
        if (projectName) {
            socket.emit('join_project', { project_name: projectName })
            currentProjectRef.current = projectName
            console.log(`📥 Joined project room: ${projectName}`)
        } else {
            currentProjectRef.current = null
        }
    }, [projectName, connected])

    // Join a specific project room
    const joinProject = useCallback((name: string) => {
        if (!socketRef.current || !connected) return
        
        // Leave current project if different
        if (currentProjectRef.current && currentProjectRef.current !== name) {
            socketRef.current.emit('leave_project', { project_name: currentProjectRef.current })
        }
        
        socketRef.current.emit('join_project', { project_name: name })
        currentProjectRef.current = name
        console.log(`📥 Joined project room: ${name}`)
    }, [connected])

    // Leave a project room
    const leaveProject = useCallback((name: string) => {
        if (!socketRef.current || !connected) return
        
        socketRef.current.emit('leave_project', { project_name: name })
        if (currentProjectRef.current === name) {
            currentProjectRef.current = null
        }
        console.log(`📤 Left project room: ${name}`)
    }, [connected])

    // Request specific file content
    const requestFileContent = useCallback((projectNameArg: string, filePath: string) => {
        if (!socketRef.current || !connected) return
        
        socketRef.current.emit('request_file_content', {
            project_name: projectNameArg,
            file_path: filePath
        })
    }, [connected])

    // Emit custom event
    const emit = useCallback((event: string, data: any) => {
        if (!socketRef.current || !connected) return
        socketRef.current.emit(event, data)
    }, [connected])

    return {
        connected,
        status,
        statusMessage,
        currentStep,
        error,
        joinProject,
        leaveProject,
        requestFileContent,
        emit
    }
}
