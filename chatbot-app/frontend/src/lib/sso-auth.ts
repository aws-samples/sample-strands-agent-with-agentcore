/**
 * SSO Authentication Utilities for Next.js
 * 
 * This module provides authentication utilities for the SSO integration
 * with AWS IAM Identity Center and Cognito. It extracts user identity
 * from headers injected by Lambda@Edge after JWT validation.
 * 
 * Headers expected from Lambda@Edge:
 * - X-User-Email: User's email address (required)
 * - X-User-Sub: User's unique identifier from Cognito (required)
 * - X-User-Name: User's display name (optional)
 * - X-User-Groups: User's group memberships (optional)
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Authenticated user information from SSO
 */
export interface AuthenticatedUser {
  /** User's email address */
  email: string
  /** User's unique identifier (Cognito sub) */
  sub: string
  /** User's display name */
  name: string
  /** User's group memberships (if available) */
  groups?: string[]
}

/**
 * Authentication error with details
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'AUTHENTICATION_FAILED',
    public readonly statusCode: number = 401
  ) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/**
 * Header names for user identity (from Lambda@Edge)
 */
const HEADERS = {
  USER_EMAIL: 'X-User-Email',
  USER_SUB: 'X-User-Sub',
  USER_NAME: 'X-User-Name',
  USER_GROUPS: 'X-User-Groups',
  CORRELATION_ID: 'X-Correlation-ID',
} as const

/**
 * Paths that don't require authentication
 */
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/health',
  '/_next',
  '/favicon.ico',
  '/favicon.png',
])

/**
 * Check if a path is public (doesn't require authentication)
 */
export function isPublicPath(path: string): boolean {
  // Exact match
  if (PUBLIC_PATHS.has(path)) {
    return true
  }
  
  // Prefix match for static assets
  for (const publicPath of PUBLIC_PATHS) {
    if (path.startsWith(publicPath + '/')) {
      return true
    }
  }
  
  // Next.js static files
  if (path.startsWith('/_next/')) {
    return true
  }
  
  return false
}

/**
 * Extract authenticated user from request headers
 * 
 * In production, Lambda@Edge validates the JWT token and injects
 * user identity headers. This function extracts those headers.
 * 
 * In development (when SSO is disabled), returns null to allow
 * fallback to other authentication methods.
 * 
 * @param request - The Next.js request object
 * @returns AuthenticatedUser if headers are present, null otherwise
 */
export function getAuthenticatedUser(request: NextRequest): AuthenticatedUser | null {
  const email = request.headers.get(HEADERS.USER_EMAIL)
  const sub = request.headers.get(HEADERS.USER_SUB)
  const name = request.headers.get(HEADERS.USER_NAME)
  const groupsStr = request.headers.get(HEADERS.USER_GROUPS)
  
  // If required headers are missing, return null
  if (!email || !sub) {
    return null
  }
  
  // Parse groups if provided
  const groups = groupsStr
    ? groupsStr.split(',').map(g => g.trim()).filter(Boolean)
    : undefined
  
  return {
    email,
    sub,
    name: name || email,
    groups,
  }
}

/**
 * Require authentication for a request
 * 
 * Extracts user from headers and throws AuthenticationError if not present.
 * Use this in API routes that require authentication.
 * 
 * @param request - The Next.js request object
 * @returns AuthenticatedUser
 * @throws AuthenticationError if user is not authenticated
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const user = requireAuth(request)
 *   return Response.json({ message: `Hello ${user.name}` })
 * }
 * ```
 */
export function requireAuth(request: NextRequest): AuthenticatedUser {
  const user = getAuthenticatedUser(request)
  
  if (!user) {
    throw new AuthenticationError(
      'Authentication required',
      'MISSING_AUTH_HEADERS',
      401
    )
  }
  
  return user
}

/**
 * Get or create correlation ID for request tracing
 */
export function getCorrelationId(request: NextRequest): string {
  const existing = request.headers.get(HEADERS.CORRELATION_ID)
  if (existing) {
    return existing
  }
  return crypto.randomUUID()
}

/**
 * Create an error response for authentication failures
 */
export function createAuthErrorResponse(
  error: AuthenticationError,
  correlationId?: string
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        correlationId,
      },
    },
    {
      status: error.statusCode,
      headers: {
        'WWW-Authenticate': 'Bearer',
        ...(correlationId && { [HEADERS.CORRELATION_ID]: correlationId }),
      },
    }
  )
}

/**
 * Middleware helper to handle authentication in API routes
 * 
 * Wraps an API route handler with authentication checking.
 * Returns 401 if authentication fails.
 * 
 * @param handler - The API route handler function
 * @returns Wrapped handler with authentication
 * 
 * @example
 * ```typescript
 * export const GET = withAuth(async (request, user) => {
 *   return Response.json({ userId: user.sub })
 * })
 * ```
 */
export function withAuth<T>(
  handler: (request: NextRequest, user: AuthenticatedUser) => Promise<T>
): (request: NextRequest) => Promise<T | NextResponse> {
  return async (request: NextRequest) => {
    const correlationId = getCorrelationId(request)
    
    try {
      const user = requireAuth(request)
      return await handler(request, user)
    } catch (error) {
      if (error instanceof AuthenticationError) {
        console.warn(
          `[Auth] Authentication failed: ${error.message}`,
          { correlationId, path: request.nextUrl.pathname }
        )
        return createAuthErrorResponse(error, correlationId)
      }
      throw error
    }
  }
}

/**
 * Check if SSO authentication is enabled
 * 
 * In development, SSO can be disabled to allow local testing
 * without Lambda@Edge.
 */
export function isSSOEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SSO_ENABLED === 'true'
}

/**
 * Get the Cognito login URL for SSO
 */
export function getLoginUrl(returnUrl?: string): string {
  const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
  const redirectUri = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI
  
  if (!cognitoDomain || !clientId || !redirectUri) {
    console.warn('[Auth] Cognito configuration missing')
    return '/login'
  }
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    ...(returnUrl && { state: returnUrl }),
  })
  
  return `${cognitoDomain}/oauth2/authorize?${params.toString()}`
}

/**
 * Get the Cognito logout URL
 */
export function getLogoutUrl(returnUrl?: string): string {
  const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
  const logoutUri = process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI || '/'
  
  if (!cognitoDomain || !clientId) {
    console.warn('[Auth] Cognito configuration missing')
    return '/'
  }
  
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: returnUrl || logoutUri,
  })
  
  return `${cognitoDomain}/logout?${params.toString()}`
}
