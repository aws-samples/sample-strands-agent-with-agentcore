/**
 * Activate specific prompt endpoint
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'

export const runtime = 'nodejs'

// Default system prompts
const DEFAULT_PROMPTS: Record<string, string> = {
  general: 'You are a helpful AI assistant.',
  code: 'You are an expert software engineer. Provide clear, concise code examples and explanations.',
  research: 'You are a research assistant. Provide detailed, well-researched answers with citations when possible.',
  rag: 'You are a RAG (Retrieval-Augmented Generation) agent. Use provided context to answer questions accurately.'
}

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

    // Load existing profile
    const profile = await getUserProfile(userId)

    // Get prompt text
    let promptText = DEFAULT_PROMPTS[promptId]

    if (!promptText) {
      // If custom prompt, keep existing
      if (promptId === 'custom' && profile?.preferences?.systemPrompt) {
        promptText = profile.preferences.systemPrompt
      } else {
        promptText = DEFAULT_PROMPTS.general // Fallback
      }
    }

    // Activate prompt
    await upsertUserProfile(userId, user.email || '', user.username, {
      ...(profile?.preferences || {}),
      systemPrompt: promptText
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
