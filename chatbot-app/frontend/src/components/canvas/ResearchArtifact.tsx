"use client"

import React, { useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, X, FlaskConical, Loader2, FileDown, Printer } from 'lucide-react'
import { citationPrintCSS } from '@/components/ui/CitationLink'
import { Markdown } from '@/components/ui/Markdown'

interface ResearchArtifactProps {
  isResearching: boolean
  progress: string
  plan: { plan: string; planPreview?: string } | null
  showPlanConfirm: boolean
  resultParts: string[]
  completedResult: { title: string; content: string } | null
  onConfirmPlan: (approved: boolean) => void
  onCancel: () => void
  sessionId?: string
}

export function ResearchArtifact({
  isResearching,
  progress,
  plan,
  showPlanConfirm,
  resultParts,
  completedResult,
  onConfirmPlan,
  onCancel,
  sessionId,
}: ResearchArtifactProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  const handleApprove = () => {
    onConfirmPlan(true)
  }

  const handleDecline = () => {
    onConfirmPlan(false)
  }

  // Download as Markdown
  const handleDownloadMarkdown = useCallback(() => {
    if (!completedResult) return

    const filename = `${completedResult.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`
    const blob = new Blob([completedResult.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [completedResult])

  // Export to PDF via print - uses already rendered HTML with resolved image URLs
  const handlePrintPDF = useCallback(() => {
    if (!completedResult || !contentRef.current) return

    const htmlContent = contentRef.current.innerHTML

    // Base document styles
    const baseCSS = `
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.7; padding: 40px; max-width: 800px; margin: 0 auto; color: #333; }
      h1 { font-size: 28px; margin-bottom: 24px; color: #111; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
      h2 { font-size: 22px; margin-top: 32px; margin-bottom: 16px; color: #222; }
      h3 { font-size: 18px; margin-top: 24px; margin-bottom: 12px; color: #333; }
      p { margin-bottom: 16px; }
      code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 14px; font-family: monospace; }
      pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
      pre code { background: none; padding: 0; }
      blockquote { border-left: 4px solid #3b82f6; margin: 16px 0; padding-left: 16px; color: #666; background: #f8fafc; padding: 12px 16px; border-radius: 0 8px 8px 0; }
      ul, ol { margin-bottom: 16px; padding-left: 24px; }
      li { margin-bottom: 8px; }
      table { border-collapse: collapse; width: 100%; margin: 16px 0; }
      th, td { border: 1px solid #e5e7eb; padding: 12px; text-align: left; }
      th { background: #f9fafb; font-weight: 600; }
      strong { color: #111; }
      img { max-width: 70%; height: auto; margin: 1.5em auto; display: block; }
      .print-controls { position: fixed; top: 20px; right: 20px; display: flex; gap: 8px; z-index: 1000; }
      .print-controls button { padding: 10px 20px; font-size: 14px; font-weight: 500; border: none; border-radius: 6px; cursor: pointer; }
      .print-btn { background-color: #2563eb; color: white; }
      .close-btn { background-color: #e5e7eb; color: #374151; }
      @media print { .print-controls { display: none; } }
    `

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${completedResult.title}</title>
        <style>${baseCSS}${citationPrintCSS}</style>
      </head>
      <body>
        <div class="print-controls">
          <button class="print-btn" onclick="window.print()">Save as PDF</button>
          <button class="close-btn" onclick="window.close()">Close</button>
        </div>
        <article>${htmlContent}</article>
      </body>
      </html>
    `

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(printContent)
      printWindow.document.close()
    }
  }, [completedResult])

  // Loading state - starting research
  if (isResearching && !plan && !completedResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-b from-background to-muted/20">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 relative" />
        </div>
        <h3 className="text-body font-semibold mb-2">Starting Research</h3>
        <p className="text-label text-muted-foreground">{progress || 'Initializing research agent...'}</p>
      </div>
    )
  }

  // Plan confirmation state
  if (showPlanConfirm && plan) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 p-6 border-b bg-gradient-to-r from-blue-500/10 to-indigo-500/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="h-5 w-5 text-blue-500" />
                <h2 className="text-heading font-semibold">Review Research Plan</h2>
              </div>
              <p className="text-label text-muted-foreground">
                Review the proposed research plan before proceeding.
              </p>
            </div>
          </div>
        </div>

        {/* Plan content */}
        <ScrollArea className="flex-1 p-6">
          <div className="prose prose-lg dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-7 text-foreground bg-transparent border-0 p-0 m-0">
              {plan.plan}
            </pre>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-border/50">
          <div className="flex justify-end items-center gap-2">
            <button
              onClick={handleDecline}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded-lg transition-all"
            >
              <X className="h-3.5 w-3.5" />
              Decline
            </button>
            <button
              onClick={handleApprove}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all shadow-sm hover:shadow"
            >
              <Check className="h-3.5 w-3.5" />
              Approve & Start
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Research in progress
  if (isResearching && plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-b from-background to-muted/20">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 relative" />
        </div>
        <h3 className="text-body font-semibold mb-2">Research in Progress</h3>
        <p className="text-label text-muted-foreground mb-3">{progress || 'Conducting research...'}</p>
        {resultParts.length > 0 && (
          <div className="flex items-center gap-2 text-caption text-muted-foreground bg-muted/50 px-4 py-2 rounded-full">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span>{resultParts.length} sections received</span>
          </div>
        )}
      </div>
    )
  }

  // Completed research
  if (completedResult) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 p-6 border-b bg-gradient-to-r from-green-500/10 to-emerald-500/10">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-caption font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">
                  Completed
                </span>
              </div>
              <h2 className="text-heading font-bold mb-1">{completedResult.title}</h2>
            </div>
            {/* Download Buttons */}
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
          </div>
        </div>
        <ScrollArea className="flex-1 p-6">
          <div ref={contentRef}>
            <Markdown sessionId={sessionId}>
              {completedResult.content}
            </Markdown>
          </div>
        </ScrollArea>
      </div>
    )
  }

  return null
}
