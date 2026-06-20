import { toast as sonnerToast } from 'sonner'

function toMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (value == null) return fallback
  if (typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return fallback
}

export function showToast({
  title,
  description,
  variant = 'default',
}: {
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}) {
  const options = description ? { description } : undefined
  if (variant === 'destructive') {
    return sonnerToast.error(title, options)
  }
  return sonnerToast.success(title, options)
}

export function showToastError(error: unknown, fallback: string) {
  return sonnerToast.error(toMessage(error, fallback))
}

export { sonnerToast as toast }
