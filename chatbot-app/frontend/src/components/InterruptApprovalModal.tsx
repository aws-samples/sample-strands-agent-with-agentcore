"use client"

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FlaskConical, CheckCircle2, XCircle, Globe } from 'lucide-react'

interface InterruptApprovalModalProps {
  isOpen: boolean
  onApprove: () => void
  onReject: () => void
  interrupts: Array<{
    id: string
    name: string
    reason?: {
      tool_name?: string
      plan?: string
      plan_preview?: string
      task?: string
      task_preview?: string
      max_steps?: number
    }
  }>
}

export function InterruptApprovalModal({
  isOpen,
  onApprove,
  onReject,
  interrupts
}: InterruptApprovalModalProps) {
  // Handle single interrupt (research or browser approval)
  const interrupt = interrupts[0]

  if (!interrupt) return null

  const isResearchApproval = interrupt.name === "chatbot-research-approval"
  const isBrowserApproval = interrupt.name === "chatbot-browser-approval"

  // Research Agent fields
  const plan = interrupt.reason?.plan || ""

  // Browser-Use Agent fields
  const task = interrupt.reason?.task || ""
  const maxSteps = interrupt.reason?.max_steps || 15

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${isBrowserApproval ? 'bg-purple-500/10' : 'bg-blue-500/10'}`}>
              {isBrowserApproval ? (
                <Globe className="w-5 h-5 text-purple-500" />
              ) : (
                <FlaskConical className="w-5 h-5 text-blue-500" />
              )}
            </div>
            <div>
              <DialogTitle className="text-heading font-semibold">
                {isBrowserApproval ? 'Browser Automation Approval Required' : 'Research Approval Required'}
              </DialogTitle>
              <DialogDescription className="text-label mt-0.5">
                {isBrowserApproval
                  ? 'Review the browser task before proceeding'
                  : 'Review the research plan before proceeding'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto mt-4 mb-4">
          <div className="rounded-lg border bg-muted/20 p-5">
            <h3 className="text-caption font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
              {isBrowserApproval ? 'Browser Task' : 'Research Plan'}
            </h3>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-label leading-relaxed text-foreground/90 bg-transparent border-0 p-0 m-0">
                {isBrowserApproval ? task : plan}
              </pre>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t">
          <Button
            variant="outline"
            onClick={onReject}
            className="gap-2"
          >
            <XCircle className="w-4 h-4" />
            Decline
          </Button>
          <Button
            variant="default"
            onClick={onApprove}
            className={`gap-2 ${isBrowserApproval ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {isBrowserApproval ? 'Approve & Start Browser Task' : 'Approve & Start Research'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
