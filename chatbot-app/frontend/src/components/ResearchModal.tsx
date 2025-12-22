"use client"

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FlaskConical, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

interface ResearchModalProps {
  isOpen: boolean
  onClose: () => void
  query: string
  isLoading: boolean
  result: string
  status: 'idle' | 'searching' | 'analyzing' | 'generating' | 'complete' | 'error' | 'declined'
  sessionId?: string
  agentName?: string
}

export function ResearchModal({
  isOpen,
  onClose,
  query,
  isLoading,
  result,
  status,
  sessionId,
  agentName = 'Research Agent'
}: ResearchModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map())
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set())
  // Map alt text to S3 keys (workaround for rehypeRaw losing src)
  const [altToS3Key, setAltToS3Key] = useState<Map<string, string>>(new Map())

  // Extract markdown content from research agent result
  const extractMarkdownContent = (result: string): string => {
    if (!result) {
      console.log('[ResearchModal] No result')
      return ''
    }

    console.log('[ResearchModal] Result length:', result.length)
    console.log('[ResearchModal] Result preview:', result.substring(0, 500))

    // Helper function to unescape JSON-escaped strings
    const unescapeJsonString = (str: string): string => {
      // Check if string looks like it's JSON-escaped (contains literal \n, \u, etc.)
      if (str.includes('\\n') || str.includes('\\u') || str.includes('\\t')) {
        try {
          // Wrap in quotes and parse as JSON to unescape
          // Properly escape both backslashes and quotes to prevent injection
          const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          const unescaped = JSON.parse(`"${escaped}"`)
          console.log('[ResearchModal] ✅ Unescaped JSON-escaped content')
          return unescaped
        } catch (e) {
          // If parsing fails, try a simpler approach
          console.log('[ResearchModal] JSON.parse failed, using regex unescape')
          return str
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        }
      }
      return str
    }

    // 1. Check for <research> XML tag (primary method)
    const researchMatch = result.match(/<research>([\s\S]*?)<\/research>/)
    if (researchMatch && researchMatch[1]) {
      console.log('[ResearchModal] ✅ Extracted markdown from <research> tag')
      const content = researchMatch[1].trim()
      // Unescape if needed (browser-use-agent may return escaped content)
      return unescapeJsonString(content)
    }
    console.log('[ResearchModal] ❌ No <research> tag found')

    // 2. Try to parse as JSON (legacy format)
    try {
      const parsed = JSON.parse(result)
      if (parsed.content && typeof parsed.content === 'string') {
        console.log('[ResearchModal] ✅ Extracted markdown content from JSON')
        return parsed.content
      }
      // Check for text field (browser-use-agent format)
      if (parsed.text && typeof parsed.text === 'string') {
        console.log('[ResearchModal] ✅ Extracted markdown content from JSON text field')
        // Check if text contains <research> tags
        const innerMatch = parsed.text.match(/<research>([\s\S]*?)<\/research>/)
        if (innerMatch && innerMatch[1]) {
          return unescapeJsonString(innerMatch[1].trim())
        }
        return unescapeJsonString(parsed.text)
      }
    } catch (e) {
      // Not JSON, continue with other methods
      console.log('[ResearchModal] Not JSON format')
    }

    // 3. Fallback: Look for first H1 heading
    const h1Match = result.match(/^#\s+.+$/m)
    if (h1Match && h1Match.index !== undefined) {
      const markdownContent = result.substring(h1Match.index)
      console.log('[ResearchModal] ✅ Extracted markdown content from H1 heading onwards')
      return unescapeJsonString(markdownContent)
    }
    console.log('[ResearchModal] ❌ No H1 heading found')

    // 4. Last resort: return as is (with unescape attempt)
    console.log('[ResearchModal] ⚠️ Returning result as-is')
    return unescapeJsonString(result)
  }

  // Get cleaned markdown content
  const markdownContent = useMemo(() => {
    if (!result) return ''
    return extractMarkdownContent(result)
  }, [result])

  // Auto scroll to bottom when result updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [result])

  // Extract S3 keys from markdown and generate pre-signed URLs
  const resolveS3Images = useCallback(async (markdown: string) => {
    // Find all S3 image references in markdown
    const s3Pattern = /!\[([^\]]*)\]\((s3:\/\/[^)]+)\)/g
    const matches = [...markdown.matchAll(s3Pattern)]

    // Build alt → s3Key mapping (workaround for rehypeRaw losing src)
    const altMap = new Map<string, string>()
    for (const match of matches) {
      const alt = match[1]
      const s3Key = match[2]
      altMap.set(alt, s3Key)
    }
    setAltToS3Key(altMap)
    console.log('[ResearchModal] Built alt → s3Key mapping:', Array.from(altMap.entries()))

    for (const match of matches) {
      const s3Key = match[2]

      // Skip if already resolved or loading
      if (imageUrls.has(s3Key) || loadingImages.has(s3Key)) continue

      // Mark as loading
      setLoadingImages(prev => new Set(prev).add(s3Key))

      try {
        console.log(`[ResearchModal] Resolving S3 image: ${s3Key}`)

        // Call BFF API to generate pre-signed URL
        const response = await fetch('/api/s3/presigned-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s3Key })
        })

        if (!response.ok) {
          console.error(`[ResearchModal] Failed to get pre-signed URL for ${s3Key}:`, response.statusText)
          continue
        }

        const { url } = await response.json()

        // Store the resolved URL
        setImageUrls(prev => {
          const next = new Map(prev).set(s3Key, url)
          console.log(`[ResearchModal] Stored URL in Map:`, { s3Key, url: url.substring(0, 100) + '...', mapSize: next.size })
          return next
        })
        console.log(`[ResearchModal] Resolved ${s3Key} to pre-signed URL`)
      } catch (error) {
        console.error(`[ResearchModal] Error resolving S3 image ${s3Key}:`, error)
      } finally {
        // Remove from loading set
        setLoadingImages(prev => {
          const next = new Set(prev)
          next.delete(s3Key)
          return next
        })
      }
    }
  }, [imageUrls, loadingImages])

  // Resolve S3 images when modal opens or markdown content changes
  useEffect(() => {
    if (isOpen && markdownContent) {
      console.log('[ResearchModal] Markdown content received:', markdownContent.substring(0, 500))
      console.log('[ResearchModal] Has images:', markdownContent.includes('!['))

      // Find all image patterns
      const imageMatches = markdownContent.match(/!\[.*?\]\(.*?\)/g)
      console.log('[ResearchModal] Image matches:', imageMatches)

      // Log full markdown to see structure
      console.log('[ResearchModal] FULL MARKDOWN:', markdownContent)

      resolveS3Images(markdownContent)
    }
  }, [isOpen, markdownContent, resolveS3Images])

  // Reset image URLs when modal closes
  useEffect(() => {
    if (!isOpen) {
      setImageUrls(new Map())
      setLoadingImages(new Set())
    }
  }, [isOpen])

  const getStatusText = () => {
    switch (status) {
      case 'searching':
        return 'Searching web sources...'
      case 'analyzing':
        return 'Analyzing information...'
      case 'generating':
        return 'Generating report...'
      case 'complete':
        return 'Research complete'
      case 'error':
        return 'Research failed'
      case 'declined':
        return 'Research declined'
      default:
        return 'Starting research...'
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      case 'declined':
        return 'text-yellow-500'
      default:
        return 'text-blue-500'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <FlaskConical className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">{agentName}</DialogTitle>
              <DialogDescription className="text-sm mt-1">
                {query}
              </DialogDescription>
            </div>
          </div>

          {/* Status bar */}
          {isLoading && (
            <div className="mt-4 flex items-center gap-2 text-sm">
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
          {markdownContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  // Custom image renderer to handle S3 keys and local charts
                  img: ({ node, src, alt, ...props }) => {
                    console.log(`[ResearchModal] IMG RENDERER CALLED:`, { src, alt, props })

                    // Workaround: rehypeRaw loses src, use alt to find s3Key
                    const s3KeyFromAlt = alt ? altToS3Key.get(alt) : null
                    const actualS3Key = s3KeyFromAlt || src

                    console.log(`[ResearchModal] Resolved s3Key:`, { alt, s3KeyFromAlt, actualS3Key })

                    // Check if this is an S3 key that needs resolving
                    if (actualS3Key && actualS3Key.startsWith('s3://')) {
                      const resolvedUrl = imageUrls.get(actualS3Key)
                      const isLoading = loadingImages.has(actualS3Key)

                      console.log(`[ResearchModal] Rendering S3 image:`, {
                        actualS3Key,
                        hasUrl: !!resolvedUrl,
                        isLoading,
                        mapSize: imageUrls.size,
                        allKeys: Array.from(imageUrls.keys())
                      })

                      if (isLoading) {
                        return (
                          <span className="flex items-center justify-center p-4 bg-muted rounded" style={{ display: 'flex' }}>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            <span className="text-sm text-muted-foreground">Loading image...</span>
                          </span>
                        )
                      }

                      if (resolvedUrl) {
                        console.log(`[ResearchModal] Rendering <img> with URL:`, resolvedUrl.substring(0, 100) + '...')
                        return <img src={resolvedUrl} alt={alt} {...props} style={{ maxWidth: '70%', height: 'auto', margin: '1rem auto', display: 'block' }} />
                      }

                      // Fallback while resolving
                      console.log(`[ResearchModal] No URL found, showing pending...`)
                      return (
                        <span className="flex items-center justify-center p-4 bg-muted rounded" style={{ display: 'flex' }}>
                          <span className="text-sm text-muted-foreground">Image pending...</span>
                        </span>
                      )
                    }

                    // Check if this is a local chart path (charts/*.png)
                    if (src && src.startsWith('charts/') && sessionId) {
                      const filename = src.replace('charts/', '')
                      const chartUrl = `/api/charts/${filename}?session_id=${sessionId}&user_id=anonymous`
                      return <img src={chartUrl} alt={alt} {...props} style={{ maxWidth: '70%', height: 'auto', margin: '1rem auto', display: 'block' }} />
                    }

                    // Regular image (not S3 or local chart)
                    if (!src) return null
                    return <img src={src} alt={alt} {...props} style={{ maxWidth: '70%', height: 'auto', margin: '1rem auto', display: 'block' }} />
                  },
                  // Custom renderer for citation chips - pass through children (contains link)
                  span: ({ node, className, children, ...props }) => {
                    if (className === 'citation-chip') {
                      return (
                        <span
                          className="inline-flex items-center justify-center mx-0.5"
                          {...props}
                        >
                          {children}
                        </span>
                      )
                    }
                    return <span className={className} {...props}>{children}</span>
                  },
                  // Custom renderer for citation containers - minimal design without box
                  div: ({ node, className, children, ...props }) => {
                    if (className === 'section-citations') {
                      return (
                        <div
                          className="flex flex-wrap gap-1 my-2"
                          {...props}
                        >
                          {children}
                        </div>
                      )
                    }
                    return <div className={className} {...props}>{children}</div>
                  },
                  // Style links - simple for citations, normal for others
                  a: ({ node, children, href, ...props }) => {
                    // Simple emoji link style (no underline, just hover effect, same size as text)
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 no-underline transition-colors"
                        {...props}
                      >
                        {children}
                      </a>
                    )
                  }
                }}
              >
                {markdownContent}
              </ReactMarkdown>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p className="text-sm">Starting research...</p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">No results yet</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {status === 'complete' && (
          <div className="px-6 py-4 border-t bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Research completed • {Math.round(result.length / 1000)}k characters
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
