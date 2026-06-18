/**
 * Session Configuration
 *
 * Controls session timeout behavior
 */

/**
 * Session timeout in minutes
 * After this period of inactivity, a new session will be started automatically
 *
 * Set to 0 to disable timeout (session persists indefinitely)
 */
export const SESSION_TIMEOUT_MINUTES: number = 20

/**
 * LocalStorage key for tracking last activity time
 */
export const LAST_ACTIVITY_KEY = 'chat-last-activity'

/**
 * SessionStorage key for current session ID
 */
export const SESSION_ID_KEY = 'chat-session-id'

/**
 * Check if session has timed out
 * @param lastActivityTime - Unix timestamp in milliseconds
 * @returns true if session has timed out
 */
export function isSessionTimedOut(lastActivityTime: number): boolean {
  if (SESSION_TIMEOUT_MINUTES === 0) {
    return false // Timeout disabled
  }

  const now = Date.now()
  const minutesSinceActivity = (now - lastActivityTime) / 1000 / 60
  return minutesSinceActivity > SESSION_TIMEOUT_MINUTES
}

/**
 * Update last activity timestamp
 */
export function updateLastActivity(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
  }
}

/**
 * Get last activity timestamp
 * @returns Unix timestamp in milliseconds, or null if not found
 */
export function getLastActivity(): number | null {
  if (typeof window === 'undefined') {
    return null
  }

  const stored = localStorage.getItem(LAST_ACTIVITY_KEY)
  if (!stored) {
    return null
  }

  const timestamp = parseInt(stored, 10)
  return isNaN(timestamp) ? null : timestamp
}

/**
 * Clear session data (on timeout or new chat)
 */
export function clearSessionData(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_ID_KEY)
    localStorage.removeItem(LAST_ACTIVITY_KEY)
  }
}

/**
 * Generate session ID (client-side, matches BFF format)
 */
export function generateSessionId(userId: string = 'anonymous'): string {
  const timestamp = Date.now().toString(36)
  const randomId = crypto.randomUUID().replace(/-/g, '')
  const userPrefix = userId !== 'anonymous' ? userId.substring(0, 8) : 'anon0000'
  return `${userPrefix}_${timestamp}_${randomId}`
}

/**
 * Warmup configuration
 */
const WARMUP_KEY = 'agentcore-last-warmup'
const WARMUP_SESSION_KEY = 'agentcore-warmup-session'
const WARMUP_DEBOUNCE_MS = 30000

let warmupInProgress = false

export async function triggerWarmup(sessionId?: string, authHeaders?: Record<string, string>): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('[Warmup] Skipped: server-side rendering')
    return
  }
  if (warmupInProgress) {
    console.warn('[Warmup] Skipped: already in progress')
    return
  }

  // AgentCore Runtime requires a JWT; an unauthenticated warmup just 401s.
  // Caller is responsible for passing a populated Authorization header.
  if (!authHeaders?.Authorization) {
    console.error('[Warmup] Aborted: missing Authorization header (caller race?)')
    return
  }

  const lastWarmup = parseInt(sessionStorage.getItem(WARMUP_KEY) || '0', 10)
  const lastWarmupSession = sessionStorage.getItem(WARMUP_SESSION_KEY)

  // Skip only if same session was warmed within debounce period
  if (sessionId && sessionId === lastWarmupSession && Date.now() - lastWarmup < WARMUP_DEBOUNCE_MS) {
    console.warn(`[Warmup] Skipped: same session debounced (${Math.round((Date.now() - lastWarmup) / 1000)}s ago)`)
    return
  }

  console.warn(`[Warmup] Starting warmup for session: ${sessionId || 'none'}`)
  warmupInProgress = true
  sessionStorage.setItem(WARMUP_KEY, Date.now().toString())
  if (sessionId) sessionStorage.setItem(WARMUP_SESSION_KEY, sessionId)

  try {
    const response = await fetch('/api/warmup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({ sessionId })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Warmup] Failed: ${response.status} - ${errorText}`)
    } else {
      const result = await response.json()
      console.warn(`[Warmup] Success: ${result.latencyMs}ms (${result.mode})`)
    }
  } catch (error) {
    console.error('[Warmup] Error:', error instanceof Error ? error.message : error)
  } finally {
    warmupInProgress = false
  }
}
