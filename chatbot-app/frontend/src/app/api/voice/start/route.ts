/**
 * Voice Session Start API
 *
 * Called before WebSocket connection to AgentCore.
 * Handles authentication, session initialization, and returns connection info.
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'

const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // 2. Session handling
    const { sessionId, isNew } = getSessionId(request, userId)

    // 3. Get enabled tools from request body
    const body = await request.json().catch(() => ({}))
    const enabledTools: string[] = body.enabledTools || []

    console.log(`[Voice Start] User: ${userId}, Session: ${sessionId}, New: ${isNew}, Tools: ${enabledTools.length}`)

    // 4. Initialize session if new
    if (isNew) {
      if (IS_LOCAL) {
        const { upsertSession } = await import('@/lib/local-session-store')
        upsertSession(userId, sessionId, {
          title: 'Voice Chat',
          messageCount: 0,
          lastMessageAt: new Date().toISOString(),
          metadata: { isVoiceSession: true },
        })
      } else {
        const { upsertSession } = await import('@/lib/dynamodb-client')
        await upsertSession(userId, sessionId, {
          title: 'Voice Chat',
          messageCount: 0,
          lastMessageAt: new Date().toISOString(),
          metadata: { isVoiceSession: true },
        })
      }
      console.log(`[Voice Start] Created new session: ${sessionId}`)
    }

    // 5. Build WebSocket URL for client
    let wsUrl: string
    if (IS_LOCAL) {
      const agentcoreUrl = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://localhost:8080'
      wsUrl = agentcoreUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/voice/stream'
    } else {
      wsUrl = process.env.NEXT_PUBLIC_AGENTCORE_RUNTIME_WS_URL || ''
      if (!wsUrl) {
        return NextResponse.json(
          { success: false, error: 'Voice WebSocket URL not configured' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      sessionId,
      userId,
      wsUrl,
      isNewSession: isNew,
    })
  } catch (error) {
    console.error('[Voice Start] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start voice session',
      },
      { status: 500 }
    )
  }
}
