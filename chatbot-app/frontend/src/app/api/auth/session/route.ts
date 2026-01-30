/**
 * Auth Session API - Get current user session from SSO headers
 * 
 * This endpoint extracts user identity from Lambda@Edge injected headers
 * (X-User-Email, X-User-Sub, X-User-Name) and returns session information.
 * 
 * In production, Lambda@Edge validates JWT and injects these headers.
 * In local development, returns anonymous user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Extract user from SSO headers (injected by Lambda@Edge)
    const user = extractUserFromRequest(request)
    
    // Log for debugging
    console.log('[API Auth Session] User extracted:', {
      userId: user.userId,
      email: user.email,
      name: user.name,
    })
    
    // Check if user is authenticated (not anonymous)
    const isAuthenticated = user.userId !== 'anonymous' && !!user.email
    
    if (!isAuthenticated) {
      // Return null user for anonymous - frontend will handle accordingly
      return NextResponse.json({
        user: null,
        session: {
          id: null,
          active: false,
        },
      })
    }
    
    // Return authenticated user info
    return NextResponse.json({
      user: {
        email: user.email,
        sub: user.userId,
        name: user.name || user.email,
      },
      session: {
        id: user.userId,
        active: true,
        // Session doesn't expire in SSO mode - Lambda@Edge handles token refresh
        expiresAt: null,
      },
    })
  } catch (error) {
    console.error('[API Auth Session] Error:', error)
    
    return NextResponse.json(
      {
        error: {
          code: 'SESSION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get session',
        },
      },
      { status: 500 }
    )
  }
}
