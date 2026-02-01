"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, X, FileText } from 'lucide-react'

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

interface OutlineConfirmDialogProps {
  isOpen: boolean
  outline: Outline | null
  onConfirm: (approved: boolean, feedback?: string) => void
  onCancel: () => void
  attempt: number
  maxAttempts: number
}

export function OutlineConfirmDialog({
  isOpen,
  outline,
  onConfirm,
  onCancel,
  attempt = 1,
  maxAttempts = 3,
}: OutlineConfirmDialogProps) {
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  if (!outline) return null

  const handleApprove = () => {
    setFeedback('')
    setShowFeedback(false)
    onConfirm(true)
  }

  const handleRevise = () => {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }

    if (feedback.trim()) {
      onConfirm(false, feedback.trim())
      setFeedback('')
      setShowFeedback(false)
    }
  }

  const renderSection = (section: OutlineSection, depth = 0) => {
    return (
      <div key={section.section_id} className={`${depth > 0 ? 'ml-4' : ''} mb-3`}>
        <div className="flex items-start gap-2">
          <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">{section.title}</div>
            <div className="text-label text-muted-foreground">{section.description}</div>
            <div className="text-caption text-muted-foreground mt-1">
              ~{section.estimated_words} words
            </div>
          </div>
        </div>
        {section.subsections && section.subsections.length > 0 && (
          <div className="mt-2">
            {section.subsections.map(sub => (
              <React.Fragment key={sub.section_id}>
                {renderSection(sub, depth + 1)}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Review Document Outline
          </DialogTitle>
          <DialogDescription>
            Attempt {attempt} of {maxAttempts}. Please review the proposed structure.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-4">
          <div className="space-y-4">
            {/* Title */}
            <div className="border-b pb-3">
              <h3 className="text-heading font-semibold">{outline.title}</h3>
              <p className="text-label text-muted-foreground">
                Total: ~{outline.total_estimated_words} words
              </p>
            </div>

            {/* Sections */}
            <div className="space-y-3">
              {outline.sections.map(section => (
                <React.Fragment key={section.section_id}>
                  {renderSection(section)}
                </React.Fragment>
              ))}
            </div>
          </div>
        </ScrollArea>

        {/* Feedback textarea */}
        {showFeedback && (
          <div className="space-y-2">
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
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleRevise}
              disabled={attempt >= maxAttempts}
            >
              <X className="h-4 w-4 mr-2" />
              {showFeedback ? 'Submit Changes' : 'Request Revision'}
            </Button>
            <Button onClick={handleApprove}>
              <Check className="h-4 w-4 mr-2" />
              Approve & Continue
            </Button>
          </div>
        </div>

        {attempt >= maxAttempts && (
          <p className="text-caption text-muted-foreground text-center">
            Maximum revision attempts reached. Please approve to continue.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
