import { useCallback, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { parseSSEStream } from '../lib/sse-parser'
import { getIdToken } from '../lib/auth'
import { API_BASE_URL, ENDPOINTS } from '../lib/constants'
import type { AGUIEvent } from '../types/events'

const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 16000
const STORAGE_KEY_PREFIX = 'sse_exec_'

async function persistExecutionId(executionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${STORAGE_KEY_PREFIX}${executionId}`,
      JSON.stringify({ executionId, ts: Date.now() }),
    )
  } catch { /* quota exceeded or unavailable */ }
}

async function loadPersistedExecutionId(sessionId: string): Promise<string | null> {
  try {
    const keys = await AsyncStorage.getAllKeys()
    for (const key of keys) {
      if (!key.startsWith(STORAGE_KEY_PREFIX)) continue
      const raw = await AsyncStorage.getItem(key)
      if (!raw) continue
      const data = JSON.parse(raw) as { executionId: string; ts: number }
      // executionId format: "{sessionId}:{runId}"
      if (data.executionId?.startsWith(sessionId + ':')) {
        if (Date.now() - data.ts > 10 * 60 * 1000) {
          await AsyncStorage.removeItem(key)
          continue
        }
        return data.executionId
      }
    }
  } catch { /* unavailable */ }
  return null
}

async function clearPersistedExecutionId(executionId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${STORAGE_KEY_PREFIX}${executionId}`)
  } catch { /* unavailable */ }
}

export function useSSEReconnect() {
  const executionIdRef = useRef<string | null>(null)
  const isReconnectingRef = useRef(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  /** Call when a new stream starts — records executionId and persists it. */
  const onStreamStart = useCallback((executionId: string) => {
    executionIdRef.current = executionId
    void persistExecutionId(executionId)
    setIsReconnecting(false)
    setReconnectAttempt(0)
  }, [])

  /** Clear all reconnect state (call on clean stream completion). */
  const reset = useCallback(() => {
    const id = executionIdRef.current
    if (id) void clearPersistedExecutionId(id)
    executionIdRef.current = null
    isReconnectingRef.current = false
    setIsReconnecting(false)
    setReconnectAttempt(0)
  }, [])

  /**
   * Restore a persisted executionId from AsyncStorage.
   * Useful after the app is foregrounded and the in-memory state was lost.
   * Returns true if an executionId was found and restored.
   */
  const restoreFromSession = useCallback(async (sessionId: string): Promise<boolean> => {
    const executionId = await loadPersistedExecutionId(sessionId)
    if (!executionId) return false
    executionIdRef.current = executionId
    return true
  }, [])

  /**
   * Attempt to reconnect by replaying buffered events from the BFF resume endpoint.
   * Retries up to MAX_ATTEMPTS times with exponential backoff.
   */
  const attemptReconnect = useCallback(async (
    onEvent: (event: AGUIEvent) => void,
    onComplete: () => void,
    onFail: () => void,
  ) => {
    const executionId = executionIdRef.current
    if (!executionId) {
      onFail()
      return
    }

    if (isReconnectingRef.current) {
      console.log('[SSEReconnect] Already reconnecting, skipping duplicate attempt')
      return
    }

    isReconnectingRef.current = true
    setIsReconnecting(true)

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      setReconnectAttempt(attempt + 1)

      if (attempt > 0) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS)
        await new Promise<void>(resolve => setTimeout(resolve, delay))
      }

      try {
        const token = await getIdToken()
        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }

        const resumeUrl = `${API_BASE_URL}${ENDPOINTS.streamResume(executionId)}`
        const response = await fetch(resumeUrl, { headers })

        if (!response.ok) {
          console.warn(`[SSEReconnect] Resume failed with ${response.status}, attempt ${attempt + 1}`)
          continue
        }

        if (!response.body) {
          console.warn('[SSEReconnect] No body in resume response')
          continue
        }

        // Replay buffered events, skipping execution_meta to avoid re-registering
        const filteredOnEvent = (event: AGUIEvent) => {
          if (event.type === 'CUSTOM' && (event as { type: string; name?: string }).name === 'execution_meta') return
          onEvent(event)
        }

        await parseSSEStream(response.body, filteredOnEvent)

        void clearPersistedExecutionId(executionId)
        executionIdRef.current = null
        isReconnectingRef.current = false
        setIsReconnecting(false)
        setReconnectAttempt(0)
        onComplete()
        return
      } catch (error) {
        console.warn(`[SSEReconnect] Attempt ${attempt + 1} failed:`, error)
      }
    }

    // All attempts exhausted
    void clearPersistedExecutionId(executionId)
    isReconnectingRef.current = false
    setIsReconnecting(false)
    setReconnectAttempt(0)
    onFail()
  }, [])

  return {
    onStreamStart,
    attemptReconnect,
    restoreFromSession,
    reset,
    isReconnecting,
    reconnectAttempt,
  }
}
