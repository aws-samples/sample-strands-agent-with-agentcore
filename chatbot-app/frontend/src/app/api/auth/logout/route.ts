/**
 * Auth Logout API - Handle SSO logout
 * 
 * Clears the id_token cookie and returns the Cognito logout URL
 * for the frontend to redirect to.
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Cognito configuration
const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN || 'chatbot-dev-53882568.auth.eu-west-1.amazoncognito.com'
const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '37osr3ctqscb4m33gqqdlc8i4v'
const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL || 'https://d1ystqalgm445b.cloudfront.net'

export async function POST(request: NextRequest) {
  try {
    // Build Cognito logout URL
    const logoutUrl = `https://${COGNITO_DOMAIN}/logout?client_id=${COGNITO_CLIENT_ID}&logout_uri=${encodeURIComponent(CLOUDFRONT_URL)}`
    
    // Create response with cookie clearing
    const response = NextResponse.json({
      success: true,
      logoutUrl,
    })
    
    // Clear the id_token cookie
    response.cookies.set('id_token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0, // Expire immediately
    })
    
    return response
  } catch (error) {
    console.error('[API Auth Logout] Error:', error)
    
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    )
  }
}
