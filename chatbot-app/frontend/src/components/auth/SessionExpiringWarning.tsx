'use client'

import { useState, useEffect } from 'react'
import { Clock, RefreshCw, X } from 'lucide-react'

interface SessionExpiringWarningProps {
  /** Time remaining until session expires (ms) */
  timeRemaining: number
  /** Callback to refresh the session */
  onRefresh: () => Promise<void>
  /** Callback to dismiss the warning */
  onDismiss?: () => void
}

/**
 * Warning banner displayed when the session is about to expire.
 * Allows the user to extend their session.
 */
export function SessionExpiringWarning({
  timeRemaining,
  onRefresh,
  onDismiss,
}: SessionExpiringWarningProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Format time remaining
  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
      setDismissed(true)
    } catch (error) {
      console.error('Failed to refresh session:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  // Reset dismissed state when time remaining changes significantly
  useEffect(() => {
    if (timeRemaining > 5 * 60 * 1000) {
      setDismissed(false)
    }
  }, [timeRemaining])

  if (dismissed || timeRemaining <= 0) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm">
      <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg shadow-lg p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Session Expiring Soon
            </h3>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              Your session will expire in{' '}
              <span className="font-medium">{formatTime(timeRemaining)}</span>.
            </p>
            
            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-800/50 hover:bg-amber-200 dark:hover:bg-amber-800 rounded-md transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Extending...' : 'Extend Session'}
              </button>
            </div>
          </div>
          
          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default SessionExpiringWarning
