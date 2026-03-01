import { useState, useCallback } from 'react'
import { apiGet, apiPost, apiDelete } from '../lib/api-client'
import { ENDPOINTS } from '../lib/constants'
import type { SessionMeta } from '../types/chat'

export function useSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<{ sessions: SessionMeta[] }>(ENDPOINTS.sessionList)
      setSessions(data.sessions ?? [])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load sessions'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createSession = useCallback(async (): Promise<string> => {
    const data = await apiPost<{ sessionId: string }>(ENDPOINTS.sessionNew, {})
    const sessionId = data.sessionId
    // Optimistically add to list; a full reload will follow from the screen
    setSessions(prev => [
      {
        sessionId,
        title: 'New chat',
        messageCount: 0,
        lastMessageAt: new Date().toISOString(),
        status: 'active',
      },
      ...prev,
    ])
    return sessionId
  }, [])

  const deleteSession = useCallback(async (sessionId: string) => {
    await apiDelete(`${ENDPOINTS.sessionDelete}?session_id=${encodeURIComponent(sessionId)}`)
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
  }, [])

  return { sessions, loading, error, loadSessions, createSession, deleteSession }
}
