"use client"

import { useState, useEffect, useRef, useCallback } from "react"

interface TypewriterProps {
    content: string
    speed?: number
    onComplete?: () => void
    enabled?: boolean
    className?: string
}

export function Typewriter({ 
    content, 
    speed = 30, // Slower default speed (20ms)
    onComplete, 
    enabled = true,
    className 
}: TypewriterProps) {
    const [displayedText, setDisplayedText] = useState("")
    const indexRef = useRef(0)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const contentRef = useRef(content)
    const hasCompletedRef = useRef(false)

    // Handle content changes
    useEffect(() => {
        // If disabled, show all content immediately
        if (!enabled) {
            setDisplayedText(content)
            indexRef.current = content.length
            return
        }

        // If content is significantly different (not just appended), reset
        if (content.length < displayedText.length || !content.startsWith(displayedText.slice(0, Math.min(displayedText.length, 50)))) {
            setDisplayedText("")
            indexRef.current = 0
            hasCompletedRef.current = false
        }
        contentRef.current = content
    }, [content, displayedText, enabled])

    useEffect(() => {
        if (!enabled) {
            setDisplayedText(content)
            indexRef.current = content.length
            return
        }

        const animate = () => {
            const currentContent = contentRef.current
            if (indexRef.current < currentContent.length) {
                // Type 1-2 characters at once for smoother typewriter effect
                const charsToAdd = Math.min(2, currentContent.length - indexRef.current)
                const newChars = currentContent.slice(indexRef.current, indexRef.current + charsToAdd)
                setDisplayedText((prev) => prev + newChars)
                indexRef.current += charsToAdd
                timeoutRef.current = setTimeout(animate, speed)
            } else if (!hasCompletedRef.current && currentContent.length > 0 && indexRef.current >= currentContent.length) {
                hasCompletedRef.current = true
                if (onComplete) onComplete()
            }
        }

        // Start animation if we have new content to show
        if (indexRef.current < content.length) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            timeoutRef.current = setTimeout(animate, speed)
        }

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
        }
    }, [content, speed, onComplete, enabled])

    return <span className={className}>{displayedText}</span>
}

// Hook for managing typewriter state externally
export function useTypewriter(content: string, speed: number = 20, enabled: boolean = true) {
    const [displayedText, setDisplayedText] = useState("")
    const [isComplete, setIsComplete] = useState(false)
    const indexRef = useRef(0)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const contentRef = useRef(content)

    const reset = useCallback(() => {
        setDisplayedText("")
        setIsComplete(false)
        indexRef.current = 0
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }, [])

    useEffect(() => {
        if (!enabled) {
            setDisplayedText(content)
            setIsComplete(true)
            indexRef.current = content.length
            return
        }

        // Handle content changes
        if (content.length < displayedText.length || !content.startsWith(displayedText.slice(0, Math.min(displayedText.length, 50)))) {
            reset()
        }
        contentRef.current = content
    }, [content, displayedText, enabled, reset])

    useEffect(() => {
        if (!enabled) {
            setDisplayedText(content)
            setIsComplete(true)
            return
        }

        const animate = () => {
            const currentContent = contentRef.current
            if (indexRef.current < currentContent.length) {
                // Type 1-2 characters at once for smoother effect
                const charsToAdd = Math.min(2, currentContent.length - indexRef.current)
                const newChars = currentContent.slice(indexRef.current, indexRef.current + charsToAdd)
                setDisplayedText((prev) => prev + newChars)
                indexRef.current += charsToAdd
                timeoutRef.current = setTimeout(animate, speed)
            } else if (currentContent.length > 0 && indexRef.current >= currentContent.length) {
                setIsComplete(true)
            }
        }

        if (indexRef.current < content.length) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            timeoutRef.current = setTimeout(animate, speed)
        }

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
        }
    }, [content, speed, enabled])

    return { displayedText, isComplete, reset }
}
