import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Artifact } from '../types/artifact'
import { useSessionContext } from './SessionContext'

const STORAGE_KEY = 'canvas_artifacts_v1'

interface ArtifactContextValue {
  artifacts: Artifact[]
  unreadCount: number
  addArtifact: (artifact: Artifact) => void
  updateArtifact: (id: string, patch: Partial<Omit<Artifact, 'id'>>) => void
  clearUnread: () => void
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null)

export function ArtifactProvider({ children }: { children: React.ReactNode }) {
  const { activeSessionId } = useSessionContext()
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const prevSessionRef = useRef(activeSessionId)

  // Load persisted artifacts on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw) return
      try {
        const stored = JSON.parse(raw) as Artifact[]
        setArtifacts(stored)
      } catch { /* corrupt data — ignore */ }
    })
  }, [])

  // Reset unread badge when session changes (but keep all artifacts in state)
  useEffect(() => {
    if (prevSessionRef.current !== activeSessionId) {
      setUnreadCount(0)
      prevSessionRef.current = activeSessionId
    }
  }, [activeSessionId])

  const addArtifact = useCallback((artifact: Artifact) => {
    setArtifacts(prev => {
      if (prev.some(a => a.id === artifact.id)) return prev
      const next = [...prev, artifact]
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
    setUnreadCount(c => c + 1)
  }, [])

  const updateArtifact = useCallback((id: string, patch: Partial<Omit<Artifact, 'id'>>) => {
    setArtifacts(prev => {
      const next = prev.map(a => (a.id === id ? { ...a, ...patch } : a))
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const clearUnread = useCallback(() => {
    setUnreadCount(0)
  }, [])

  const value = useMemo(
    () => ({ artifacts, unreadCount, addArtifact, updateArtifact, clearUnread }),
    [artifacts, unreadCount, addArtifact, updateArtifact, clearUnread],
  )

  return <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>
}

export function useArtifactContext(): ArtifactContextValue {
  const ctx = useContext(ArtifactContext)
  if (!ctx) throw new Error('useArtifactContext must be used inside <ArtifactProvider>')
  return ctx
}
