"use client"

import React, { useEffect, useRef, useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Monitor, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

interface BrowserResultModalProps {
  isOpen: boolean
  onClose: () => void
  query: string
  isLoading: boolean
  result: string
  status: 'idle' | 'running' | 'complete' | 'error'
  browserProgress?: Array<{ stepNumber: number; content: string }>
}

export function BrowserResultModal({
  isOpen,
  onClose,
  query,
  isLoading,
  result,
  status,
  browserProgress
}: BrowserResultModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Extract markdown content from browser automation result
  const extractMarkdownContent = (result: string): string => {
    if (!result) {
      console.log('[BrowserResultModal] No result')
      return ''
    }

    console.log('[BrowserResultModal] Result length:', result.length)
    console.log('[BrowserResultModal] Result preview:', result.substring(0, 500))

    // Helper function to unescape JSON-escaped strings
    const unescapeJsonString = (str: string): string => {
      if (str.includes('\\n') || str.includes('\\u') || str.includes('\\t')) {
        try {
          // Properly escape both backslashes and quotes to prevent injection
          const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          const unescaped = JSON.parse(`"${escaped}"`)
          console.log('[BrowserResultModal] ✅ Unescaped JSON-escaped content')
          return unescaped
        } catch (e) {
          console.log('[BrowserResultModal] JSON.parse failed, using regex unescape')
          return str
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        }
      }
      return str
    }

    // Try to parse as JSON (if backend sends structured format)
    try {
      const parsed = JSON.parse(result)
      if (parsed.text && typeof parsed.text === 'string') {
        console.log('[BrowserResultModal] ✅ Extracted from JSON text field')
        return unescapeJsonString(parsed.text)
      }
      if (parsed.content && typeof parsed.content === 'string') {
        console.log('[BrowserResultModal] ✅ Extracted from JSON content field')
        return unescapeJsonString(parsed.content)
      }
    } catch (e) {
      // Not JSON, continue
      console.log('[BrowserResultModal] Not JSON format, using as-is')
    }

    // Return as-is (already markdown from Browser Use Agent)
    return unescapeJsonString(result)
  }

  // Get cleaned markdown content
  const markdownContent = useMemo(() => {
    if (!result) return ''
    return extractMarkdownContent(result)
  }, [result])

  // Combine browser progress steps for display during loading
  const progressContent = useMemo(() => {
    if (!browserProgress || browserProgress.length === 0) return ''
    return browserProgress
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map(step => step.content)
      .join('\n')
  }, [browserProgress])

  // Auto scroll to bottom when result or progress updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [result, progressContent])

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'Browser automation in progress...'
      case 'complete':
        return 'Automation complete'
      case 'error':
        return 'Automation failed'
      default:
        return 'Starting browser...'
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      default:
        return 'text-blue-500'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Monitor className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <DialogTitle className="text-heading font-semibold">Browser Use Agent</DialogTitle>
              <DialogDescription className="text-label mt-1">
                {query}
              </DialogDescription>
            </div>
          </div>

          {/* Status bar */}
          {isLoading && (
            <div className="mt-4 flex items-center gap-2 text-label">
              <Loader2 className={`w-4 h-4 animate-spin ${getStatusColor()}`} />
              <span className={getStatusColor()}>{getStatusText()}</span>
            </div>
          )}
        </DialogHeader>

        {/* Content area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-4"
        >
          {/* Show progress content during loading */}
          {isLoading && progressContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {progressContent}
              </ReactMarkdown>
            </div>
          ) : markdownContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {markdownContent}
              </ReactMarkdown>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p className="text-label">Starting browser automation...</p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-label">No results yet</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {status === 'complete' && (
          <div className="px-6 py-4 border-t bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-caption text-muted-foreground">
                Automation completed • {Math.round(result.length / 1000)}k characters
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={onClose}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
