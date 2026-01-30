/**
 * Authentication utilities for extracting user info from Cognito JWT tokens
 * and SSO headers injected by Lambda@Edge
 */

interface CognitoUser {
  userId: string
  email?: string
  username?: string
  name?: string
  groups?: string[]
}

/**
 * SSO Header names (injected by Lambda@Edge after JWT validation)
 */
const SSO_HEADERS = {
  USER_EMAIL: 'x-user-email',
  USER_SUB: 'x-user-sub',
  USER_NAME: 'x-user-name',
  USER_GROUPS: 'x-user-groups',
} as const

/**
 * Check if SSO authentication is enabled
 */
export function isSSOEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SSO_ENABLED === 'true'
}

/**
 * Extract user information from SSO headers (injected by Lambda@Edge)
 * Returns null if SSO headers are not present
 */
function extractUserFromSSOHeaders(request: Request): CognitoUser | null {
  const email = request.headers.get(SSO_HEADERS.USER_EMAIL)
  const sub = request.headers.get(SSO_HEADERS.USER_SUB)
  const name = request.headers.get(SSO_HEADERS.USER_NAME)
  const groupsStr = request.headers.get(SSO_HEADERS.USER_GROUPS)

  // If required SSO headers are missing, return null
  if (!email || !sub) {
    return null
  }

  const groups = groupsStr
    ? groupsStr.split(',').map(g => g.trim()).filter(Boolean)
    : undefined

  console.log(`[Auth] SSO authenticated user: ${sub} (${email})`)

  return {
    userId: sub,
    email,
    username: email,
    name: name || email,
    groups,
  }
}

/**
 * Extract user information from Cognito JWT token in Authorization header
 */
function extractUserFromJWT(request: Request): CognitoUser {
  try {
    // Get Authorization header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { userId: 'anonymous' }
    }

    // Extract JWT token
    const token = authHeader.substring(7)

    // Decode JWT payload (base64)
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.warn('[Auth] Invalid JWT format')
      return { userId: 'anonymous' }
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'))

    // Extract user info from Cognito token
    // Cognito ID tokens contain: sub (user ID), email, cognito:username
    const userId = payload.sub || payload['cognito:username'] || 'anonymous'
    const email = payload.email
    const username = payload['cognito:username']
    const name = payload.name || payload['cognito:username']

    console.log(`[Auth] JWT authenticated user: ${userId} (${email || username || 'no email'})`)

    return {
      userId,
      email,
      username,
      name,
    }
  } catch (error) {
    console.error('[Auth] Error extracting user from token:', error)
    return { userId: 'anonymous' }
  }
}

/**
 * Extract user information from request
 * 
 * Priority:
 * 1. SSO headers (from Lambda@Edge) - when SSO is enabled
 * 2. Cognito JWT token in Authorization header
 * 3. Anonymous user fallback
 */
export function extractUserFromRequest(request: Request): CognitoUser {
  // First, try SSO headers (injected by Lambda@Edge)
  const ssoUser = extractUserFromSSOHeaders(request)
  if (ssoUser) {
    return ssoUser
  }

  // Fall back to JWT token extraction
  return extractUserFromJWT(request)
}

/**
 * Generate or extract session ID from request headers
 * Session ID must be >= 33 characters to meet AgentCore Runtime validation
 */
export function getSessionId(request: Request, userId: string): { sessionId: string } {
  // Check for existing session ID in header
  const headerSessionId = request.headers.get('X-Session-ID')
  if (headerSessionId) {
    return { sessionId: headerSessionId }
  }

  // Generate new session ID >= 33 characters
  // Format: userPrefix_timestamp_randomUUID (approx 50+ chars)
  const timestamp = Date.now().toString(36)  // ~10 chars
  const randomId = crypto.randomUUID().replace(/-/g, '')  // 32 hex chars
  const userPrefix = userId !== 'anonymous' ? userId.substring(0, 8) : 'anon0000'  // 8 chars

  const sessionId = `${userPrefix}_${timestamp}_${randomId}`

  console.log(`[Auth] Generated session ID (length: ${sessionId.length})`)

  return { sessionId }
}

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

interface SessionData {
  title: string
  messageCount?: number
  lastMessageAt?: string
  status?: 'active' | 'archived' | 'deleted'
  starred?: boolean
  tags?: string[]
  metadata?: Record<string, any>
}

/**
 * Ensure session exists in storage (DynamoDB or local file)
 * Creates session if it doesn't exist, returns isNew flag
 */
export async function ensureSessionExists(
  userId: string,
  sessionId: string,
  defaultData: SessionData
): Promise<{ isNew: boolean }> {
  const now = new Date().toISOString()
  const sessionData = {
    ...defaultData,
    messageCount: defaultData.messageCount ?? 0,
    lastMessageAt: defaultData.lastMessageAt ?? now,
    status: defaultData.status ?? 'active' as const,
    starred: defaultData.starred ?? false,
    tags: defaultData.tags ?? [],
  }

  if (IS_LOCAL) {
    const { getSession, upsertSession } = await import('@/lib/local-session-store')
    const existingSession = getSession(userId, sessionId)
    if (!existingSession) {
      upsertSession(userId, sessionId, sessionData)
      console.log(`[Session] Created new local session: ${sessionId}`)
      return { isNew: true }
    }
    return { isNew: false }
  } else {
    const { getSession, upsertSession } = await import('@/lib/dynamodb-client')
    const existingSession = await getSession(userId, sessionId)
    if (!existingSession) {
      await upsertSession(userId, sessionId, sessionData)
      console.log(`[Session] Created new DynamoDB session: ${sessionId}`)
      return { isNew: true }
    }
    return { isNew: false }
  }
}
