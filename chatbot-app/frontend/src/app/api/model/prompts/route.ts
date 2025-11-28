/**
 * System Prompts endpoint - returns available system prompts
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'
import { SYSTEM_PROMPTS, getAvailablePromptIds } from '@/lib/system-prompts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Prompt metadata (without full prompt text)
const PROMPT_METADATA = [
  { id: 'general', name: 'General' },
  { id: 'code', name: 'Code Assistant' },
  { id: 'research', name: 'Research Assistant' },
  { id: 'rag', name: 'RAG Agent' }
]

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    let selectedPromptId = 'general' // Default
    let customPromptText: string | undefined

    if (userId !== 'anonymous') {
      // Load user profile to check for selected prompt
      const profile = await getUserProfile(userId)

      if (profile?.preferences?.selectedPromptId) {
        selectedPromptId = profile.preferences.selectedPromptId
      }

      if (profile?.preferences?.customPromptText) {
        customPromptText = profile.preferences.customPromptText
      }
    }

    // Build prompts list with active state
    const prompts = PROMPT_METADATA.map(meta => ({
      id: meta.id,
      name: meta.name,
      prompt: SYSTEM_PROMPTS[meta.id as keyof typeof SYSTEM_PROMPTS],
      active: meta.id === selectedPromptId
    }))

    // Add custom prompt if exists
    if (customPromptText) {
      prompts.push({
        id: 'custom',
        name: 'Custom',
        prompt: customPromptText,
        active: selectedPromptId === 'custom'
      })
    }

    return NextResponse.json({
      prompts
    })
  } catch (error) {
    console.error('[API] Error loading system prompts:', error)

    // Return default prompts on error
    return NextResponse.json({
      prompts: PROMPT_METADATA.map((meta, index) => ({
        ...meta,
        prompt: SYSTEM_PROMPTS[meta.id as keyof typeof SYSTEM_PROMPTS],
        active: index === 0
      }))
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    if (userId === 'anonymous') {
      return NextResponse.json({
        success: false,
        error: 'Anonymous users cannot create prompts'
      }, { status: 401 })
    }

    const body = await request.json()
    const { name, prompt } = body

    // Load existing profile
    const profile = await getUserProfile(userId)

    // Save custom prompt and activate it
    await upsertUserProfile(userId, user.email || '', user.username, {
      ...(profile?.preferences || {}),
      customPromptText: prompt,
      customPromptName: name,
      selectedPromptId: 'custom' // Auto-activate custom prompt
    })

    console.log(`[API] Created custom prompt for user ${userId}: ${name}`)

    return NextResponse.json({
      success: true,
      message: 'Prompt created successfully'
    })
  } catch (error) {
    console.error('[API] Error creating prompt:', error)

    return NextResponse.json({
      success: false,
      error: 'Failed to create prompt'
    }, { status: 500 })
  }
}
