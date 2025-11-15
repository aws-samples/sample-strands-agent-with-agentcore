/**
 * Model Config endpoint - returns current model configuration
 * Loads from DynamoDB (AWS) or local file (local) user preferences
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile } from '@/lib/dynamodb-client'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

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

    // Default configuration
    let config = {
      model_id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      temperature: 0.7,
      system_prompts: DEFAULT_PROMPTS,
      caching: {
        enabled: true
      }
    }

    if (userId === 'anonymous') {
      // Anonymous user - load from local file storage (works for both local and AWS)
      const { getUserModelConfig } = await import('@/lib/local-tool-store')
      const savedConfig = getUserModelConfig(userId)

      if (savedConfig) {
        if (savedConfig.model_id) {
          config.model_id = savedConfig.model_id
        }
        if (savedConfig.temperature !== undefined) {
          config.temperature = savedConfig.temperature
        }
        if (savedConfig.system_prompt) {
          config.system_prompts = config.system_prompts.map(p => ({
            ...p,
            active: false
          }))
          config.system_prompts.push({
            id: 'custom',
            name: 'Custom',
            prompt: savedConfig.system_prompt,
            active: true
          })
        }
        if (savedConfig.caching_enabled !== undefined) {
          config.caching.enabled = savedConfig.caching_enabled
        }
      }

      console.log(`[API] Loaded model config for anonymous user from local file`)
    } else {
      // Authenticated user - load from DynamoDB (AWS) or local file (local)
      if (IS_LOCAL) {
        // Local: Load from file
        const { getUserModelConfig } = await import('@/lib/local-tool-store')
        const savedConfig = getUserModelConfig(userId)

        if (savedConfig) {
          if (savedConfig.model_id) {
            config.model_id = savedConfig.model_id
          }
          if (savedConfig.temperature !== undefined) {
            config.temperature = savedConfig.temperature
          }
          if (savedConfig.system_prompt) {
            config.system_prompts = config.system_prompts.map(p => ({
              ...p,
              active: false
            }))
            config.system_prompts.push({
              id: 'custom',
              name: 'Custom',
              prompt: savedConfig.system_prompt,
              active: true
            })
          }
          if (savedConfig.caching_enabled !== undefined) {
            config.caching.enabled = savedConfig.caching_enabled
          }
        }

        console.log(`[API] Loaded model config for user ${userId} from local file`)
      } else {
        // AWS: Load from DynamoDB
        const profile = await getUserProfile(userId)

        if (profile?.preferences) {
          // Override with user preferences
          if (profile.preferences.defaultModel) {
            config.model_id = profile.preferences.defaultModel
          }
          if (profile.preferences.defaultTemperature !== undefined) {
            config.temperature = profile.preferences.defaultTemperature
          }
          if (profile.preferences.systemPrompt) {
            // Mark custom prompt as active
            config.system_prompts = config.system_prompts.map(p => ({
              ...p,
              active: false
            }))
            config.system_prompts.push({
              id: 'custom',
              name: 'Custom',
              prompt: profile.preferences.systemPrompt,
              active: true
            })
          }
          if (profile.preferences.cachingEnabled !== undefined) {
            config.caching.enabled = profile.preferences.cachingEnabled
          }
        }

        console.log(`[API] Loaded model config for user ${userId} from DynamoDB`)
      }
    }

    return NextResponse.json({
      success: true,
      config
    })
  } catch (error) {
    console.error('[API] Error loading model config:', error)

    return NextResponse.json({
      success: false,
      error: 'Failed to load model configuration'
    }, { status: 500 })
  }
}
