import { useRef, useCallback } from 'react'
import type { TokenUsage } from '@/types/events'
import { fetchAuthSession } from 'aws-amplify/auth'

export interface LatencyMetrics {
  timeToFirstToken?: number
  endToEndLatency?: number
}

interface SaveMetadataParams {
  sessionId: string
  messageId: string
  ttft?: number
  e2e?: number
  tokenUsage?: TokenUsage
  documents?: Array<{
    filename: string
    tool_type: string
  }>
}

/**
 * Custom hook for tracking response metadata (latency, token usage, documents)
 * Encapsulates all ref management and side effects
 */
export const useMetadataTracking = () => {
  // Internal refs to track state
  const requestStartTimeRef = useRef<number | null>(null)
  const ttftRef = useRef<number | undefined>(undefined)
  const e2eRef = useRef<number | undefined>(undefined)
  const ttftLoggedRef = useRef(false)
  const e2eLoggedRef = useRef(false)
  const metadataSavedRef = useRef(false)

  /**
   * Start tracking for a new request
   * Call this when user sends a message
   */
  const startTracking = useCallback((requestStartTime?: number) => {
    // Prevent duplicate calls - only start tracking once per turn
    if (requestStartTimeRef.current !== null) {
      return
    }

    requestStartTimeRef.current = requestStartTime ?? Date.now()
    ttftRef.current = undefined
    e2eRef.current = undefined
    ttftLoggedRef.current = false
    e2eLoggedRef.current = false
    metadataSavedRef.current = false
  }, [])

  /**
   * Record Time to First Token
   * Call this when first response chunk arrives
   */
  const recordTTFT = useCallback(() => {
    if (!ttftLoggedRef.current && requestStartTimeRef.current) {
      const ttft = Date.now() - requestStartTimeRef.current
      ttftRef.current = ttft
      ttftLoggedRef.current = true
      return ttft
    }
    return ttftRef.current
  }, [])

  /**
   * Record End-to-End Latency and save metadata
   * Call this when response is complete
   */
  const recordE2E = useCallback((params: SaveMetadataParams) => {
    let e2e: number | undefined = e2eRef.current

    // Calculate E2E if possible and not already logged
    if (!e2eLoggedRef.current && requestStartTimeRef.current) {
      e2e = Date.now() - requestStartTimeRef.current
      e2eRef.current = e2e
      e2eLoggedRef.current = true
    }

    // Save metadata to storage (only once)
    const shouldSave = !metadataSavedRef.current && (ttftRef.current || e2e || params.tokenUsage || params.documents)

    if (shouldSave) {
      metadataSavedRef.current = true
      saveMetadata(params.sessionId, params.messageId, ttftRef.current, e2e, params.tokenUsage, params.documents)
    }

    return { ttft: ttftRef.current, e2e }
  }, [])

  /**
   * Get current metrics without recording
   */
  const getMetrics = useCallback((): LatencyMetrics => ({
    timeToFirstToken: ttftRef.current,
    endToEndLatency: e2eRef.current,
  }), [])

  /**
   * Reset all tracking state
   * Call this when starting a new message or on error
   */
  const reset = useCallback(() => {
    requestStartTimeRef.current = null
    ttftRef.current = undefined
    e2eRef.current = undefined
    ttftLoggedRef.current = false
    e2eLoggedRef.current = false
    metadataSavedRef.current = false
  }, [])

  return {
    startTracking,
    recordTTFT,
    recordE2E,
    getMetrics,
    reset,
  }
}

/**
 * Save documents metadata to DynamoDB.
 * Token usage and latency are now persisted by the SDK via message.metadata — no DynamoDB write needed.
 */
async function saveMetadata(
  sessionId: string,
  messageId: string,
  ttft?: number,
  e2e?: number,
  tokenUsage?: TokenUsage,
  documents?: Array<{ filename: string; tool_type: string }>
) {
  // Only save documents to DynamoDB (token usage + latency now from SDK message.metadata)
  if (!documents || documents.length === 0) return

  let persistentMessageId = messageId

  if (!messageId.startsWith('msg-')) {
    try {
      const historyAuthHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      try {
        const session = await fetchAuthSession()
        const token = session.tokens?.accessToken?.toString()
        if (token) {
          historyAuthHeaders['Authorization'] = `Bearer ${token}`
        }
      } catch {
        // No auth session available
      }

      const response = await fetch(`/api/conversation/history?session_id=${sessionId}`, {
        method: 'GET',
        headers: historyAuthHeaders
      })

      if (response.ok) {
        const data = await response.json()
        const messages = data.messages || []
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1]
          persistentMessageId = lastMessage.id
        } else {
          persistentMessageId = `msg-${sessionId}-0`
        }
      }
    } catch {
      // Failed to convert messageId - use original
    }
  }

  const metadata: any = { documents }

  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const session = await fetchAuthSession()
    const token = session.tokens?.accessToken?.toString()
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`
    }
  } catch {
    // No auth session available
  }

  fetch('/api/session/update-metadata', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      sessionId,
      messageId: persistentMessageId,
      metadata,
    }),
  }).catch(() => {
    // Failed to save metadata - non-critical
  })
}
