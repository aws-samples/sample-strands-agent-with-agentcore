import { useRef, useCallback } from 'react'
import type { TokenUsage } from '@/types/events'
import { fetchAuthSession } from 'aws-amplify/auth'

export interface LatencyMetrics {
  timeToFirstToken?: number
  endToEndLatency?: number
}

interface SaveMetadataParams {
  sessionId: string
  messageId: string | number
  ttft?: number
  e2e?: number
  tokenUsage?: TokenUsage
  documents?: Array<{
    filename: string
    tool_type: string
  }>
}

/**
 * Custom hook for tracking latency metrics (TTFT, E2E)
 * Encapsulates all ref management and side effects
 */
export const useLatencyTracking = () => {
  // Internal refs to track state
  const requestStartTimeRef = useRef<number | null>(null)
  const ttftRef = useRef<number | undefined>(undefined)
  const e2eRef = useRef<number | undefined>(undefined)
  const ttftLoggedRef = useRef(false)
  const e2eLoggedRef = useRef(false)
  const metadataSavedRef = useRef(false)

  /**
   * Start tracking latency for a new request
   * Call this when user sends a message
   * @param requestStartTime - Optional custom start time (defaults to Date.now())
   */
  const startTracking = useCallback((requestStartTime?: number) => {
    // Prevent duplicate calls - only start tracking once per turn
    if (requestStartTimeRef.current !== null) {
      console.log('[Latency] Already tracking, skipping startTracking')
      return
    }

    requestStartTimeRef.current = requestStartTime ?? Date.now()
    ttftRef.current = undefined
    e2eRef.current = undefined
    ttftLoggedRef.current = false
    e2eLoggedRef.current = false
    metadataSavedRef.current = false
    console.log('[Latency] Started tracking, requestStartTime:', requestStartTimeRef.current)
  }, [])

  /**
   * Record Time to First Token
   * Call this when first response chunk arrives
   * Returns the calculated TTFT (or undefined if already recorded)
   */
  const recordTTFT = useCallback(() => {
    if (!ttftLoggedRef.current && requestStartTimeRef.current) {
      const ttft = Date.now() - requestStartTimeRef.current
      ttftRef.current = ttft
      ttftLoggedRef.current = true
      console.log(`[Latency] Time to First Token: ${ttft}ms`)
      return ttft
    }
    return ttftRef.current
  }, [])

  /**
   * Record End-to-End Latency and save metadata
   * Call this when response is complete
   * Returns both TTFT and E2E metrics
   */
  const recordE2E = useCallback((params: SaveMetadataParams) => {
    console.log('[recordE2E] Called with:', {
      sessionId: params.sessionId,
      messageId: params.messageId,
      hasTokenUsage: !!params.tokenUsage,
      hasDocuments: !!params.documents,
      currentState: {
        metadataSaved: metadataSavedRef.current,
        requestStartTime: requestStartTimeRef.current,
        ttft: ttftRef.current,
        e2e: e2eRef.current,
        ttftLogged: ttftLoggedRef.current,
        e2eLogged: e2eLoggedRef.current
      }
    })

    let e2e: number | undefined = e2eRef.current

    // Calculate E2E if possible and not already logged
    if (!e2eLoggedRef.current && requestStartTimeRef.current) {
      e2e = Date.now() - requestStartTimeRef.current
      e2eRef.current = e2e
      e2eLoggedRef.current = true

      const ttft = ttftRef.current || 0
      console.log(
        `[Latency] End-to-End Latency: ${e2e}ms (TTFT: ${ttft}ms, Generation: ${e2e - ttft}ms)`
      )
    }

    // Save metadata to storage (only once)
    // Save if we have any metadata: latency, tokenUsage, or documents
    const shouldSave = !metadataSavedRef.current && (ttftRef.current || e2e || params.tokenUsage || params.documents)
    console.log('[recordE2E] Save check:', {
      metadataSaved: metadataSavedRef.current,
      hasTTFT: !!ttftRef.current,
      hasE2E: !!e2e,
      hasTokenUsage: !!params.tokenUsage,
      hasDocuments: !!params.documents,
      shouldSave
    })

    if (shouldSave) {
      metadataSavedRef.current = true
      console.log('[Latency] Saving metadata:', { ttft: ttftRef.current, e2e, hasTokenUsage: !!params.tokenUsage, hasDocuments: !!params.documents })
      saveMetadata(params.sessionId, params.messageId, ttftRef.current, e2e, params.tokenUsage, params.documents)
    } else {
      console.warn('[recordE2E] Metadata NOT saved - condition failed')
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
 * Helper function to save latency, token usage, and documents metadata to storage
 */
async function saveMetadata(
  sessionId: string,
  messageId: string | number,
  ttft?: number,
  e2e?: number,
  tokenUsage?: TokenUsage,
  documents?: Array<{ filename: string; tool_type: string }>
) {
  console.log('[Metadata] Saving:', {
    sessionId,
    messageId,
    ttft,
    e2eLatency: e2e,
    tokenUsage,
    documents: documents?.length || 0,
  })

  // Convert numeric messageId to persistent format by calculating index
  // This ensures metadata can be retrieved after page refresh
  let persistentMessageId = messageId.toString()

  if (typeof messageId === 'number' || !messageId.toString().startsWith('msg-')) {
    // Calculate message index from current conversation history
    try {
      // Get auth token for conversation history request
      const historyAuthHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      try {
        const session = await fetchAuthSession()
        const token = session.tokens?.idToken?.toString()
        if (token) {
          historyAuthHeaders['Authorization'] = `Bearer ${token}`
        }
      } catch (error) {
        console.log('[Metadata] No auth session for history request')
      }

      const response = await fetch(`/api/conversation/history?session_id=${sessionId}`, {
        method: 'GET',
        headers: historyAuthHeaders
      })

      if (response.ok) {
        const data = await response.json()
        const messages = data.messages || []
        // Use the LAST message's ID (the assistant response we just received)
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1]
          persistentMessageId = lastMessage.id
          console.log(`[Metadata] Converted messageId ${messageId} -> ${persistentMessageId}`)
        } else {
          console.warn(`[Metadata] No messages found in history, using fallback ID`)
          persistentMessageId = `msg-${sessionId}-0`
        }
      }
    } catch (error) {
      console.warn('[Metadata] Failed to convert messageId, using original:', error)
    }
  }

  const metadata: any = {
    latency: {
      timeToFirstToken: ttft,
      endToEndLatency: e2e,
    },
  }

  if (tokenUsage) {
    metadata.tokenUsage = tokenUsage
  }

  if (documents && documents.length > 0) {
    metadata.documents = documents
  }

  // Get auth token
  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const session = await fetchAuthSession()
    const token = session.tokens?.idToken?.toString()
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`
    }
  } catch (error) {
    console.log('[Metadata] No auth session available')
  }

  fetch('/api/session/update-metadata', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      sessionId,
      messageId: persistentMessageId,
      metadata,
    }),
  })
    .then((res) => {
      if (res.ok) {
        console.log('[Metadata] Saved successfully')
      } else {
        console.error('[Metadata] Failed to save:', res.status, res.statusText)
      }
    })
    .catch((err) => {
      console.warn('[Metadata] Failed to save:', err)
    })
}
