/**
 * Activate specific prompt endpoint
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'
import { isValidPromptId } from '@/lib/system-prompts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> }
) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    if (userId === 'anonymous') {
      return NextResponse.json({
        success: false,
        error: 'Anonymous users cannot activate prompts'
      }, { status: 401 })
    }

    const { promptId } = await params

    // Validate promptId
    if (!isValidPromptId(promptId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid prompt ID'
      }, { status: 400 })
    }

    // Load existing profile
    const profile = await getUserProfile(userId)

    // Save promptId (not the full text)
    await upsertUserProfile(userId, user.email || '', user.username, {
      ...(profile?.preferences || {}),
      selectedPromptId: promptId
    })

    console.log(`[API] Activated prompt ${promptId} for user ${userId}`)

    return NextResponse.json({
      success: true,
      message: 'Prompt activated successfully'
    })
  } catch (error) {
    console.error('[API] Error activating prompt:', error)

    return NextResponse.json({
      success: false,
      error: 'Failed to activate prompt'
    }, { status: 500 })
  }
}
