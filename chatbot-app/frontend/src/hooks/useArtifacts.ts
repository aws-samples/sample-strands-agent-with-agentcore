import { useState, useEffect, useCallback, useRef } from 'react'
import { Artifact } from '@/types/artifact'

/**
 * Convert backend artifact format to frontend Artifact.
 */
function toFrontendArtifact(item: any, sessionId: string): Artifact {
  let timestamp = item.timestamp || item.created_at
  if (timestamp) {
    try {
      const date = new Date(timestamp)
      timestamp = !isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString()
    } catch {
      timestamp = new Date().toISOString()
    }
  } else {
    timestamp = new Date().toISOString()
  }

  return {
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content,
    description: item.metadata?.description || item.description || '',
    toolName: item.tool_name || item.toolName,
    timestamp,
    sessionId,
    metadata: item.metadata,
  }
}

/**
 * Read artifacts from sessionStorage for the given session.
 */
function readStorageArtifacts(sessionId: string): Artifact[] {
  const stored = sessionStorage.getItem(`artifacts-${sessionId}`)
  if (!stored) return []
  try {
    const data = JSON.parse(stored)
    if (!Array.isArray(data)) return []
    return data.map((item: any) => toFrontendArtifact(item, sessionId))
  } catch {
    return []
  }
}

/**
 * Custom hook for managing artifacts loaded from agent state (backend).
 * Artifacts are stored in agent.state by tools and persisted via session manager.
 *
 * Single source of truth: React state (artifacts).
 * sessionStorage is kept in sync via useEffect for persistence across reloads.
 */
export function useArtifacts(
  sessionId: string
) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [isCanvasOpen, setIsCanvasOpen] = useState<boolean>(false)
  const [loadedFromBackend, setLoadedFromBackend] = useState<boolean>(false)
  const [justUpdated, setJustUpdated] = useState<boolean>(false)

  // Tracks which sessionId the current artifacts state belongs to (guards auto-sync)
  const loadedSessionIdRef = useRef<string | null>(null)

  // Reset on session switch
  useEffect(() => {
    loadedSessionIdRef.current = null
    setArtifacts([])
    setSelectedArtifactId(null)
    setLoadedFromBackend(false)
  }, [sessionId])

  // Load artifacts from sessionStorage on session init (populated by history API)
  useEffect(() => {
    if (loadedFromBackend) return

    const loaded = readStorageArtifacts(sessionId)
    if (loaded.length > 0) {
      setArtifacts(loaded)
    }
    loadedSessionIdRef.current = sessionId
    setLoadedFromBackend(true)
  }, [sessionId, loadedFromBackend])

  // Auto-sync to sessionStorage; guard against stale session writes
  useEffect(() => {
    if (!loadedFromBackend) return
    if (loadedSessionIdRef.current !== sessionId) return
    sessionStorage.setItem(`artifacts-${sessionId}`, JSON.stringify(artifacts))
  }, [sessionId, loadedFromBackend, artifacts])

  const toggleCanvas = useCallback(() => {
    setIsCanvasOpen(prev => !prev)
  }, [])

  const openCanvas = useCallback(() => {
    setIsCanvasOpen(true)
  }, [])

  const openArtifact = useCallback((id: string) => {
    setSelectedArtifactId(id)
    setIsCanvasOpen(true)
  }, [])

  const closeCanvas = useCallback(() => {
    setIsCanvasOpen(false)
    setSelectedArtifactId(null)
  }, [])

  const addArtifact = useCallback((artifact: Artifact) => {
    setArtifacts(prev => {
      const existingIndex = prev.findIndex(a => a.id === artifact.id)
      if (existingIndex >= 0) {
        return prev.map((a, i) => i === existingIndex ? artifact : a)
      }
      return [...prev, artifact]
    })
  }, [])

  const removeArtifact = useCallback((artifactId: string) => {
    setArtifacts(prev => prev.filter(a => a.id !== artifactId))
    if (selectedArtifactId === artifactId) {
      setSelectedArtifactId(null)
    }
  }, [selectedArtifactId])

  const updateArtifact = useCallback((artifactId: string, updates: Partial<Artifact>) => {
    setArtifacts(prev => prev.map(a =>
      a.id === artifactId ? { ...a, ...updates } : a
    ))
  }, [])

  /**
   * Refresh artifacts from history API.
   * Returns the refreshed artifacts array for immediate use.
   */
  const refreshArtifacts = useCallback(async (options?: { skipFlashEffect?: boolean }): Promise<Artifact[]> => {

    try {
      const response = await fetch(`/api/conversation/history?session_id=${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        const artifactsData = data.artifacts || []
        if (Array.isArray(artifactsData) && artifactsData.length > 0) {
          const converted = artifactsData.map((item: any) => toFrontendArtifact(item, sessionId))
          loadedSessionIdRef.current = sessionId
          setArtifacts(converted)

          if (!options?.skipFlashEffect) {
            setJustUpdated(true)
            setTimeout(() => setJustUpdated(false), 1500)
          }
          return converted
        }
      }
    } catch (error) {
      console.error('[useArtifacts] Failed to refresh artifacts:', error)
    }
    return []
  }, [sessionId])

  /**
   * Re-read artifacts from sessionStorage.
   * Called after loadSession populates sessionStorage.
   */
  const reloadFromStorage = useCallback(() => {
    const loaded = readStorageArtifacts(sessionId)
    loadedSessionIdRef.current = sessionId
    setArtifacts(loaded)  // always sync — clears stale state when storage was removed
    setLoadedFromBackend(true)
  }, [sessionId])

  return {
    artifacts,
    selectedArtifactId,
    isCanvasOpen,
    toggleCanvas,
    openCanvas,
    openArtifact,
    closeCanvas,
    setSelectedArtifactId,
    addArtifact,
    removeArtifact,
    updateArtifact,
    refreshArtifacts,
    reloadFromStorage,
    justUpdated,
  }
}
