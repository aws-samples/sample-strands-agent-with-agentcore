/**
 * API Keys Settings endpoint
 * GET: Returns current API keys configuration (masked values)
 * POST: Save/update API keys
 * DELETE: Clear all API keys
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'
import type { UserApiKeys } from '@/lib/dynamodb-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

// Default keys configured at deployment (comma-separated)
// Example: NEXT_PUBLIC_DEFAULT_KEYS=tavily_api_key,google_api_key,google_search_engine_id
const DEFAULT_KEYS = (process.env.NEXT_PUBLIC_DEFAULT_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean)

// API Keys that can be configured
const API_KEY_NAMES = [
  'tavily_api_key',
  'google_api_key',
  'google_search_engine_id',
  'google_maps_api_key',
  'nova_act_api_key',
] as const

type ApiKeyName = typeof API_KEY_NAMES[number]

/**
 * Mask an API key, showing only the last 4 characters
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 8) {
    return '••••••••'
  }
  return '••••••••' + key.slice(-4)
}

/**
 * Check if a default API key is configured (from deployment)
 */
function isDefaultKeyConfigured(keyName: ApiKeyName): boolean {
  return DEFAULT_KEYS.includes(keyName)
}

/**
 * GET - Retrieve API keys configuration
 * Returns masked values for security
 */
export async function GET(request: NextRequest) {
  try {
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Build response with default and user keys info
    const response: {
      user_keys: Record<string, { configured: boolean; masked: string | null; value: string | null }>
      default_keys: Record<string, { configured: boolean }>
    } = {
      user_keys: {},
      default_keys: {},
    }

    // Initialize response for all keys
    for (const keyName of API_KEY_NAMES) {
      response.default_keys[keyName] = {
        configured: isDefaultKeyConfigured(keyName),
      }
      response.user_keys[keyName] = {
        configured: false,
        masked: null,
        value: null,
      }
    }

    // Get user-specific API keys
    let userApiKeys: UserApiKeys | null = null

    if (IS_LOCAL) {
      const { getUserApiKeys } = await import('@/lib/local-tool-store')
      userApiKeys = getUserApiKeys(userId)
    } else {
      try {
        const profile = await getUserProfile(userId)
        userApiKeys = profile?.preferences?.apiKeys || null
      } catch (error) {
        console.warn(`[API] Failed to load API keys from DynamoDB for user ${userId}:`, error)
      }
    }

    // Update user keys in response
    if (userApiKeys) {
      for (const keyName of API_KEY_NAMES) {
        const keyValue = userApiKeys[keyName]
        if (keyValue) {
          response.user_keys[keyName] = {
            configured: true,
            masked: maskApiKey(keyValue),
            value: keyValue,  // 본인 키는 조회 가능
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      ...response,
    })
  } catch (error) {
    console.error('[API] Error loading API keys:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to load API keys configuration' },
      { status: 500 }
    )
  }
}

/**
 * POST - Save/update API keys
 * Body: { tavily_api_key?: string, google_api_key?: string, ... }
 */
export async function POST(request: NextRequest) {
  try {
    const user = extractUserFromRequest(request)
    const userId = user.userId

    const body = await request.json()
    const apiKeys: UserApiKeys = {}

    // Only accept known API key fields
    for (const keyName of API_KEY_NAMES) {
      if (body[keyName] !== undefined) {
        // Allow empty string to clear a specific key
        if (body[keyName] === '' || body[keyName] === null) {
          // Skip - will be handled by not including in apiKeys
        } else {
          apiKeys[keyName] = body[keyName]
        }
      }
    }

    if (IS_LOCAL) {
      const { getUserApiKeys, updateUserApiKeys } = await import('@/lib/local-tool-store')
      const existingKeys = getUserApiKeys(userId) || {}

      // Merge with existing, removing cleared keys
      const mergedKeys: UserApiKeys = { ...existingKeys }
      for (const keyName of API_KEY_NAMES) {
        if (body[keyName] === '' || body[keyName] === null) {
          delete mergedKeys[keyName]
        } else if (body[keyName] !== undefined) {
          mergedKeys[keyName] = body[keyName]
        }
      }

      updateUserApiKeys(userId, mergedKeys)
      console.log(`[API] Updated API keys for user ${userId} via local file`)
    } else {
      const profile = await getUserProfile(userId)
      const existingKeys = profile?.preferences?.apiKeys || {}

      // Merge with existing, removing cleared keys
      const mergedKeys: UserApiKeys = { ...existingKeys }
      for (const keyName of API_KEY_NAMES) {
        if (body[keyName] === '' || body[keyName] === null) {
          delete mergedKeys[keyName]
        } else if (body[keyName] !== undefined) {
          mergedKeys[keyName] = body[keyName]
        }
      }

      await upsertUserProfile(userId, user.email || '', user.username, {
        ...(profile?.preferences || {}),
        apiKeys: mergedKeys,
      })
      console.log(`[API] Updated API keys for user ${userId} via DynamoDB`)
    }

    return NextResponse.json({
      success: true,
      message: 'API keys updated successfully',
    })
  } catch (error) {
    console.error('[API] Error updating API keys:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update API keys' },
      { status: 500 }
    )
  }
}

/**
 * DELETE - Clear all API keys for user
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = extractUserFromRequest(request)
    const userId = user.userId

    if (IS_LOCAL) {
      const { clearUserApiKeys } = await import('@/lib/local-tool-store')
      clearUserApiKeys(userId)
      console.log(`[API] Cleared API keys for user ${userId} via local file`)
    } else {
      const profile = await getUserProfile(userId)

      await upsertUserProfile(userId, user.email || '', user.username, {
        ...(profile?.preferences || {}),
        apiKeys: {},
      })
      console.log(`[API] Cleared API keys for user ${userId} via DynamoDB`)
    }

    return NextResponse.json({
      success: true,
      message: 'API keys cleared successfully',
    })
  } catch (error) {
    console.error('[API] Error clearing API keys:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to clear API keys' },
      { status: 500 }
    )
  }
}
