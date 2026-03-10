"use client"

import { cn } from "@/lib/utils"

interface LoadingDotsProps {
  className?: string
}

export function LoadingDots({ className }: LoadingDotsProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div 
        className="h-2 w-2 rounded-full bg-current" 
        style={{ 
          animation: "loading-dot-bounce 1.4s ease-in-out infinite",
          animationDelay: "0s"
        }} 
      />
      <div 
        className="h-2 w-2 rounded-full bg-current" 
        style={{ 
          animation: "loading-dot-bounce 1.4s ease-in-out infinite",
          animationDelay: "0.2s"
        }} 
      />
      <div 
        className="h-2 w-2 rounded-full bg-current" 
        style={{ 
          animation: "loading-dot-bounce 1.4s ease-in-out infinite",
          animationDelay: "0.4s"
        }} 
      />
    </div>
  )
}

