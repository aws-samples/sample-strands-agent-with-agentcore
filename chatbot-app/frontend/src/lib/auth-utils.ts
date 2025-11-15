/**
 * Authentication utilities for extracting user info from Cognito JWT tokens
 */

interface CognitoUser {
  userId: string
  email?: string
  username?: string
}

/**
 * Extract user information from Cognito JWT token in Authorization header
 */
export function extractUserFromRequest(request: Request): CognitoUser {
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

    console.log(`[Auth] Authenticated user: ${userId} (${email || username || 'no email'})`)

    return {
      userId,
      email,
      username
    }
  } catch (error) {
    console.error('[Auth] Error extracting user from token:', error)
    return { userId: 'anonymous' }
  }
}

/**
 * Generate or extract session ID from request headers
 * Session ID must be >= 33 characters to meet AgentCore Runtime validation
 */
export function getSessionId(request: Request, userId: string): string {
  // Check for existing session ID in header
  const headerSessionId = request.headers.get('X-Session-ID')
  if (headerSessionId) {
    return headerSessionId
  }

  // Generate new session ID >= 33 characters
  // Format: userPrefix_timestamp_random1_random2 (approx 35-45 chars)
  const timestamp = Date.now().toString(36)  // ~10 chars
  const random1 = Math.random().toString(36).substring(2, 15)  // 13 chars
  const random2 = Math.random().toString(36).substring(2, 15)  // 13 chars
  const userPrefix = userId !== 'anonymous' ? userId.substring(0, 8) : 'anon0000'  // 8 chars

  const sessionId = `${userPrefix}_${timestamp}_${random1}_${random2}`

  console.log(`[Auth] Generated session ID: ${sessionId} (length: ${sessionId.length})`)

  return sessionId
}
