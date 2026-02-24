"use client"

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Trash2, GitBranch, Upload, GitPullRequest, ShieldAlert } from 'lucide-react'

interface InterruptApprovalModalProps {
  isOpen: boolean
  onApprove: () => void
  onReject: () => void
  interrupts: Array<{
    id: string
    name: string
    reason?: Record<string, any>
  }>
}

/** Resolve display config from interrupt name */
function getInterruptConfig(name: string) {
  if (name.includes('github-branch-approval')) {
    return { icon: GitBranch, color: 'text-blue-500', bg: 'bg-blue-500/10', title: 'Create Branch', description: 'A new branch will be created on the remote repository', approveLabel: 'Create', approveClass: 'bg-blue-600 hover:bg-blue-700' }
  }
  if (name.includes('github-push-approval')) {
    return { icon: Upload, color: 'text-orange-500', bg: 'bg-orange-500/10', title: 'Push Files', description: 'Files will be pushed to the remote repository', approveLabel: 'Push', approveClass: 'bg-orange-600 hover:bg-orange-700' }
  }
  if (name.includes('github-pr-approval')) {
    return { icon: GitPullRequest, color: 'text-green-500', bg: 'bg-green-500/10', title: 'Create Pull Request', description: 'A pull request will be opened on the remote repository', approveLabel: 'Create PR', approveClass: 'bg-green-600 hover:bg-green-700' }
  }
  if (name.includes('email-delete-approval')) {
    return { icon: Trash2, color: 'text-red-500', bg: 'bg-red-500/10', title: 'Delete Emails', description: 'This action cannot be undone', approveLabel: 'Delete', approveClass: 'bg-red-600 hover:bg-red-700' }
  }
  // Fallback for unknown interrupt types
  return { icon: ShieldAlert, color: 'text-yellow-500', bg: 'bg-yellow-500/10', title: 'Action Approval', description: 'This action requires your confirmation', approveLabel: 'Approve', approveClass: 'bg-primary hover:bg-primary/90' }
}

/** Render reason details based on interrupt type */
function InterruptDetails({ name, reason }: { name: string; reason?: Record<string, any> }) {
  if (!reason) return null

  // GitHub branch creation
  if (name.includes('github-branch-approval')) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-foreground font-medium">{reason.summary}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Repo: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.repo}</code></span>
          <span>Branch: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.branch}</code></span>
          <span>From: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.from_branch}</code></span>
        </div>
      </div>
    )
  }

  // GitHub push files
  if (name.includes('github-push-approval')) {
    const files: string[] = reason.files || []
    return (
      <div className="space-y-2 text-sm">
        <p className="text-foreground font-medium">{reason.summary}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Repo: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.repo}</code></span>
          <span>Branch: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.branch}</code></span>
        </div>
        {reason.commit_message && (
          <p className="text-xs text-muted-foreground">Commit: <em>{reason.commit_message}</em></p>
        )}
        {files.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{files.length} file(s):</span>
            <ul className="mt-1 ml-4 list-disc space-y-0.5 max-h-32 overflow-y-auto">
              {files.map((f, i) => <li key={i}><code className="text-foreground">{f}</code></li>)}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // GitHub pull request
  if (name.includes('github-pr-approval')) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-foreground font-medium">{reason.summary}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Repo: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.repo}</code></span>
          <span>Title: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.title}</code></span>
          <span>{reason.head} → {reason.base}</span>
          {reason.draft && <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">Draft</span>}
        </div>
      </div>
    )
  }

  // Email delete (legacy)
  if (name.includes('email-delete-approval')) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">{reason.intent}</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Query: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.query}</code></span>
          <span>Max: <strong className="text-foreground">{reason.max_delete || 50}</strong></span>
        </div>
      </div>
    )
  }

  // Fallback: show summary or raw reason
  return (
    <div className="space-y-2 text-sm">
      {reason.summary && <p className="text-foreground font-medium">{reason.summary}</p>}
      {reason.tool_name && (
        <p className="text-xs text-muted-foreground">
          Tool: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{reason.tool_name}</code>
        </p>
      )}
    </div>
  )
}

export function InterruptApprovalModal({
  isOpen,
  onApprove,
  onReject,
  interrupts
}: InterruptApprovalModalProps) {
  const interrupt = interrupts[0]

  if (!interrupt) return null

  const config = getInterruptConfig(interrupt.name)
  const Icon = config.icon

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-md mx-4 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bg}`}>
              <Icon className={`w-5 h-5 ${config.color}`} />
            </div>
            <div>
              <DialogTitle>{config.title}</DialogTitle>
              <DialogDescription className="text-xs">
                {config.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/20 p-4">
          <InterruptDetails name={interrupt.name} reason={interrupt.reason} />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            className={config.approveClass}
          >
            {config.approveLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
