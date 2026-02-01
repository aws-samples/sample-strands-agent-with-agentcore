import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from './button'

interface CodeBlockProps {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: any;
}

export function CodeBlock({
  node,
  inline,
  className,
  children,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  
  const copyToClipboard = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const code = String(children).replace(/\n$/, '')
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  // This component now only handles code blocks
  // Inline code is handled directly in Markdown.tsx
  return (
    <span className="not-prose block">
      <span className="flex items-center justify-between bg-zinc-800 text-zinc-200 px-4 py-2 rounded-t-lg">
        <span className="text-label font-medium">
          {className?.replace('language-', '') || 'code'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </span>
      <code
        {...props}
        className="block text-label w-full overflow-x-auto bg-zinc-900 p-4 border border-zinc-200 dark:border-zinc-700 rounded-b-lg text-zinc-50 whitespace-pre-wrap break-words"
      >
        {children}
      </code>
    </span>
  )
}
