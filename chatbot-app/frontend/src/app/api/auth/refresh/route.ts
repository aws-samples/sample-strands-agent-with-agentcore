/**
 * Auth Refresh API - Refresh SSO session
 * 
 * In SSO mode, token refresh is handled by Lambda@Edge automatically.
 * This endpoint is a no-op that returns success for compatibility.
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Extract user to verify they're authenticated
    const user = extractUserFromRequest(request)
    
    if (user.userId === 'anonymous') {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }
    
    // In SSO mode, refresh is handled by Lambda@Edge
    // Just return success
    return NextResponse.json({
      success: true,
      message: 'Session refresh handled by SSO',
    })
  } catch (error) {
    console.error('[API Auth Refresh] Error:', error)
    
    return NextResponse.json(
      { error: 'Refresh failed' },
      { status: 500 }
    )
  }
}
