'use client'

import * as React from 'react'
import { toast as sonnerToast } from 'sonner'

import type { ToastActionElement, ToastProps } from '@/components/ui/toast'

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

type Toast = Omit<ToasterToast, 'id'>

function toast({ title, description, variant, action, ...props }: Toast) {
  const message = title ?? 'Notification'
  const options = {
    description,
    action: action
      ? {
          label: 'Action',
          onClick: () => {},
        }
      : undefined,
    ...props,
  }

  const id =
    variant === 'destructive'
      ? sonnerToast.error(message, options)
      : sonnerToast(message, options)

  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: (next: ToasterToast) => {
      sonnerToast.message(next.title ?? message, {
        description: next.description,
        id,
      })
    },
  }
}

function useToast() {
  return {
    toasts: [] as ToasterToast[],
    toast,
    dismiss: (toastId?: string) => sonnerToast.dismiss(toastId),
  }
}

export { useToast, toast }
