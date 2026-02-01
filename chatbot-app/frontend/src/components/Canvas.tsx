"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, FileText, Image as ImageIcon, Code, FileDown, Sparkles, Printer, Clock, Tag, GripHorizontal } from 'lucide-react'
import { Artifact } from '@/types/artifact'
import { ComposeArtifact } from '@/components/ComposeArtifact'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { marked } from 'marked'

interface CanvasProps {
  isOpen: boolean
  onClose: () => void
  artifacts: Artifact[]
  selectedArtifactId: string | null
  onSelectArtifact: (id: string) => void
  composeState?: any // Live composer state
  justUpdated?: boolean // Flash effect trigger when artifact is updated
}

const getArtifactIcon = (type: string) => {
  switch (type) {
    case 'markdown':
    case 'research':
    case 'document':
      return <FileText className="h-4 w-4" />
    case 'image':
      return <ImageIcon className="h-4 w-4" />
    case 'code':
      return <Code className="h-4 w-4" />
    case 'compose':
      return <Sparkles className="h-4 w-4" />
    default:
      return <Sparkles className="h-4 w-4" />
  }
}

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
  return date.toLocaleDateString()
}

const getArtifactTypeLabel = (type: string) => {
  switch (type) {
    case 'research': return 'Research'
    case 'markdown': return 'Markdown'
    case 'image': return 'Image'
    case 'code': return 'Code'
    case 'document': return 'Document'
    case 'browser': return 'Browser'
    case 'compose': return 'Compose'
    default: return 'Artifact'
  }
}

// Helper to extract preview text from artifact content
const getPreviewText = (artifact: Artifact): string => {
  if (typeof artifact.content === 'string') {
    // Remove markdown formatting for preview
    const text = artifact.content
      .replace(/#{1,6}\s/g, '') // Remove headers
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.+?)\*/g, '$1') // Remove italic
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
      .replace(/\n+/g, ' ') // Replace newlines with space
      .trim()
    return text.substring(0, 80) + (text.length > 80 ? '...' : '')
  }
  return ''
}

export function Canvas({
  isOpen,
  onClose,
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  composeState,
  justUpdated = false,
}: CanvasProps) {
  const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId)

  // Filter out compose type artifacts from the list (only show completed artifacts)
  const displayArtifacts = artifacts.filter(a => a.type !== 'compose')

  // Handle close - if outline confirmation is showing, treat as cancel
  const handleClose = useCallback(() => {
    if (composeState?.showOutlineConfirm && composeState?.onCancel) {
      // Outline confirmation is showing, treat close as cancel
      composeState.onCancel()
    } else {
      // Normal close
      onClose()
    }
  }, [composeState, onClose])

  // Download artifact as Markdown
  const handleDownloadMarkdown = () => {
    if (!selectedArtifact || typeof selectedArtifact.content !== 'string') return

    const filename = `${selectedArtifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`
    const blob = new Blob([selectedArtifact.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Export to PDF via print
  const handlePrintPDF = () => {
    if (!selectedArtifact || typeof selectedArtifact.content !== 'string') return

    // Convert markdown to HTML
    const htmlContent = marked.parse(selectedArtifact.content)

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${selectedArtifact.title}</title>
        <style>
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1.7;
            margin: 0;
            padding: 0;
            color: #333;
          }
          .container {
            max-width: 100%;
            margin: 0 auto;
            padding: 30mm 25mm;
          }
          h1 {
            font-size: 2.2em;
            margin-top: 0;
            margin-bottom: 0.8em;
            font-weight: 600;
            line-height: 1.2;
          }
          h2 {
            font-size: 1.6em;
            margin-top: 1.8em;
            margin-bottom: 0.6em;
            font-weight: 600;
            line-height: 1.3;
          }
          h3 {
            font-size: 1.3em;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            font-weight: 600;
          }
          h4, h5, h6 {
            margin-top: 1.2em;
            margin-bottom: 0.5em;
            font-weight: 600;
          }
          p {
            margin: 0.8em 0;
            text-align: justify;
          }
          ul, ol {
            margin: 0.8em 0;
            padding-left: 2.5em;
          }
          li {
            margin: 0.4em 0;
          }
          code {
            background: #f5f5f5;
            padding: 0.2em 0.5em;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
          }
          pre {
            background: #f8f8f8;
            padding: 1.2em;
            border-radius: 5px;
            overflow-x: auto;
            margin: 1.2em 0;
            border: 1px solid #e0e0e0;
          }
          pre code {
            background: none;
            padding: 0;
          }
          blockquote {
            border-left: 4px solid #ddd;
            padding-left: 1.2em;
            margin: 1.2em 0;
            color: #666;
            font-style: italic;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 0.6em;
            text-align: left;
          }
          th {
            background: #f5f5f5;
            font-weight: 600;
          }
          @media print {
            body {
              margin: 0;
              padding: 0;
            }
            .container {
              padding: 20mm 25mm;
            }
            h1, h2, h3, h4, h5, h6 {
              page-break-after: avoid;
            }
            p, li {
              orphans: 3;
              widows: 3;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          ${htmlContent}
        </div>
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
      </html>
    `

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(printContent)
      printWindow.document.close()
    }
  }

  // Resizable bottom panel
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200) // Initial height: 200px
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartY.current = e.clientY
    resizeStartHeight.current = bottomPanelHeight
  }, [bottomPanelHeight])

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return

    const deltaY = resizeStartY.current - e.clientY // Inverted because moving up increases height
    const newHeight = Math.max(100, Math.min(600, resizeStartHeight.current + deltaY)) // Min 100px, Max 600px
    setBottomPanelHeight(newHeight)
  }, [isResizing])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Add/remove global mouse event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove)
      document.addEventListener('mouseup', handleResizeEnd)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'

      return () => {
        document.removeEventListener('mousemove', handleResizeMove)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  if (!isOpen) return null

  return (
    <div
      className="fixed top-0 right-0 h-screen w-full md:w-[950px] md:max-w-[80vw] bg-sidebar-background border-l border-sidebar-border text-sidebar-foreground flex flex-col z-40 shadow-2xl"
      style={{ transition: 'transform 0.3s ease-in-out' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-sidebar-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-sidebar-foreground" />
            <span className="text-heading font-semibold text-sidebar-foreground">Canvas</span>
            {artifacts.length > 0 && (
              <span className="text-label text-sidebar-foreground/60">({artifacts.length})</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-8 w-8 p-0"
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Preview Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {selectedArtifact ? (
            selectedArtifact.type === 'compose' && composeState ? (
              // Special rendering for compose type - full control with live state
              <ComposeArtifact {...composeState} />
            ) : (
            <>
              {/* Preview Header */}
              <div className="px-4 py-3 border-b border-sidebar-border/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-heading text-sidebar-foreground truncate mb-2">
                      {selectedArtifact.title}
                    </h3>
                    <div className="flex items-center gap-4 text-label text-sidebar-foreground/60">
                      {/* Type */}
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5" />
                        <span>{getArtifactTypeLabel(selectedArtifact.type)}</span>
                      </div>
                      {/* Timestamp */}
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{formatTimestamp(selectedArtifact.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Action Buttons */}
                  {selectedArtifact.type === 'document' && typeof selectedArtifact.content === 'string' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadMarkdown}
                        className="h-8 px-3"
                        title="Download as Markdown file"
                      >
                        <FileDown className="h-4 w-4 mr-1.5" />
                        Download MD
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handlePrintPDF}
                        className="h-8 px-3"
                        title="Print to PDF"
                      >
                        <Printer className="h-4 w-4 mr-1.5" />
                        PDF
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Preview Content */}
              <ScrollArea className="flex-1">
                <div className={`p-4 transition-all duration-500 ${justUpdated ? 'bg-green-500/10 ring-2 ring-green-500/30 rounded-lg' : ''}`}>
                  {(selectedArtifact.type === 'markdown' || selectedArtifact.type === 'research' || selectedArtifact.type === 'document') && typeof selectedArtifact.content === 'string' ? (
                    <div className="prose dark:prose-invert max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          // Style links
                          a: ({ node, ...props }) => (
                            <a
                              {...props}
                              className="text-blue-500 hover:text-blue-600 underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                          // Style code blocks
                          code: ({ node, ...props }: any) =>
                            (props as any).inline ? (
                              <code
                                {...props}
                                className="bg-muted px-1.5 py-0.5 rounded text-label font-mono"
                              />
                            ) : (
                              <code
                                {...props}
                                className="block bg-muted p-3 rounded-md text-label font-mono overflow-x-auto"
                              />
                            ),
                        }}
                      >
                        {selectedArtifact.content}
                      </ReactMarkdown>
                    </div>
                  ) : selectedArtifact.type === 'image' ? (
                    <div className="flex items-center justify-center">
                      <img
                        src={selectedArtifact.content}
                        alt={selectedArtifact.title}
                        className="max-w-full h-auto rounded-lg shadow-lg"
                      />
                    </div>
                  ) : (
                    <div className="text-label text-sidebar-foreground/60">
                      Preview not available for this artifact type
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
            )
          ) : (
            <div className="flex-1 flex items-center justify-center text-sidebar-foreground/50">
              <div className="text-center">
                <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-label">Select a canvas item to preview</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Artifact List - Horizontal Scroll (Resizable) */}
        <div
          className="flex-shrink-0 border-t border-sidebar-border/50 bg-sidebar-background/50 flex flex-col"
          style={{ height: `${bottomPanelHeight}px` }}
        >
          {/* Resize Handle */}
          <div
            className="w-full h-2 cursor-ns-resize hover:bg-primary/10 active:bg-primary/20 transition-colors flex items-center justify-center group"
            onMouseDown={handleResizeStart}
          >
            <GripHorizontal className="h-3 w-3 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/60 transition-colors" />
          </div>

          <div className="px-4 py-3 flex-1 flex flex-col min-h-0">
            <div className="text-caption font-medium text-sidebar-foreground/60 uppercase tracking-wide mb-3">
              Canvas Library ({displayArtifacts.length})
            </div>
            <div className="overflow-x-auto overflow-y-hidden flex-1">
              <div className="flex gap-4 pb-2 min-w-min h-full">
                {displayArtifacts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-label text-sidebar-foreground/50 w-full">
                    No artifacts yet
                  </div>
                ) : (
                  displayArtifacts.map((artifact) => {
                    const preview = getPreviewText(artifact)
                    return (
                      <button
                        key={artifact.id}
                        onClick={() => onSelectArtifact(artifact.id)}
                        className={`flex-shrink-0 w-72 text-left p-4 rounded-xl border-2 transition-all ${
                          selectedArtifactId === artifact.id
                            ? 'bg-primary/5 border-primary shadow-md ring-1 ring-primary/20'
                            : 'bg-sidebar-background border-sidebar-border hover:border-primary/50 hover:bg-sidebar-accent/30 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <div className="mt-0.5 flex-shrink-0 p-2 rounded-lg bg-primary/10">
                            {getArtifactIcon(artifact.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-label truncate mb-1 text-sidebar-foreground">
                              {artifact.title}
                            </div>
                            <div className="flex items-center gap-2 text-caption text-sidebar-foreground/60">
                              <span className="font-medium">{getArtifactTypeLabel(artifact.type)}</span>
                              <span>•</span>
                              <span>{formatTimestamp(artifact.timestamp)}</span>
                            </div>
                          </div>
                        </div>
                        {preview && (
                          <p className="text-caption text-sidebar-foreground/60 line-clamp-2 leading-relaxed">
                            {preview}
                          </p>
                        )}
                        {artifact.description && (
                          <div className="mt-2 text-caption text-sidebar-foreground/50">
                            {artifact.description}
                          </div>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
