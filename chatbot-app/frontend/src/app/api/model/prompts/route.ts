/**
 * System Prompts endpoint - returns available system prompts
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'

export const runtime = 'nodejs'

// Default system prompts
const DEFAULT_PROMPTS = [
  {
    id: 'general',
    name: 'General',
    prompt: 'You are a helpful AI assistant.',
    active: true
  },
  {
    id: 'code',
    name: 'Code',
    prompt: 'You are an expert software engineer. Provide clear, concise code examples and explanations.',
    active: false
  },
  {
    id: 'research',
    name: 'Research',
    prompt: 'You are a research assistant. Provide detailed, well-researched answers with citations when possible.',
    active: false
  },
  {
    id: 'rag',
    name: 'RAG Agent',
    prompt: 'You are a RAG (Retrieval-Augmented Generation) agent. Use provided context to answer questions accurately.',
    active: false
  }
]

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    let prompts = [...DEFAULT_PROMPTS]

    if (userId !== 'anonymous') {
      // Load user profile to check for custom prompt
      const profile = await getUserProfile(userId)

      if (profile?.preferences?.systemPrompt) {
        // Mark all default prompts as inactive
        prompts = prompts.map(p => ({ ...p, active: false }))

        // Add custom prompt as active
        prompts.push({
          id: 'custom',
          name: 'Custom',
          prompt: profile.preferences.systemPrompt,
          active: true
        })
      }
    }

    return NextResponse.json({
      prompts
    })
  } catch (error) {
    console.error('[API] Error loading system prompts:', error)

    return NextResponse.json({
      prompts: DEFAULT_PROMPTS
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

    // Save custom prompt
    await upsertUserProfile(userId, user.email || '', user.username, {
      ...(profile?.preferences || {}),
      systemPrompt: prompt,
      customPromptName: name
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
