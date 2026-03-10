"use client"

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface CodeHighlightProps {
    code: string
    language: string
}

export function CodeHighlight({ code, language }: CodeHighlightProps) {
    // Map common file extensions to Prism language identifiers
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
        <div className="code-highlight-wrapper" style={{ width: '100%', boxSizing: 'border-box' }}>
            <SyntaxHighlighter
                language={getPrismLanguage(language)}
                style={vscDarkPlus}
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
                    color: '#858585',
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

