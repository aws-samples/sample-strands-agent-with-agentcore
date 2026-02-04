/**
 * usePolling - Centralized polling management for A2A agent tool executions
 *
 * This hook manages polling for long-running A2A agents (research_agent, browser_use_agent)
 * that save progress to the backend and need periodic data synchronization.
 *
 * Regular tools do NOT need polling - their state is managed by SSE stream events.
 */

import { useRef, useCallback, useEffect } from 'react'
import { Message } from '@/types/chat'

// A2A tools that require polling for progress updates
// These tools run in separate processes and save progress to backend
export const A2A_TOOLS_REQUIRING_POLLING = ['research_agent', 'browser_use_agent'] as const

interface UsePollingProps {
  sessionId: string | null
  loadSession: (sessionId: string) => Promise<any>
  onPollComplete?: () => void
}

interface UsePollingReturn {
  startPolling: (targetSessionId: string) => void
  stopPolling: () => void
  isPollingActive: boolean
  checkAndStartPollingForA2ATools: (messages: Message[], sessionId: string) => void
}

export const usePolling = ({
  sessionId,
  loadSession,
  onPollComplete
}: UsePollingProps): UsePollingReturn => {
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingActiveRef = useRef(false)
  const pollingSessionIdRef = useRef<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  // Keep currentSessionIdRef in sync
  useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      isPollingActiveRef.current = false
      pollingSessionIdRef.current = null
    }
  }, [])

  const startPolling = useCallback((targetSessionId: string) => {
    // Clear any existing polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }

    isPollingActiveRef.current = true
    pollingSessionIdRef.current = targetSessionId

    const poll = async () => {
      try {
        // Check if we're still polling the same session
        if (pollingSessionIdRef.current !== targetSessionId) {
          return
        }

        // Check if target session is still the current active session
        if (currentSessionIdRef.current !== targetSessionId) {
          stopPolling()
          return
        }

        await loadSession(targetSessionId)

        // Double-check after async operation
        if (currentSessionIdRef.current !== targetSessionId) {
          stopPolling()
          return
        }

        onPollComplete?.()
      } catch (error) {
        console.error('[usePolling] Polling error:', error)
      }
    }

    // Poll every 5 seconds (don't poll immediately to prevent overwriting active streaming)
    pollingIntervalRef.current = setInterval(poll, 5000)
  }, [loadSession, stopPolling, onPollComplete])

  /**
   * Check if there are ongoing A2A tools and start/stop polling accordingly.
   * Only polls for research_agent and browser_use_agent.
   */
  const checkAndStartPollingForA2ATools = useCallback((messages: Message[], targetSessionId: string) => {
    const hasOngoingA2ATools = messages.some(msg =>
      msg.toolExecutions &&
      msg.toolExecutions.some(te =>
        !te.isComplete &&
        !te.isCancelled &&
        A2A_TOOLS_REQUIRING_POLLING.includes(te.toolName as typeof A2A_TOOLS_REQUIRING_POLLING[number])
      )
    )

    if (hasOngoingA2ATools && !isPollingActiveRef.current) {
      startPolling(targetSessionId)
    } else if (!hasOngoingA2ATools && isPollingActiveRef.current) {
      stopPolling()
    }
  }, [startPolling, stopPolling])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  return {
    startPolling,
    stopPolling,
    isPollingActive: isPollingActiveRef.current,
    checkAndStartPollingForA2ATools
  }
}

/**
 * Helper function to check if a tool requires polling
 */
export const isA2ATool = (toolName: string): boolean => {
  return A2A_TOOLS_REQUIRING_POLLING.includes(toolName as typeof A2A_TOOLS_REQUIRING_POLLING[number])
}

/**
 * Helper function to check if messages have ongoing A2A tools
 */
export const hasOngoingA2ATools = (messages: Message[]): boolean => {
  return messages.some(msg =>
    msg.toolExecutions &&
    msg.toolExecutions.some(te =>
      !te.isComplete &&
      !te.isCancelled &&
      isA2ATool(te.toolName)
    )
  )
}

/**
 * Helper function to get agent status based on tool name
 */
export const getAgentStatusForTool = (toolName: string): 'responding' | 'researching' | 'browser_automation' => {
  if (toolName === 'research_agent') return 'researching'
  if (toolName === 'browser_use_agent') return 'browser_automation'
  return 'responding'
}
