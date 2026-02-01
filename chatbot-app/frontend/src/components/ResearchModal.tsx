"use client"

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FlaskConical, Loader2, FileDown, FileText } from 'lucide-react'
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
  const contentRef = useRef<HTMLDivElement>(null)
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map())
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)
  // Map alt text to S3 keys (workaround for rehypeRaw losing src)
  const [altToS3Key, setAltToS3Key] = useState<Map<string, string>>(new Map())

  // Extract markdown content from research agent result
  const extractMarkdownContent = (result: string): string => {
    if (!result) return ''

    // Helper function to unescape JSON-escaped strings
    const unescapeJsonString = (str: string): string => {
      if (str.includes('\\n') || str.includes('\\u') || str.includes('\\t')) {
        try {
          const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          return JSON.parse(`"${escaped}"`)
        } catch (e) {
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
      return unescapeJsonString(researchMatch[1].trim())
    }

    // 2. Try to parse as JSON (legacy format)
    try {
      const parsed = JSON.parse(result)
      if (parsed.content && typeof parsed.content === 'string') {
        return parsed.content
      }
      if (parsed.text && typeof parsed.text === 'string') {
        const innerMatch = parsed.text.match(/<research>([\s\S]*?)<\/research>/)
        if (innerMatch && innerMatch[1]) {
          return unescapeJsonString(innerMatch[1].trim())
        }
        return unescapeJsonString(parsed.text)
      }
    } catch (e) {
      // Not JSON, continue with other methods
    }

    // 3. Fallback: Look for first H1 heading
    const h1Match = result.match(/^#\s+.+$/m)
    if (h1Match && h1Match.index !== undefined) {
      return unescapeJsonString(result.substring(h1Match.index))
    }

    // 4. Last resort: return as is
    return unescapeJsonString(result)
  }

  // Remove duplicate consecutive headings (backend sometimes sends duplicates)
  const removeDuplicateHeadings = (markdown: string): string => {
    const lines = markdown.split('\n')
    const result: string[] = []
    let prevHeading = ''

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        const currentHeading = line.trim()
        if (currentHeading === prevHeading) {
          continue // Skip duplicate heading
        }
        prevHeading = currentHeading
      }
      result.push(line)
    }

    return result.join('\n')
  }

  // Get cleaned markdown content
  const markdownContent = useMemo(() => {
    if (!result) return ''
    const extracted = extractMarkdownContent(result)
    return removeDuplicateHeadings(extracted)
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

    for (const match of matches) {
      const s3Key = match[2]

      // Skip if already resolved or loading
      if (imageUrls.has(s3Key) || loadingImages.has(s3Key)) continue

      // Mark as loading
      setLoadingImages(prev => new Set(prev).add(s3Key))

      try {
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
        setImageUrls(prev => new Map(prev).set(s3Key, url))
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

  // Export as plain text/markdown file (memory-efficient alternative to PDF)
  const handleExportMarkdown = () => {
    if (!markdownContent) return

    // Replace S3 keys with resolved URLs where available
    let exportContent = markdownContent

    // Replace s3:// URLs with pre-signed URLs
    imageUrls.forEach((resolvedUrl, s3Key) => {
      // Replace both markdown image syntax and raw s3:// references
      exportContent = exportContent.replace(
        new RegExp(`\\]\\(${s3Key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
        `](${resolvedUrl})`
      )
    })

    // Replace local chart paths with full URLs
    if (sessionId) {
      const chartRegex = /!\[([^\]]*)\]\((charts\/[^)]+)\)/g
      exportContent = exportContent.replace(chartRegex, (match, alt, chartPath) => {
        const filename = chartPath.replace('charts/', '')
        const fullUrl = `${window.location.origin}/api/charts/${filename}?session_id=${sessionId}&user_id=anonymous`
        return `![${alt}](${fullUrl})`
      })
    }

    // Add note about image URLs at the top
    const hasImages = exportContent.includes('![')
    const header = hasImages
      ? `<!-- Note: Image URLs in this document may expire. Save images separately if needed. -->\n\n`
      : ''

    const filename = `research-report-${new Date().toISOString().split('T')[0]}.md`
    const blob = new Blob([header + exportContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Check if all images are loaded
  const areImagesLoaded = loadingImages.size === 0

  // Export to PDF - opens print-optimized view in new window
  const handleExportPDF = () => {
    if (!contentRef.current || isExporting) return

    // Warn if images are still loading
    if (!areImagesLoaded) {
      const proceed = window.confirm(
        'Some images are still loading. The PDF may be missing images. Continue anyway?'
      )
      if (!proceed) return
    }

    setIsExporting(true)

    try {
      // Get rendered HTML and convert relative URLs to absolute
      let htmlContent = contentRef.current.innerHTML
      const baseUrl = window.location.origin

      // Convert relative image URLs to absolute URLs
      htmlContent = htmlContent.replace(/src="\/api\//g, `src="${baseUrl}/api/`)

      // Generate print-optimized HTML
      const printHtml = generatePrintHtml(htmlContent, 'Research Report')

      // Open in new window for printing
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Unable to open print window. Please check your popup blocker settings.')
        return
      }

      printWindow.document.write(printHtml)
      printWindow.document.close()
    } catch (error) {
      console.error('[ResearchModal] PDF export failed:', error)
      alert('Failed to generate PDF. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Generate print-optimized HTML document
  const generatePrintHtml = (content: string, title: string): string => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: #ffffff;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { font-size: 24pt; color: #111; margin-top: 0; margin-bottom: 16pt; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 8pt; }
    h2 { font-size: 18pt; color: #111; margin-top: 24pt; margin-bottom: 12pt; font-weight: 600; }
    h3 { font-size: 14pt; color: #111; margin-top: 20pt; margin-bottom: 8pt; font-weight: 600; }
    h4, h5, h6 { font-size: 12pt; color: #111; margin-top: 16pt; margin-bottom: 8pt; font-weight: 600; }
    p { margin: 8pt 0; color: #1a1a1a; }
    ul, ol { margin: 8pt 0; padding-left: 24pt; color: #1a1a1a; }
    li { margin: 4pt 0; }
    a { color: #2563eb; text-decoration: underline; }
    code { background-color: #f3f4f6; color: #1f2937; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace; font-size: 10pt; }
    pre { background-color: #f3f4f6; color: #1f2937; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 10pt; margin: 12pt 0; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d1d5db; margin: 16pt 0; padding: 8pt 16pt; color: #4b5563; background-color: #f9fafb; font-style: italic; }
    table { border-collapse: collapse; width: 100%; margin: 16pt 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
    th { background-color: #f3f4f6; font-weight: 600; }
    img { max-width: 100%; height: auto; margin: 16pt auto; display: block; }
    strong, b { color: #111; font-weight: 600; }
    em, i { color: #1a1a1a; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24pt 0; }
    /* Citation link chips */
    a[href^="http"] {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin: 0 2px;
      font-size: 9pt;
      background-color: #f1f5f9;
      color: #475569;
      border-radius: 12px;
      text-decoration: none;
    }
    a[href^="http"]:hover { background-color: #e2e8f0; }
    a[href^="http"] svg { display: inline-block; width: 10px; height: 10px; }
    /* Section citations container */
    .section-citations { display: flex; flex-wrap: wrap; gap: 4px; margin: 8pt 0; }
    .citation-chip { display: inline-flex; align-items: center; margin: 0 2px; }
    /* Ensure spans are visible */
    span { color: inherit; }
    .print-controls { position: fixed; top: 20px; right: 20px; display: flex; gap: 8px; z-index: 1000; }
    .print-controls button { padding: 10px 20px; font-size: 14px; font-weight: 500; border: none; border-radius: 6px; cursor: pointer; }
    .print-btn { background-color: #2563eb; color: white; }
    .print-btn:hover { background-color: #1d4ed8; }
    .close-btn { background-color: #e5e7eb; color: #374151; }
    .close-btn:hover { background-color: #d1d5db; }
    @media print {
      body { padding: 0; }
      @page { margin: 20mm; size: A4; }
      .print-controls { display: none; }
      h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
      pre, blockquote, img { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn" onclick="window.print()">Save as PDF</button>
    <button class="close-btn" onclick="window.close()">Close</button>
  </div>
  <article>${content}</article>
</body>
</html>`
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl w-[90vw] h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <FlaskConical className="w-5 h-5 text-blue-500" />
            </div>
            <DialogTitle className="text-heading font-semibold">{agentName}</DialogTitle>
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
          {markdownContent ? (
            <div ref={contentRef} className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  // Custom image renderer to handle S3 keys and local charts
                  img: ({ node, src, alt, ...props }) => {
                    // Workaround: rehypeRaw loses src, use alt to find s3Key
                    const s3KeyFromAlt = alt ? altToS3Key.get(alt) : null
                    const actualS3Key = s3KeyFromAlt || src

                    // Check if this is an S3 key that needs resolving
                    if (actualS3Key && actualS3Key.startsWith('s3://')) {
                      const resolvedUrl = imageUrls.get(actualS3Key)
                      const isLoading = loadingImages.has(actualS3Key)

                      if (isLoading) {
                        return (
                          <span className="flex items-center justify-center p-4 bg-muted rounded" style={{ display: 'flex' }}>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            <span className="text-label text-muted-foreground">Loading image...</span>
                          </span>
                        )
                      }

                      if (resolvedUrl) {
                        return <img src={resolvedUrl} alt={alt} {...props} style={{ maxWidth: '70%', height: 'auto', margin: '1rem auto', display: 'block' }} />
                      }

                      // Fallback while resolving
                      return (
                        <span className="flex items-center justify-center p-4 bg-muted rounded" style={{ display: 'flex' }}>
                          <span className="text-label text-muted-foreground">Image pending...</span>
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
                  // Style links - show source domain for citations
                  a: ({ node, children, href, ...props }) => {
                    // Extract domain from URL for display
                    const getDomain = (url: string): string => {
                      try {
                        const hostname = new URL(url).hostname
                        // Remove www. prefix and return clean domain
                        return hostname.replace(/^www\./, '')
                      } catch {
                        return ''
                      }
                    }

                    const domain = href ? getDomain(href) : ''
                    const isExternalLink = href?.startsWith('http')

                    // For external links, show a styled citation chip with domain
                    if (isExternalLink && domain) {
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 text-caption bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300 no-underline transition-colors"
                          title={href}
                          {...props}
                        >
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          <span className="truncate max-w-[150px]">{domain}</span>
                        </a>
                      )
                    }

                    // For internal/anchor links, simple style
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
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
              <p className="text-label">Starting research...</p>
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
                Research completed • {Math.round(result.length / 1000)}k characters
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportMarkdown}
                  title="Download as Markdown file"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Markdown
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  title="Print to PDF (opens print dialog)"
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 mr-2" />
                  )}
                  PDF
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={onClose}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
