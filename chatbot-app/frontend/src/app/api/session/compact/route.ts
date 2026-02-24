/**
 * Session Compact - Step 1: Create new session and update metadata
 *
 * This is the fast first step of the compact flow.
 * It only creates the new session and links the two sessions via metadata.
 * Summary generation (the slow part) happens separately via /api/session/compact/summarize.
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { v4 as uuidv4 } from 'uuid'

const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = extractUserFromRequest(request)
    const userId = user.userId

    const { sessionId } = await request.json()
    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId is required' },
        { status: 400 }
      )
    }

    console.log(`[compact] Creating new session from ${sessionId} for user ${userId}`)

    const newSessionId = uuidv4()
    const now = new Date().toISOString()

    const newSessionData = {
      title: 'Continued Chat',
      messageCount: 0,
      lastMessageAt: now,
      status: 'active' as const,
      starred: false,
      tags: [],
      metadata: {
        compactedFrom: sessionId,
      },
    }

    if (userId === 'anonymous' || IS_LOCAL) {
      const { upsertSession, getSession, updateSession } = await import('@/lib/local-session-store')

      upsertSession(userId, newSessionId, newSessionData)

      const oldSession = getSession(userId, sessionId)
      if (oldSession) {
        updateSession(userId, sessionId, {
          metadata: { ...(oldSession.metadata || {}), compactedTo: newSessionId },
        })
      }
    } else {
      const { upsertSession, getSession, updateSession } = await import('@/lib/dynamodb-client')

      await upsertSession(userId, newSessionId, newSessionData)

      const oldSession = await getSession(userId, sessionId)
      if (oldSession) {
        await updateSession(userId, sessionId, {
          metadata: { ...(oldSession.metadata || {}), compactedTo: newSessionId },
        })
      }
    }

    console.log(`[compact] New session created: ${newSessionId}`)

    return NextResponse.json({ success: true, newSessionId })
  } catch (error) {
    console.error('[compact] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create compact session',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
