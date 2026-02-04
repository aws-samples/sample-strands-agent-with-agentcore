"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, X, FileText, Loader2 } from 'lucide-react'

interface OutlineSection {
  section_id: string
  title: string
  description: string
  subsections?: OutlineSection[]
  estimated_words: number
}

interface Outline {
  title: string
  sections: OutlineSection[]
  total_estimated_words: number
  version: number
}

interface ComposeArtifactProps {
  isComposing: boolean
  progress: string
  outline: Outline | null
  showOutlineConfirm: boolean
  outlineAttempt: number
  documentParts: string[]
  completedDocument: { title: string; content: string; wordCount: number } | null
  onConfirmOutline: (approved: boolean, feedback?: string) => void
  onCancel: () => void
}

export function ComposeArtifact({
  isComposing,
  progress,
  outline,
  showOutlineConfirm,
  outlineAttempt,
  documentParts,
  completedDocument,
  onConfirmOutline,
  onCancel,
}: ComposeArtifactProps) {
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const maxAttempts = 3

  const handleApprove = () => {
    setFeedback('')
    setShowFeedback(false)
    onConfirmOutline(true)
  }

  const handleRevise = () => {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }

    if (feedback.trim()) {
      onConfirmOutline(false, feedback.trim())
      setFeedback('')
      setShowFeedback(false)
    }
  }

  const renderSection = (section: OutlineSection, depth = 0, isLast = false, parentIsLast = false) => {
    const hasSubsections = section.subsections && section.subsections.length > 0

    return (
      <div className={`${depth > 0 ? 'ml-6' : ''} mb-4`}>
        <div className="flex items-start gap-3 group">
          {/* Tree line decoration for nested items */}
          {depth > 0 && (
            <div className="flex-shrink-0 w-4 h-6 relative">
              <div className={`absolute top-0 left-0 w-4 h-3 border-l-2 border-b-2 border-muted-foreground/30 ${isLast ? 'rounded-bl-md' : ''}`} />
              {!isLast && <div className="absolute top-3 left-0 w-px h-full bg-muted-foreground/30" />}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 bg-muted/30 rounded-lg p-4 group-hover:bg-muted/50 transition-colors border border-border/50">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h4 className="font-semibold text-body">{section.title}</h4>
              <span className="text-label font-medium text-muted-foreground bg-background/80 px-2 py-1 rounded whitespace-nowrap">
                ~{section.estimated_words}w
              </span>
            </div>
            <p className="text-body text-muted-foreground leading-relaxed">{section.description}</p>
          </div>
        </div>

        {hasSubsections && (
          <div className="mt-2 relative">
            {section.subsections!.map((sub, idx) => (
              <React.Fragment key={`${section.section_id}-${sub.section_id || idx}`}>
                {renderSection(sub, depth + 1, idx === section.subsections!.length - 1, isLast)}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Loading state
  if (isComposing && !outline && !completedDocument) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-b from-background to-muted/20">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
          <Loader2 className="h-12 w-12 animate-spin text-primary relative" />
        </div>
        <h3 className="text-body font-semibold mb-2">Composing Document</h3>
        <p className="text-label text-muted-foreground">{progress || 'Starting composition...'}</p>
      </div>
    )
  }

  // Outline confirmation state
  if (showOutlineConfirm && outline) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 p-6 border-b bg-gradient-to-r from-blue-500/10 to-indigo-500/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="text-heading font-semibold">Review Document Outline</h2>
              </div>
              <p className="text-label text-muted-foreground">
                Attempt {outlineAttempt} of {maxAttempts}. Please review the proposed structure.
              </p>
            </div>
            <div className="bg-primary/10 px-3 py-1 rounded-full">
              <span className="text-caption font-semibold text-primary">
                {outlineAttempt}/{maxAttempts}
              </span>
            </div>
          </div>
        </div>

        {/* Outline content */}
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {/* Title Card */}
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-5 border-2 border-primary/20">
              <h3 className="text-heading font-semibold mb-2">{outline.title}</h3>
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span className="text-label font-medium">
                  Total: ~{outline.total_estimated_words} words
                </span>
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-2">
              {outline.sections.map((section, idx) => (
                <React.Fragment key={section.section_id || `section-${idx}`}>
                  {renderSection(section, 0, idx === outline.sections.length - 1)}
                </React.Fragment>
              ))}
            </div>
          </div>
        </ScrollArea>

        {/* Feedback textarea */}
        {showFeedback && (
          <div className="flex-shrink-0 p-6 border-t space-y-2">
            <label className="text-label font-medium">What changes would you like?</label>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="E.g., Add a section about cost analysis, make the introduction shorter..."
              className="min-h-[80px]"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex-shrink-0 p-6 border-t bg-muted/20">
          <div className="flex justify-between gap-3">
            <Button
              variant="ghost"
              onClick={onCancel}
              className="px-6"
            >
              Cancel
            </Button>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleRevise}
                disabled={outlineAttempt >= maxAttempts}
                className="px-6"
              >
                <X className="h-4 w-4 mr-2" />
                {showFeedback ? 'Submit Changes' : 'Request Revision'}
              </Button>
              <Button
                onClick={handleApprove}
                className="px-8 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-md"
              >
                <Check className="h-4 w-4 mr-2" />
                Approve & Continue
              </Button>
            </div>
          </div>
          {outlineAttempt >= maxAttempts && (
            <p className="text-caption text-muted-foreground text-center mt-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md py-2">
              Maximum revision attempts reached. Please approve to continue.
            </p>
          )}
        </div>
      </div>
    )
  }

  // Writing in progress
  if (isComposing && outline) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-b from-background to-muted/20">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-green-500/20 rounded-full blur-xl animate-pulse" />
          <Loader2 className="h-12 w-12 animate-spin text-green-500 relative" />
        </div>
        <h3 className="text-body font-semibold mb-2">Writing Document</h3>
        <p className="text-label text-muted-foreground mb-3">{progress || 'Writing document...'}</p>
        {documentParts.length > 0 && (
          <div className="flex items-center gap-2 text-caption text-muted-foreground bg-muted/50 px-4 py-2 rounded-full">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span>{documentParts.length} parts received</span>
          </div>
        )}
      </div>
    )
  }

  // Completed document
  if (completedDocument) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 p-6 border-b bg-gradient-to-r from-green-500/10 to-emerald-500/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-caption font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">
                  Completed
                </span>
              </div>
              <h2 className="text-heading font-bold mb-1">{completedDocument.title}</h2>
              <p className="text-label text-muted-foreground">
                {completedDocument.wordCount} words
              </p>
            </div>
          </div>
        </div>
        <ScrollArea className="flex-1 p-6">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {completedDocument.content}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return null
}
