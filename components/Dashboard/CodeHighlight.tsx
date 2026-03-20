"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface CodeHighlightProps {
    code: string
    language: string
    /** Lock to dark syntax colors (e.g. dark panel). Default follows app theme. */
    variant?: 'default' | 'dark'
}

export function CodeHighlight({ code, language, variant = 'default' }: CodeHighlightProps) {
    const { resolvedTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    const useDarkSyntax =
        variant === 'dark' ||
        (variant === 'default' && mounted && resolvedTheme === 'dark')

    const prismStyle = useDarkSyntax ? vscDarkPlus : oneLight

    const getPrismLanguage = (lang: string): string => {
        const langMap: Record<string, string> = {
            'javascript': 'javascript',
            'typescript': 'typescript',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'html': 'markup',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'json': 'json',
            'markdown': 'markdown',
            'python': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'shell': 'bash',
            'yaml': 'yaml',
            'sql': 'sql',
            'php': 'php',
            'ruby': 'ruby',
            'go': 'go',
            'rust': 'rust',
            'swift': 'swift',
            'kotlin': 'kotlin',
            'text': 'text'
        }
        return langMap[lang.toLowerCase()] || 'text'
    }

    return (
        <div className="code-highlight-wrapper w-full box-border">
            <SyntaxHighlighter
                language={getPrismLanguage(language)}
                style={prismStyle}
                customStyle={{
                    margin: 0,
                    padding: 0,
                    background: 'transparent',
                    fontSize: '0.875rem',
                    lineHeight: '1.7',
                    whiteSpace: 'pre',
                    boxSizing: 'border-box',
                }}
                wrapLines={false}
                wrapLongLines={false}
                showLineNumbers={true}
                lineNumberStyle={{
                    minWidth: '3em',
                    paddingRight: '1em',
                    color: useDarkSyntax ? '#858585' : '#a1a1aa',
                    userSelect: 'none',
                }}
                PreTag="div"
                codeTagProps={{
                    style: {
                        whiteSpace: 'pre',
                        display: 'block',
                        boxSizing: 'border-box',
                    }
                }}
            >
                {code}
            </SyntaxHighlighter>
        </div>
    )
}
