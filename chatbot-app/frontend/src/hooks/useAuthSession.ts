/**
 * SSO Session Management Hook
 * 
 * This hook provides session state management for SSO authentication,
 * including session refresh, expiration handling, and logout functionality.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'

/**
 * Session user information
 */
export interface SessionUser {
  email: string
  sub: string
  name: string
}

/**
 * Session information
 */
export interface SessionInfo {
  id: string | null
  createdAt?: string
  expiresAt?: string
  active: boolean
}

/**
 * Session state
 */
export interface SessionState {
  user: SessionUser | null
  session: SessionInfo | null
  isLoading: boolean
  isAuthenticated: boolean
  error: Error | null
}

/**
 * Session API response
 */
interface SessionResponse {
  user: SessionUser
  session: SessionInfo
}

/**
 * Fetcher for SWR
 */
const fetcher = async (url: string): Promise<SessionResponse> => {
  const response = await fetch(url, {
    credentials: 'include',
  })
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Not authenticated')
    }
    throw new Error(`Session fetch failed: ${response.status}`)
  }
  
  return response.json()
}

/**
 * Session refresh interval (5 minutes)
 */
const REFRESH_INTERVAL = 5 * 60 * 1000

/**
 * Session expiration warning threshold (10 minutes before expiry)
 */
const EXPIRATION_WARNING_THRESHOLD = 10 * 60 * 1000

/**
 * Hook options
 */
export interface UseAuthSessionOptions {
  /** Whether to automatically refresh the session */
  autoRefresh?: boolean
  /** Refresh interval in milliseconds */
  refreshInterval?: number
  /** Callback when session expires */
  onSessionExpired?: () => void
  /** Callback when session is about to expire */
  onSessionExpiring?: (timeRemaining: number) => void
}

/**
 * Hook return type
 */
export interface UseAuthSessionReturn extends SessionState {
  /** Refresh the session */
  refresh: () => Promise<void>
  /** Logout and clear session */
  logout: () => Promise<void>
  /** Time remaining until session expires (ms) */
  timeUntilExpiry: number | null
  /** Whether session is about to expire */
  isExpiring: boolean
}

/**
 * SSO Session Management Hook
 * 
 * Provides session state management with automatic refresh and
 * expiration handling.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, logout, isExpiring } = useAuthSession({
 *     onSessionExpired: () => router.push('/login'),
 *   })
 *   
 *   if (!isAuthenticated) {
 *     return <LoginPrompt />
 *   }
 *   
 *   return (
 *     <div>
 *       <p>Welcome, {user?.name}</p>
 *       {isExpiring && <SessionExpiringWarning />}
 *       <button onClick={logout}>Logout</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useAuthSession(
  options: UseAuthSessionOptions = {}
): UseAuthSessionReturn {
  const {
    autoRefresh = true,
    refreshInterval = REFRESH_INTERVAL,
    onSessionExpired,
    onSessionExpiring,
  } = options
  
  const [timeUntilExpiry, setTimeUntilExpiry] = useState<number | null>(null)
  const [isExpiring, setIsExpiring] = useState(false)
  const expiryTimerRef = useRef<NodeJS.Timeout | null>(null)
  const warningFiredRef = useRef(false)
  
  // Fetch session data with SWR
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR<SessionResponse>(
    '/api/auth/session',
    fetcher,
    {
      refreshInterval: autoRefresh ? refreshInterval : 0,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
      onError: (err) => {
        if (err.message === 'Not authenticated' && onSessionExpired) {
          onSessionExpired()
        }
      },
    }
  )
  
  // Calculate time until expiry
  useEffect(() => {
    if (!data?.session?.expiresAt) {
      setTimeUntilExpiry(null)
      setIsExpiring(false)
      return
    }
    
    const updateExpiry = () => {
      const expiresAt = new Date(data.session.expiresAt!).getTime()
      const now = Date.now()
      const remaining = expiresAt - now
      
      setTimeUntilExpiry(remaining)
      
      // Check if session is about to expire
      if (remaining <= EXPIRATION_WARNING_THRESHOLD && remaining > 0) {
        setIsExpiring(true)
        
        // Fire warning callback once
        if (!warningFiredRef.current && onSessionExpiring) {
          warningFiredRef.current = true
          onSessionExpiring(remaining)
        }
      } else {
        setIsExpiring(false)
        warningFiredRef.current = false
      }
      
      // Check if session has expired
      if (remaining <= 0 && onSessionExpired) {
        onSessionExpired()
      }
    }
    
    // Update immediately
    updateExpiry()
    
    // Update every second
    expiryTimerRef.current = setInterval(updateExpiry, 1000)
    
    return () => {
      if (expiryTimerRef.current) {
        clearInterval(expiryTimerRef.current)
      }
    }
  }, [data?.session?.expiresAt, onSessionExpired, onSessionExpiring])
  
  // Refresh session
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      
      if (!response.ok) {
        throw new Error(`Refresh failed: ${response.status}`)
      }
      
      // Revalidate session data
      await mutate()
      
      // Reset warning state
      warningFiredRef.current = false
    } catch (err) {
      console.error('[Session] Refresh failed:', err)
      throw err
    }
  }, [mutate])
  
  // Logout
  const logout = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      
      if (!response.ok) {
        console.warn('[Session] Logout response not OK:', response.status)
      }
      
      // Clear session data
      await mutate(undefined, { revalidate: false })
      
      // Redirect to login or home
      window.location.href = '/'
    } catch (err) {
      console.error('[Session] Logout failed:', err)
      // Still redirect even if logout fails
      window.location.href = '/'
    }
  }, [mutate])
  
  // Build state
  const isAuthenticated = !error && !!data?.user && data.session?.active !== false
  
  return {
    user: data?.user ?? null,
    session: data?.session ?? null,
    isLoading,
    isAuthenticated,
    error: error ?? null,
    refresh,
    logout,
    timeUntilExpiry,
    isExpiring,
  }
}

export default useAuthSession
