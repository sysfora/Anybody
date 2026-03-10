"use client"

import { useState, useEffect, useRef } from "react"
import {
  Check,
  Circle,
  Loader2,
  AlertCircle
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  steps?: StatusStep[]
}

export interface StatusStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'error'
  message?: string
  subSteps?: { label: string; done: boolean }[]
  icon?: React.ElementType
  timestamp: Date
  details?: string
}

interface ChatMessagesProps {
  messages: ChatMessage[]
  currentStatus: string
  statusMessage: string | null
  currentStep: string | null
  error: string | null
  isWorking: boolean
  initialSteps?: StatusStep[]
}

function StatusIndicator({ status, isLarge = false }: { status: 'pending' | 'active' | 'completed' | 'error'; isLarge?: boolean }) {
  const size = isLarge ? 'h-6 w-6' : 'h-4 w-4'
  const iconSize = isLarge ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'

  if (status === 'completed') {
    return (
      <div className={cn("flex items-center justify-center rounded-full bg-emerald-500/20", size)}>
        <Check className={cn("text-emerald-500", iconSize)} />
      </div>
    )
  }

  if (status === 'active') {
    return (
      <div className={cn("flex items-center justify-center rounded-full bg-blue-500/20", size)}>
        <div className={cn("rounded-full bg-blue-500 animate-pulse", isLarge ? "h-2 w-2" : "h-1.5 w-1.5")} />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className={cn("flex items-center justify-center rounded-full bg-red-500/20", size)}>
        <AlertCircle className={cn("text-red-500", iconSize)} />
      </div>
    )
  }

  return (
    <div className={cn("flex items-center justify-center rounded-full bg-muted", size)}>
      <Circle className={cn("text-muted-foreground/50", isLarge ? "h-2 w-2" : "h-1.5 w-1.5")} />
    </div>
  )
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-4 py-3">
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  )
}

function SystemMessage({ message }: { message: ChatMessage }) {
  if (!message.steps || message.steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 my-4">
      <div className="space-y-0 opacity-80 hover:opacity-100 transition-opacity">
        {message.steps.map((step, index) => (
          <StepItem
            key={`${step.id}-${index}`}
            step={{ ...step, status: 'completed' }} // Force completed status for history
            isLast={index === message.steps!.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

function StepItem({
  step,
  isLast
}: {
  step: StatusStep
  isLast: boolean
}) {
  return (
    <div className="relative flex items-center gap-3 py-2 animate-in fade-in slide-in-from-left-2 duration-300">
      {/* Connecting line */}
      {!isLast && (
        <div className="absolute left-2 top-8 bottom-0 w-px">
          <div className={cn(
            "h-full w-full transition-all duration-500",
            step.status === 'completed'
              ? "bg-gradient-to-b from-emerald-500/40 to-emerald-500/20"
              : step.status === 'active'
                ? "bg-gradient-to-b from-blue-500/40 via-blue-500/20 to-border"
                : "bg-border"
          )} />
        </div>
      )}

      {/* Status indicator with animation */}
      <div className="relative flex-shrink-0 z-10 flex items-center">
        <div className={cn(
          "transition-all duration-500",
          step.status === 'active' && "animate-pulse"
        )}>
          <StatusIndicator status={step.status} />
        </div>
      </div>

      {/* Step message */}
      <div className="flex-1 min-w-0 flex items-center">
        {step.status === 'active' ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-foreground animate-pulse">
              {step.message || step.label}
            </p>
            <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin flex-shrink-0" />
          </div>
        ) : (
          <p className={cn(
            "text-sm transition-colors duration-300",
            step.status === 'completed' && "text-emerald-600 dark:text-emerald-400",
            step.status === 'error' && "text-red-500",
            step.status === 'pending' && "text-muted-foreground"
          )}>
            {step.message || step.label}
          </p>
        )}
      </div>
    </div>
  )
}

export function ChatMessages({
  messages,
  currentStatus,
  statusMessage,
  currentStep,
  error,
  isWorking,
  initialSteps = []
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [steps, setSteps] = useState<StatusStep[]>(initialSteps)

  // Step label mapping
  const getStepLabel = (stepName: string, message?: string | null): string => {
    const labelMap: Record<string, string> = {
      '1': 'Starting up...',
      '2': 'Cloning repository...',
      '3': message || 'Writing files',
      '4': 'Finalizing project structure...',
      '5': 'Building project...',
      '6': 'Uploading...',
      '7': 'Completed',
    }

    return labelMap[stepName] || message || stepName
  }

  // Initialize steps from initialSteps prop
  useEffect(() => {
    if (initialSteps && initialSteps.length > 0) {
      setSteps(initialSteps)
    }
  }, [initialSteps])

  // Update steps from status updates
  useEffect(() => {
    // Only clear steps when we're completely idle, have no messages, and no initial steps (fresh start)
    // Don't clear steps during or after generation - keep completed steps visible
    if (!isWorking && currentStatus === 'idle' && !error && messages.length === 0 && initialSteps.length === 0) {
      setSteps([])
      return
    }

    if (!currentStep && !statusMessage) {
      return
    }

    setSteps(prevSteps => {
      const stepId = currentStep || `step-${Date.now()}`
      const now = new Date()
      const stepMessage = statusMessage || ''

      // Check if step already exists (by ID, not just by status)
      const existingIndex = prevSteps.findIndex(s => s.id === stepId)

      if (existingIndex >= 0) {
        // Update existing step
        const newSteps = [...prevSteps]
        newSteps[existingIndex] = {
          ...newSteps[existingIndex],
          message: statusMessage || newSteps[existingIndex].message,
          label: statusMessage || newSteps[existingIndex].label,
          status: currentStatus === 'error' ? 'error' :
            currentStatus === 'completed' ? 'completed' :
              'active',
          details: error || newSteps[existingIndex].details,
        }

        // Mark previous steps as completed
        newSteps.forEach((step, index) => {
          const stepNum = parseInt(step.id)
          const currentStepNum = parseInt(stepId)
          if (stepNum < currentStepNum) {
            step.status = 'completed'
          } else if (stepNum > currentStepNum && step.status === 'active') {
            step.status = 'pending'
          }
        })

        return newSteps
      } else {
        // Add new step if it doesn't exist
        const newStep: StatusStep = {
          id: stepId,
          label: getStepLabel(currentStep || 'working', statusMessage),
          status: currentStatus === 'error' ? 'error' : 'active',
          message: statusMessage || undefined,
          timestamp: now,
          details: error || undefined,
        }

        const newSteps = [...prevSteps]

        // Mark previous active steps as completed
        newSteps.forEach(step => {
          const stepNum = parseInt(step.id)
          const currentStepNum = parseInt(stepId)
          if (stepNum < currentStepNum) {
            step.status = 'completed'
          } else if (step.status === 'active' && step.id !== stepId) {
            step.status = 'completed'
          }
        })

        newSteps.push(newStep)
        return newSteps.sort((a, b) => parseInt(a.id) - parseInt(b.id))
      }
    })
  }, [currentStatus, statusMessage, currentStep, error, isWorking])

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, steps])

  if (messages.length === 0 && steps.length === 0 && !isWorking) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((message) => (
        <div key={message.id} className="mb-3">
          {message.type === 'user' ? (
            <UserMessage message={message} />
          ) : message.type === 'system' ? (
            <SystemMessage message={message} />
          ) : null}
        </div>
      ))}

      <div className="space-y-0">
        {steps.map((step, index) => (
          <StepItem
            key={`${step.id}-${step.timestamp?.getTime() || index}`}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </div>

      {error && steps.length === 0 && (
        <div className="flex justify-start">
          <div className="w-full max-w-[90%] rounded-2xl rounded-bl-sm border border-red-500/20 bg-red-500/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-500">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  )
}

