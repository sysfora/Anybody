"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { ChevronDown, Globe, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type VisibilityOption = "public" | "private"

interface VisibilityDropdownProps {
  value: VisibilityOption
  onValueChange: (value: VisibilityOption) => void
  className?: string
  disabled?: boolean
}

export function VisibilityDropdown({ 
  value, 
  onValueChange, 
  className,
  disabled = false
}: VisibilityDropdownProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const options = [
    {
      value: "public" as const,
      label: "Public",
      icon: Globe,
      description: "Visible to everyone"
    },
    {
      value: "private" as const,
      label: "Private", 
      icon: Lock,
      description: "Only visible to you"
    }
  ]

  const selectedOption = options.find(option => option.value === value)

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className={cn(
          "h-8 px-2 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        {selectedOption && (
          <>
            <selectedOption.icon className="h-3 w-3" />
            <span className="hidden sm:inline">{selectedOption.label}</span>
          </>
        )}
        <ChevronDown className="h-3 w-3" />
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 px-2 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          {selectedOption && (
            <>
              <selectedOption.icon className="h-3 w-3" />
              <span className="hidden sm:inline">{selectedOption.label}</span>
            </>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-48 bg-background border border-border text-left">
        {options.map((option) => {
          const Icon = option.icon
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onValueChange(option.value)}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer text-left"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col items-start">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
