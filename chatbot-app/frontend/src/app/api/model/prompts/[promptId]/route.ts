/**
 * Update specific prompt endpoint
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(
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
        error: 'Anonymous users cannot update prompts'
      }, { status: 401 })
    }

    const body = await request.json()
    const { name, prompt } = body

    // Load existing profile
    const profile = await getUserProfile(userId)

    const { promptId } = await params

    // Update custom prompt
    await upsertUserProfile(userId, user.email || '', user.username, {
      ...(profile?.preferences || {}),
      systemPrompt: prompt,
      customPromptName: name
    })

    console.log(`[API] Updated prompt ${promptId} for user ${userId}`)

    return NextResponse.json({
      success: true,
      message: 'Prompt updated successfully'
    })
  } catch (error) {
    console.error('[API] Error updating prompt:', error)

    return NextResponse.json({
      success: false,
      error: 'Failed to update prompt'
    }, { status: 500 })
  }
}
