/**
 * Chat streaming endpoint (BFF)
 * Invokes AgentCore Runtime and streams responses
 */
import { NextRequest } from 'next/server'
import { invokeAgentCoreRuntime } from '@/lib/agentcore-runtime-client'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'
import { createDefaultHookManager } from '@/lib/chat-hooks'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'
export const maxDuration = 1800 // 30 minutes for long-running agent tasks (self-hosted, no Vercel limits)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, model_id, enabled_tools } = body

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Extract user from Cognito JWT token in Authorization header
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Get or generate session ID (user-specific)
    const sessionId = getSessionId(request, userId)

    console.log(`[BFF] Chat request - User: ${userId} (${user.email || 'no email'}), Session: ${sessionId}`)
    console.log(`[BFF] Message: ${message.substring(0, 50)}...`)

    // Load or use provided enabled_tools
    let enabledToolsList: string[] = []

    if (enabled_tools && Array.isArray(enabled_tools)) {
      // Frontend provided enabled_tools - use them
      enabledToolsList = enabled_tools
      console.log(`[BFF] Using enabled_tools from request (${enabledToolsList.length}):`, enabledToolsList)
    } else {
      // No enabled_tools in request - load from storage
      if (userId !== 'anonymous') {
        if (IS_LOCAL) {
          const { getUserEnabledTools } = await import('@/lib/local-tool-store')
          enabledToolsList = getUserEnabledTools(userId)
          console.log(`[BFF] Loaded enabled_tools from local store (${enabledToolsList.length})`)
        } else {
          const { getUserEnabledTools } = await import('@/lib/dynamodb-client')
          enabledToolsList = await getUserEnabledTools(userId)
          console.log(`[BFF] Loaded enabled_tools from DynamoDB (${enabledToolsList.length})`)
        }
      } else {
        console.log('[BFF] Anonymous user - all tools enabled by default')
      }
    }

    // Load model configuration from storage
    let modelConfig = {
      model_id: model_id || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      temperature: 0.7,
      system_prompt: 'You are a helpful AI assistant.',
      caching_enabled: true
    }

    if (userId !== 'anonymous') {
      if (IS_LOCAL) {
        // Local: Load from file (create local-model-store if needed)
        try {
          const { getUserModelConfig } = await import('@/lib/local-tool-store')
          const config = getUserModelConfig(userId)
          if (config) {
            modelConfig = { ...modelConfig, ...config }
            console.log(`[BFF] Loaded model config from local file store:`, modelConfig)
          }
        } catch (error) {
          console.log('[BFF] Local model config not available, using defaults')
        }
      } else {
        // AWS: Load from DynamoDB
        try {
          const { getUserProfile } = await import('@/lib/dynamodb-client')
          const profile = await getUserProfile(userId)
          if (profile?.preferences) {
            if (profile.preferences.defaultModel) {
              modelConfig.model_id = profile.preferences.defaultModel
            }
            if (profile.preferences.defaultTemperature !== undefined) {
              modelConfig.temperature = profile.preferences.defaultTemperature
            }
            if (profile.preferences.systemPrompt) {
              modelConfig.system_prompt = profile.preferences.systemPrompt
            }
            if (profile.preferences.cachingEnabled !== undefined) {
              modelConfig.caching_enabled = profile.preferences.cachingEnabled
            }
            console.log(`[BFF] Loaded model config from DynamoDB:`, modelConfig)
          }
        } catch (error) {
          console.log('[BFF] DynamoDB model config not available, using defaults')
        }
      }
    } else {
      console.log('[BFF] Anonymous user - using default model config')
    }

    // Create a custom stream that:
    // 1. Immediately starts sending keep-alive (before AgentCore responds)
    // 2. Continues keep-alive during AgentCore processing
    // 3. Forwards AgentCore chunks when they arrive
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let lastActivityTime = Date.now()
        let keepAliveInterval: NodeJS.Timeout | null = null
        let agentStarted = false

        // Send initial keep-alive immediately to establish connection
        controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`))
        console.log('[BFF] Connection established, starting keep-alive')

        // Start keep-alive interval (runs every 20 seconds)
        keepAliveInterval = setInterval(() => {
          const now = Date.now()
          const timeSinceActivity = now - lastActivityTime

          // Send keep-alive if no data in last 20 seconds
          if (timeSinceActivity >= 20000) {
            const keepAlive = `: keep-alive ${new Date().toISOString()}\n\n`
            controller.enqueue(encoder.encode(keepAlive))
            console.log('[BFF] Sent keep-alive (waiting for AgentCore or during processing)')
            lastActivityTime = now
          }
        }, 20000) // Check every 20 seconds

        try {
          // Execute before hooks (session metadata, tool config, etc.)
          console.log('[BFF] Executing before hooks...')
          const hookManager = createDefaultHookManager()
          await hookManager.executeBeforeHooks({
            userId,
            sessionId,
            message,
            modelConfig,
            enabledTools: enabledToolsList,
          })

          // Invoke AgentCore Runtime with user's enabled tools and model config
          console.log('[BFF] Invoking AgentCore Runtime...')
          console.log('[BFF] Model config:', modelConfig)
          console.log('[BFF] Enabled tools:', enabledToolsList)

          const agentStream = await invokeAgentCoreRuntime(
            userId,
            sessionId,
            message,
            modelConfig.model_id,
            enabledToolsList.length > 0 ? enabledToolsList : undefined,
            undefined, // files
            modelConfig.temperature,
            modelConfig.system_prompt,
            modelConfig.caching_enabled
          )
          agentStarted = true
          console.log('[BFF] AgentCore stream started')

          // Read from AgentCore stream and forward chunks
          const reader = agentStream.getReader()

          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              console.log('[BFF] AgentCore stream completed')
              break
            }

            // Forward chunk from AgentCore
            controller.enqueue(value)
            lastActivityTime = Date.now()
          }

        } catch (error) {
          console.error('[BFF] Error during AgentCore streaming:', error)
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            content: error instanceof Error ? error.message : 'Unknown error',
            metadata: { session_id: sessionId }
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        } finally {
          // Clean up keep-alive interval
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval)
            console.log('[BFF] Keep-alive interval cleared')
          }
          controller.close()
        }
      }
    })

    // Set headers for Server-Sent Events
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Session-ID': sessionId,
      'Connection': 'keep-alive'
    })

    // Return the stream
    return new Response(stream, { headers })

  } catch (error) {
    console.error('[BFF] Error in chat endpoint:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
