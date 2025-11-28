/**
 * Chat streaming endpoint (BFF)
 * Invokes AgentCore Runtime and streams responses
 */
import { NextRequest } from 'next/server'
import { invokeAgentCoreRuntime } from '@/lib/agentcore-runtime-client'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'
import { createDefaultHookManager } from '@/lib/chat-hooks'
import { getSystemPrompt, type PromptId } from '@/lib/system-prompts'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'
export const maxDuration = 1800 // 30 minutes for long-running agent tasks (self-hosted, no Vercel limits)

export async function POST(request: NextRequest) {
  try {
    // Check if request is FormData (file upload) or JSON (text only)
    const contentType = request.headers.get('content-type') || ''
    const isFormData = contentType.includes('multipart/form-data')

    let message: string
    let model_id: string | undefined
    let enabled_tools: string[] | undefined
    let files: File[] | undefined

    if (isFormData) {
      // Parse FormData for file uploads
      const formData = await request.formData()
      message = formData.get('message') as string
      model_id = formData.get('model_id') as string | undefined

      const enabledToolsJson = formData.get('enabled_tools') as string | null
      if (enabledToolsJson) {
        enabled_tools = JSON.parse(enabledToolsJson)
      }

      // Extract and convert files to AgentCore format
      const uploadedFiles: File[] = []
      for (const [key, value] of formData.entries()) {
        if (key === 'files' && value instanceof File) {
          uploadedFiles.push(value)
        }
      }

      // Convert File objects to AgentCore format
      if (uploadedFiles.length > 0) {
        files = await Promise.all(
          uploadedFiles.map(async (file) => {
            const buffer = await file.arrayBuffer()
            const base64 = Buffer.from(buffer).toString('base64')

            return {
              filename: file.name,
              content_type: file.type || 'application/octet-stream',
              bytes: base64
            } as any // Type assertion to avoid AgentCore File type conflict
          })
        )
        console.log(`[BFF] Converted ${files.length} file(s) to AgentCore format`)
      }
    } else {
      // Parse JSON for text-only messages
      const body = await request.json()
      message = body.message
      model_id = body.model_id
      enabled_tools = body.enabled_tools
    }

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
    const { sessionId, isNew: isNewSession } = getSessionId(request, userId)

    console.log(`[BFF] User: ${userId}, Session: ${sessionId}${isNewSession ? ' (new)' : ''}`)

    // If new session, create session metadata
    if (isNewSession) {
      const now = new Date().toISOString()
      const sessionData = {
        title: message.length > 50 ? message.substring(0, 47) + '...' : message,
        messageCount: 0,
        lastMessageAt: now,
        status: 'active' as const,
        starred: false,
        tags: [],
      }

      // Create session in storage
      if (userId === 'anonymous') {
        if (IS_LOCAL) {
          const { upsertSession } = await import('@/lib/local-session-store')
          upsertSession(userId, sessionId, sessionData)
        }
      } else {
        if (IS_LOCAL) {
          const { upsertSession } = await import('@/lib/local-session-store')
          upsertSession(userId, sessionId, sessionData)
        } else {
          const { upsertSession: upsertDynamoSession } = await import('@/lib/dynamodb-client')
          await upsertDynamoSession(userId, sessionId, sessionData)
        }
      }
    }

    // Load or use provided enabled_tools
    let enabledToolsList: string[] = []

    if (enabled_tools && Array.isArray(enabled_tools)) {
      enabledToolsList = enabled_tools
    } else {
      // Load enabled tools for all users (including anonymous)
      if (IS_LOCAL) {
        const { getUserEnabledTools } = await import('@/lib/local-tool-store')
        enabledToolsList = getUserEnabledTools(userId)
      } else if (userId !== 'anonymous') {
        // DynamoDB only for authenticated users
        const { getUserEnabledTools } = await import('@/lib/dynamodb-client')
        enabledToolsList = await getUserEnabledTools(userId)
      }
    }

    // Helper function to get current date in US Pacific timezone
    function getCurrentDatePacific(): string {
      try {
        const now = new Date()

        // Get individual date/time components for Pacific timezone
        const year = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' })
        const month = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit' })
        const day = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', day: '2-digit' })
        const weekday = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' })
        const hour = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }).split(':')[0]

        // Determine PST or PDT (rough estimation: March-October is PDT)
        const monthNum = parseInt(month)
        const tzAbbr = (monthNum >= 3 && monthNum <= 10) ? 'PDT' : 'PST'

        // Format: "YYYY-MM-DD (Weekday) HH:00 TZ"
        return `${year}-${month}-${day} (${weekday}) ${hour}:00 ${tzAbbr}`
      } catch (error) {
        // Fallback to UTC
        const now = new Date()
        const isoDate = now.toISOString().split('T')[0]
        const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
        const hour = now.getUTCHours().toString().padStart(2, '0')
        return `${isoDate} (${weekday}) ${hour}:00 UTC`
      }
    }

    // Load model configuration from storage
    const defaultModelId = model_id || 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
    let selectedPromptId: PromptId = 'general'
    let customPromptText: string | undefined

    let modelConfig = {
      model_id: defaultModelId,
      temperature: 0.7,
      system_prompt: getSystemPrompt('general'),
      caching_enabled: defaultModelId.toLowerCase().includes('claude')
    }

    // Load model configuration for all users (including anonymous in local mode)
    if (IS_LOCAL) {
      try {
        const { getUserModelConfig } = await import('@/lib/local-tool-store')
        const config = getUserModelConfig(userId)
        console.log(`[BFF] Loaded model config for ${userId}:`, config)
        if (config) {
          // Update model and temperature
          if (config.model_id) {
            modelConfig.model_id = config.model_id
            modelConfig.caching_enabled = config.model_id.toLowerCase().includes('claude')
            console.log(`[BFF] Applied model_id: ${config.model_id}, caching: ${modelConfig.caching_enabled}`)
          }
          if (config.temperature !== undefined) {
            modelConfig.temperature = config.temperature
          }
          // Load selectedPromptId
          if (config.selectedPromptId) {
            selectedPromptId = config.selectedPromptId as PromptId
          }
          if (config.customPromptText) {
            customPromptText = config.customPromptText
          }
        } else {
          console.log(`[BFF] No saved config found for ${userId}, using defaults`)
        }
      } catch (error) {
        console.error(`[BFF] Error loading config for ${userId}:`, error)
        // Use defaults
      }
    } else if (userId !== 'anonymous') {
      // DynamoDB only for authenticated users
      try {
        const { getUserProfile } = await import('@/lib/dynamodb-client')
        const profile = await getUserProfile(userId)
        if (profile?.preferences) {
          if (profile.preferences.defaultModel) {
            modelConfig.model_id = profile.preferences.defaultModel
            modelConfig.caching_enabled = profile.preferences.defaultModel.toLowerCase().includes('claude')
          }
          if (profile.preferences.defaultTemperature !== undefined) {
            modelConfig.temperature = profile.preferences.defaultTemperature
          }
          // Load selectedPromptId (new way)
          if (profile.preferences.selectedPromptId) {
            selectedPromptId = profile.preferences.selectedPromptId as PromptId
          }
          // Load customPromptText for custom prompts
          if (profile.preferences.customPromptText) {
            customPromptText = profile.preferences.customPromptText
          }
        }
      } catch (error) {
        // Use defaults
      }
    }

    // Build system prompt based on selectedPromptId
    const basePrompt = getSystemPrompt(selectedPromptId, customPromptText)

    // Add current date to system prompt (at the end)
    const currentDate = getCurrentDatePacific()
    modelConfig.system_prompt = `${basePrompt}\n\nCurrent date and time: ${currentDate}`
    console.log(`[BFF] Added current date to system prompt: ${currentDate}`)

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

        // Start keep-alive interval (runs every 20 seconds)
        keepAliveInterval = setInterval(() => {
          const now = Date.now()
          const timeSinceActivity = now - lastActivityTime

          if (timeSinceActivity >= 20000) {
            try {
              controller.enqueue(encoder.encode(`: keep-alive ${new Date().toISOString()}\n\n`))
              lastActivityTime = now
            } catch (err) {
              // Controller already closed, stop interval
              if (keepAliveInterval) {
                clearInterval(keepAliveInterval)
                keepAliveInterval = null
              }
            }
          }
        }, 20000)

        try {
          // Execute before hooks (session metadata, tool config, etc.)
          const hookManager = createDefaultHookManager()
          await hookManager.executeBeforeHooks({
            userId,
            sessionId,
            message,
            modelConfig,
            enabledTools: enabledToolsList,
          })

          const agentStream = await invokeAgentCoreRuntime(
            userId,
            sessionId,
            message,
            modelConfig.model_id,
            enabledToolsList.length > 0 ? enabledToolsList : undefined,
            files, // Pass uploaded files to AgentCore
            modelConfig.temperature,
            modelConfig.system_prompt,
            modelConfig.caching_enabled
          )
          agentStarted = true

          // Read from AgentCore stream and forward chunks
          const reader = agentStream.getReader()

          while (true) {
            const { done, value } = await reader.read()

            if (done) break

            // Check if controller is still open before enqueueing
            try {
              controller.enqueue(value)
              lastActivityTime = Date.now()
            } catch (err) {
              // Controller closed (client disconnected) - stop processing
              console.log('[BFF] Controller closed, stopping stream processing')
              break
            }
          }

        } catch (error) {
          console.error('[BFF] Error:', error)
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            content: error instanceof Error ? error.message : 'Unknown error',
            metadata: { session_id: sessionId }
          })}\n\n`
          try {
            controller.enqueue(encoder.encode(errorEvent))
          } catch (err) {
            // Controller already closed, ignore
            console.log('[BFF] Controller closed, cannot send error event')
          }
        } finally {
          // Update session metadata after message processing
          try {
            let currentSession: any = null
            if (userId === 'anonymous') {
              if (IS_LOCAL) {
                const { getSession } = await import('@/lib/local-session-store')
                currentSession = getSession(userId, sessionId)
              }
            } else {
              if (IS_LOCAL) {
                const { getSession } = await import('@/lib/local-session-store')
                currentSession = getSession(userId, sessionId)
              } else {
                const { getSession: getDynamoSession } = await import('@/lib/dynamodb-client')
                currentSession = await getDynamoSession(userId, sessionId)
              }
            }

            if (currentSession) {
              const updates: any = {
                lastMessageAt: new Date().toISOString(),
                messageCount: (currentSession.messageCount || 0) + 1,
                // Do NOT pass metadata here - let updateSession preserve it via deep merge
              }

              if (userId === 'anonymous') {
                if (IS_LOCAL) {
                  const { updateSession } = await import('@/lib/local-session-store')
                  updateSession(userId, sessionId, updates)
                }
              } else {
                if (IS_LOCAL) {
                  const { updateSession } = await import('@/lib/local-session-store')
                  updateSession(userId, sessionId, updates)
                } else {
                  const { updateSession: updateDynamoSession } = await import('@/lib/dynamodb-client')
                  await updateDynamoSession(userId, sessionId, updates)
                }
              }
            }
          } catch (updateError) {
            console.error('[BFF] Session update error:', updateError)
          }

          if (keepAliveInterval) {
            clearInterval(keepAliveInterval)
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
      'X-Session-Is-New': isNewSession ? 'true' : 'false',
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
