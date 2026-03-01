import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuthContext } from './AuthContext'
import { generateSessionId } from '../lib/auth'

interface SessionContextValue {
  /** The currently-active session ID shown in the Chat tab. */
  activeSessionId: string
  /** Call this to switch the Chat tab to a different session. */
  setActiveSessionId: (id: string) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext()

  // Start with a temporary local ID; upgrade once the Cognito user is available
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => `tmp_${Date.now().toString(36)}`,
  )

  // Track whether we've already assigned the user-scoped session ID so we
  // don't replace a manually-chosen session when the component re-renders.
  const upgradedRef = useRef(false)

  useEffect(() => {
    if (!upgradedRef.current && user?.userId) {
      upgradedRef.current = true
      // Only replace the initial temp ID; keep any session the user has
      // already navigated to.
      setActiveSessionId(prev =>
        prev.startsWith('tmp_') ? generateSessionId(user.userId) : prev,
      )
    }
  }, [user?.userId])

  const value = useMemo(
    () => ({ activeSessionId, setActiveSessionId }),
    [activeSessionId],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSessionContext must be used inside <SessionProvider>')
  return ctx
}
