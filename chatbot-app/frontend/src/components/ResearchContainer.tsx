"use client"

import React from 'react'
import { FlaskConical, Loader2, Check, ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ResearchContainerProps {
  query: string
  status: 'idle' | 'searching' | 'analyzing' | 'generating' | 'complete' | 'error' | 'declined'
  isLoading: boolean
  hasResult?: boolean
  onClick: () => void
  agentName?: string  // Display name for the agent (e.g., "Research Agent" or "Browser Use Agent")
  currentStatus?: string  // Real-time status from research_progress events
}

export function ResearchContainer({
  query,
  status,
  isLoading,
  hasResult = true,
  onClick,
  agentName = 'Research Agent',
  currentStatus
}: ResearchContainerProps) {
  const getStatusText = () => {
    // Use real-time status if available and still loading
    if (currentStatus && isLoading && status !== 'complete') {
      return currentStatus
    }

    switch (status) {
      case 'searching':
        return 'Searching web sources'
      case 'analyzing':
        return 'Analyzing information'
      case 'generating':
        return 'Generating report'
      case 'complete':
        return 'Research complete'
      case 'declined':
        return 'Research declined'
      case 'error':
        return 'Research failed'
      default:
        return 'Starting research'
    }
  }

  const isComplete = status === 'complete' && hasResult
  const isDeclined = status === 'declined'
  const isError = status === 'error'
  // Show button during loading if we have partial results (for real-time viewing)
  const showOpenButton = isComplete || (isLoading && hasResult)

  return (
    <div
      onClick={isComplete ? onClick : undefined}
      className={`
        group relative rounded-2xl border bg-card transition-all duration-300
        ${isComplete ? 'cursor-pointer hover:shadow-lg hover:border-primary/50' : ''}
        ${isError ? 'border-red-200 dark:border-red-800' : isDeclined ? 'border-gray-200 dark:border-gray-800' : 'border-border/50 hover:border-border'}
      `}
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={`
            relative flex-shrink-0 rounded-xl p-3 transition-all duration-300
            ${isComplete
              ? 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 group-hover:from-blue-500/20 group-hover:to-purple-500/20'
              : isDeclined
              ? 'bg-gray-50 dark:bg-gray-950/20'
              : isError
              ? 'bg-red-50 dark:bg-red-950/20'
              : 'bg-gradient-to-br from-blue-500/10 to-cyan-500/10'
            }
          `}>
            {isComplete ? (
              <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <FlaskConical className={`w-5 h-5 ${
                isDeclined
                  ? 'text-gray-600 dark:text-gray-400'
                  : isError
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-blue-600 dark:text-blue-400'
              }`} />
            )}
            {isComplete && (
              <div className="absolute -top-1 -right-1 rounded-full bg-green-500 p-0.5">
                <Check className="w-3 h-3 text-white" strokeWidth={3} />
              </div>
            )}
            {isLoading && !isComplete && (
              <div className="absolute -top-1 -right-1">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-body text-foreground">
                {agentName}
              </h4>
              {showOpenButton && (
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 px-4 gap-1.5 rounded-full bg-primary hover:bg-primary/90 transition-all duration-200"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClick()
                  }}
                >
                  Open
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            <p className="text-label text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
              {query}
            </p>

            <div className="flex items-center gap-2">
              <div className={`
                inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-medium
                ${isComplete
                  ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : isDeclined
                  ? 'bg-gray-100 text-gray-700 dark:bg-gray-950/30 dark:text-gray-400'
                  : isError
                  ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                }
              `}>
                {isLoading && !isComplete && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                {getStatusText()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hover gradient effect */}
      {isComplete && (
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      )}
    </div>
  )
}
