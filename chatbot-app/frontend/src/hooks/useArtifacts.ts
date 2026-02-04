import { useState, useEffect, useCallback, useRef } from 'react'
import { Artifact } from '@/types/artifact'
import { Message } from '@/types/chat'

/**
 * Grouped message type (matches useChat return type)
 */
type GroupedMessage = {
  type: 'user' | 'assistant_turn'
  messages: Message[]
  id: string
}

/**
 * Custom hook for managing artifacts extracted from chat messages
 * Automatically extracts research results, documents, images, etc.
 */
export function useArtifacts(
  groupedMessages: GroupedMessage[],
  sessionId: string | null
) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [isCanvasOpen, setIsCanvasOpen] = useState<boolean>(false)
  const [loadedFromBackend, setLoadedFromBackend] = useState<boolean>(false)
  const [justUpdated, setJustUpdated] = useState<boolean>(false)  // Flash effect trigger

  // Track previous sessionId to only reset on actual session change
  const prevSessionIdRef = useRef<string | null>(null)

  // Reset artifacts and loaded flag only when switching to a DIFFERENT session
  useEffect(() => {
    // Skip if sessionId hasn't actually changed (prevents unnecessary resets)
    if (prevSessionIdRef.current === sessionId) {
      return
    }

    // Only clear if switching from one valid session to another
    if (prevSessionIdRef.current && sessionId && prevSessionIdRef.current !== sessionId) {
      setArtifacts([])
      setSelectedArtifactId(null)
      setLoadedFromBackend(false)
    }

    prevSessionIdRef.current = sessionId
  }, [sessionId])

  // Load artifacts from sessionStorage (populated by history API)
  useEffect(() => {
    // Skip if no valid sessionId or already loaded
    if (!sessionId || sessionId === 'undefined' || loadedFromBackend) {
      return
    }

    // Artifacts are loaded by history API and stored in sessionStorage
    const artifactsKey = `artifacts-${sessionId}`
    const storedArtifacts = sessionStorage.getItem(artifactsKey)

    if (storedArtifacts) {
      try {
        const data = JSON.parse(storedArtifacts)

        // Convert backend artifact format to frontend format
        const backendArtifacts = data.map((item: any) => {
          // Handle timestamp - could be created_at or timestamp field
          let timestamp = item.timestamp || item.created_at
          if (timestamp) {
            try {
              const date = new Date(timestamp)
              if (!isNaN(date.getTime())) {
                timestamp = date.toISOString()
              } else {
                timestamp = new Date().toISOString()
              }
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
            timestamp,
            sessionId: sessionId,
          }
        })

        setArtifacts(backendArtifacts)
      } catch (error) {
        console.error('[useArtifacts] Failed to parse artifacts:', error)
      }
    }

    setLoadedFromBackend(true)
  }, [sessionId, loadedFromBackend])

  // Extract artifacts from messages (merges with backend artifacts)
  useEffect(() => {
    // Skip if backend artifacts haven't loaded yet
    if (!loadedFromBackend) {
      return
    }

    const messageArtifacts: Artifact[] = []

    groupedMessages.forEach((group) => {
      if (group.type === 'assistant_turn') {
        group.messages.forEach((message) => {
          if (message.toolExecutions) {
            message.toolExecutions.forEach((execution) => {
              // Research artifacts are created manually in ChatInterface when complete
              // No automatic extraction needed here

              // TODO: Add other artifact types
              // - Browser automation results
              // - Generated documents (Word/Excel/PowerPoint)
              // - Generated charts/images
              // - Code execution results
            })
          }
        })
      }
    })

    // Merge: Keep backend artifacts and add new message artifacts
    // Only update state if there are actual changes
    if (messageArtifacts.length > 0) {
      setArtifacts(prev => {
        let hasChanges = false
        const merged = [...prev]

        messageArtifacts.forEach(newArtifact => {
          const existingIndex = merged.findIndex(a => a.id === newArtifact.id)
          if (existingIndex >= 0) {
            // Update existing
            merged[existingIndex] = newArtifact
            hasChanges = true
          } else {
            // Add new
            merged.push(newArtifact)
            hasChanges = true
          }
        })

        return hasChanges ? merged : prev
      })
    }
  }, [groupedMessages, sessionId, loadedFromBackend])

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
    setSelectedArtifactId(null)  // Clear selection when panel closes
  }, [])

  /**
   * Manually add an artifact
   * Used by Composer, Research, Browser, etc.
   */
  const addArtifact = useCallback((artifact: Artifact) => {
    setArtifacts(prev => {
      // Check if artifact already exists (by ID)
      const existingIndex = prev.findIndex(a => a.id === artifact.id)
      if (existingIndex >= 0) {
        // Update existing artifact
        const updated = [...prev]
        updated[existingIndex] = artifact
        return updated
      }
      // Add new artifact
      return [...prev, artifact]
    })
  }, [])

  /**
   * Remove an artifact by ID
   */
  const removeArtifact = useCallback((artifactId: string) => {
    setArtifacts(prev => prev.filter(a => a.id !== artifactId))
    // If removing currently selected artifact, clear selection
    if (selectedArtifactId === artifactId) {
      setSelectedArtifactId(null)
    }
  }, [selectedArtifactId])

  /**
   * Update an existing artifact
   * Used when agent updates an artifact via update_artifact tool
   */
  const updateArtifact = useCallback((artifactId: string, updates: Partial<Artifact>) => {
    setArtifacts(prev => prev.map(a => {
      if (a.id === artifactId) {
        return { ...a, ...updates }
      }
      return a
    }))
  }, [])

  /**
   * Refresh artifacts from history API
   * Called when artifact is updated via update_artifact tool
   * Returns the refreshed artifacts array for immediate use
   */
  const refreshArtifacts = useCallback(async (options?: { skipFlashEffect?: boolean }): Promise<Artifact[]> => {
    if (!sessionId) return []

    try {
      const response = await fetch(`/api/conversation/history?session_id=${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        const artifactsData = data.artifacts || []
        if (Array.isArray(artifactsData) && artifactsData.length > 0) {
          const backendArtifacts: Artifact[] = artifactsData.map((item: any) => ({
            id: item.id,
            type: item.type,
            title: item.title,
            content: item.content,
            description: item.metadata?.description || '',
            timestamp: new Date(item.created_at || Date.now()).toISOString(),
            sessionId: sessionId,
          }))
          setArtifacts(backendArtifacts)

          // Trigger flash effect (skip for research completion to avoid re-render)
          if (!options?.skipFlashEffect) {
            setJustUpdated(true)
            setTimeout(() => setJustUpdated(false), 1500)
          }

          // Also update sessionStorage
          sessionStorage.setItem(`artifacts-${sessionId}`, JSON.stringify(artifactsData))

          return backendArtifacts
        }
      }
    } catch (error) {
      console.error('[useArtifacts] Failed to refresh artifacts:', error)
    }
    return []
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
    justUpdated,  // For flash effect on update
  }
}
