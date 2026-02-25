/**
 * Chat streaming endpoint (BFF)
 * Invokes AgentCore Runtime and streams responses
 */
import { NextRequest } from 'next/server'
import { invokeAgentCoreRuntime, invokeAgentCoreRuntimeAgui } from '@/lib/agentcore-runtime-client'
import { extractUserFromRequest, getSessionId, ensureSessionExists } from '@/lib/auth-utils'
import { createDefaultHookManager } from '@/lib/chat-hooks'
import { getSystemPrompt } from '@/lib/system-prompts'
import sharp from 'sharp'
// Note: browser-session-poller is dynamically imported when browser-use-agent is enabled

// Maximum image size in bytes (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

/**
 * Resize image if it exceeds max size
 * Progressively reduces quality and resolution until under limit
 */
async function resizeImageIfNeeded(
  buffer: Buffer,
  contentType: string,
  filename: string
): Promise<{ buffer: Buffer; resized: boolean }> {
  // Only process images
  if (!contentType.startsWith('image/')) {
    return { buffer, resized: false }
  }

  // Skip if already under limit
  if (buffer.length <= MAX_IMAGE_SIZE) {
    return { buffer, resized: false }
  }

  console.log(`[BFF] Image ${filename} is ${(buffer.length / 1024 / 1024).toFixed(2)}MB, resizing...`)

  // Determine output format (convert to jpeg for better compression, keep png for transparency)
  const isPng = contentType === 'image/png'
  const isGif = contentType === 'image/gif'

  // Don't process GIFs (animated)
  if (isGif) {
    console.log(`[BFF] Skipping GIF resize (may be animated)`)
    return { buffer, resized: false }
  }

  let result = buffer
  let quality = 85
  const maxDimension = 2048

  try {
    // First pass: resize to max dimension and initial quality
    let sharpInstance = sharp(buffer)
      .resize(maxDimension, maxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      })

    if (isPng) {
      result = await sharpInstance.png({ quality, compressionLevel: 9 }).toBuffer()
    } else {
      result = await sharpInstance.jpeg({ quality }).toBuffer()
    }

    // Progressive quality reduction if still too large
    while (result.length > MAX_IMAGE_SIZE && quality > 30) {
      quality -= 10
      sharpInstance = sharp(buffer)
        .resize(maxDimension, maxDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })

      if (isPng) {
        // For PNG, also reduce colors if quality is low
        result = await sharpInstance.png({ quality, compressionLevel: 9 }).toBuffer()
      } else {
        result = await sharpInstance.jpeg({ quality }).toBuffer()
      }
    }

    // If still too large, reduce dimensions further
    if (result.length > MAX_IMAGE_SIZE) {
      const reducedDimension = 1024
      sharpInstance = sharp(buffer)
        .resize(reducedDimension, reducedDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })

      if (isPng) {
        result = await sharpInstance.png({ quality: 60, compressionLevel: 9 }).toBuffer()
      } else {
        result = await sharpInstance.jpeg({ quality: 60 }).toBuffer()
      }
    }

    console.log(`[BFF] Resized ${filename}: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> ${(result.length / 1024 / 1024).toFixed(2)}MB (quality: ${quality})`)
    return { buffer: result, resized: true }

  } catch (error) {
    console.error(`[BFF] Failed to resize image ${filename}:`, error)
    return { buffer, resized: false }
  }
}

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
    let temperature: number | undefined
    let enabled_tools: string[] | undefined
    let files: File[] | undefined
    let request_type: string | undefined
    let selected_artifact_id: string | undefined
    let system_prompt: string | undefined
    let threadIdFromBody: string | undefined
    let runIdFromBody: string | undefined

    if (isFormData) {
      // Parse FormData for file uploads
      const formData = await request.formData()
      message = formData.get('message') as string
      model_id = formData.get('model_id') as string | undefined
      const temperatureStr = formData.get('temperature') as string | null
      if (temperatureStr) {
        temperature = parseFloat(temperatureStr)
      }

      const enabledToolsJson = formData.get('enabled_tools') as string | null
      if (enabledToolsJson) {
        enabled_tools = JSON.parse(enabledToolsJson)
      }

      request_type = formData.get('request_type') as string | undefined
      system_prompt = formData.get('system_prompt') as string | undefined

      // Extract and convert files to AgentCore format
      const uploadedFiles: File[] = []
      for (const [key, value] of formData.entries()) {
        if (key === 'files' && value instanceof File) {
          uploadedFiles.push(value)
        }
      }

      // Convert File objects to AgentCore format (with image resize if needed)
      if (uploadedFiles.length > 0) {
        files = await Promise.all(
          uploadedFiles.map(async (file) => {
            const arrayBuffer = await file.arrayBuffer()
            let buffer = Buffer.from(arrayBuffer)
            const contentType = file.type || 'application/octet-stream'

            // Resize image if it exceeds 5MB
            const { buffer: processedBuffer, resized } = await resizeImageIfNeeded(
              buffer,
              contentType,
              file.name
            )

            if (resized) {
              buffer = processedBuffer
            }

            const base64 = buffer.toString('base64')

            return {
              filename: file.name,
              content_type: contentType,
              bytes: base64
            } as any // Type assertion to avoid AgentCore File type conflict
          })
        )
        console.log(`[BFF] Converted ${files.length} file(s) to AgentCore format`)
      }
    } else {
      // Parse JSON as AG-UI RunAgentInput: { threadId, runId, messages, tools, state }
      const body = await request.json()

      threadIdFromBody = body.threadId
      runIdFromBody = body.runId

      // Per-request config lives in body.state (replaces former top-level fields)
      const state = body.state ?? {}
      model_id = state.model_id
      temperature = state.temperature
      request_type = state.request_type
      enabled_tools = state.enabled_tools
      selected_artifact_id = state.selected_artifact_id
      system_prompt = state.system_prompt

      // If enabled_tools is not in state, fall back to extracting names from AG-UI body.tools
      if (!enabled_tools && Array.isArray(body.tools)) {
        enabled_tools = body.tools.map((t: { name: string }) => t.name)
      }

      // Extract user message from the last element of body.messages
      const bodyMessages: Array<{ id?: string; role?: string; content?: string }> = body.messages ?? []
      const lastMsg = bodyMessages[bodyMessages.length - 1]
      message = lastMsg?.content ?? ''
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

    // Extract raw JWT token for forwarding to MCP Runtime (3LO OAuth user identity)
    const authHeader = request.headers.get('authorization') || ''
    const authToken = authHeader.startsWith('Bearer ') ? authHeader : ''
    console.log(`[BFF] Authorization header present: ${!!authHeader}, starts with Bearer: ${authHeader.startsWith('Bearer ')}, authToken length: ${authToken.length}`)

    // Get or generate session ID (user-specific)
    // For the AG-UI JSON path, threadId from RunAgentInput is the authoritative session identifier
    let { sessionId } = getSessionId(request, userId)
    if (threadIdFromBody) {
      sessionId = threadIdFromBody
    }

    // Ensure session exists in storage (creates if not exists)
    const { isNew: isNewSession } = await ensureSessionExists(userId, sessionId, {
      title: message.length > 50 ? message.substring(0, 47) + '...' : message,
    })

    console.log(`[BFF] User: ${userId}, Session: ${sessionId}${isNewSession ? ' (new)' : ''}`)

    // Load or use provided enabled_tools
    let enabledToolsList: string[] = []

    if (enabled_tools && Array.isArray(enabled_tools)) {
      enabledToolsList = enabled_tools
    } else {
      // Load enabled tools for all users (including anonymous in AWS)
      if (IS_LOCAL) {
        const { getUserEnabledTools } = await import('@/lib/local-tool-store')
        enabledToolsList = getUserEnabledTools(userId)
      } else {
        // DynamoDB for all users including anonymous
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

    // Load model configuration from storage (only if not provided in request)
    const defaultModelId = model_id || 'us.anthropic.claude-sonnet-4-6'

    let modelConfig = {
      model_id: defaultModelId,
      temperature: temperature ?? 0.5,
      system_prompt: getSystemPrompt(),
      caching_enabled: defaultModelId.toLowerCase().includes('claude')
    }

    // Only load global profile config if model_id was NOT provided in the request
    // When the frontend sends model_id/temperature, they represent per-session state
    if (!model_id) {
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
          } else {
            console.log(`[BFF] No saved config found for ${userId}, using defaults`)
          }
        } catch (error) {
          console.error(`[BFF] Error loading config for ${userId}:`, error)
          // Use defaults
        }
      } else {
        // DynamoDB for all users (including anonymous)
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
          }
        } catch (error) {
          // Use defaults
        }
      }
    } else {
      console.log(`[BFF] Using request-provided model_id: ${model_id}, temperature: ${temperature}`)
    }

    // Use default system prompt (prompt selection feature removed)
    const basePrompt = getSystemPrompt()

    // Add current date to system prompt (at the end)
    const currentDate = getCurrentDatePacific()
    modelConfig.system_prompt = `${basePrompt}\n\nCurrent date and time: ${currentDate}`
    console.log(`[BFF] Added current date to system prompt: ${currentDate}`)

    // Load user API keys
    let userApiKeys: Record<string, string> | undefined
    if (IS_LOCAL) {
      try {
        const { getUserApiKeys } = await import('@/lib/local-tool-store')
        const apiKeys = getUserApiKeys(userId)
        if (apiKeys && Object.keys(apiKeys).length > 0) {
          userApiKeys = apiKeys as Record<string, string>
          console.log(`[BFF] Loaded user API keys for ${userId}:`, Object.keys(userApiKeys))
        }
      } catch (error) {
        console.warn('[BFF] Failed to load user API keys from local store:', error)
      }
    } else {
      try {
        const { getUserProfile } = await import('@/lib/dynamodb-client')
        const profile = await getUserProfile(userId)
        if (profile?.preferences?.apiKeys) {
          const apiKeys = profile.preferences.apiKeys
          // Filter out empty/null values
          userApiKeys = Object.fromEntries(
            Object.entries(apiKeys).filter(([_, v]) => v && v.trim() !== '')
          ) as Record<string, string>
          if (Object.keys(userApiKeys).length > 0) {
            console.log(`[BFF] Loaded user API keys for ${userId}:`, Object.keys(userApiKeys))
          } else {
            userApiKeys = undefined
          }
        }
      } catch (error) {
        console.warn('[BFF] Failed to load user API keys from DynamoDB:', error)
      }
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

        // AbortController for browser session polling
        const pollingAbortController = new AbortController()
        let browserSessionPollingStarted = false

        // AbortController for AgentCore stream (to cancel on client disconnect)
        const agentCoreAbortController = new AbortController()
        let agentCoreReader: ReadableStreamDefaultReader<Uint8Array> | null = null

        // Listen for client disconnect via request.signal
        request.signal.addEventListener('abort', () => {
          console.log('[BFF] Client disconnected (request.signal aborted), cancelling AgentCore stream')
          agentCoreAbortController.abort()
          if (agentCoreReader) {
            agentCoreReader.cancel().catch(err => {
              console.warn('[BFF] Error cancelling reader on abort:', err)
            })
          }
        })

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

          console.log(`[BFF] Enabled tools: ${JSON.stringify(enabledToolsList)}`)

          // Merge system prompts: user-provided (artifact context) + model config
          let finalSystemPrompt = modelConfig.system_prompt
          if (system_prompt) {
            finalSystemPrompt = `${modelConfig.system_prompt}\n\n${system_prompt}`
          }

          let agentStream: ReadableStream
          if (threadIdFromBody) {
            // AG-UI path: send RunAgentInput in snake_case so backend uses AGUIStreamEventProcessor
            const aguiBody: Record<string, any> = {
              thread_id: threadIdFromBody,
              run_id: runIdFromBody || crypto.randomUUID(),
              messages: [{ id: crypto.randomUUID(), role: 'user', content: message }],
              tools: enabledToolsList.map(name => ({ name, description: '' })),
              context: [],
              state: {
                user_id: userId,
                model_id: modelConfig.model_id,
                temperature: modelConfig.temperature,
                system_prompt: finalSystemPrompt,
                caching_enabled: modelConfig.caching_enabled,
                ...(request_type && { request_type }),
                ...(selected_artifact_id && { selected_artifact_id }),
              },
            }
            agentStream = await invokeAgentCoreRuntimeAgui(aguiBody, agentCoreAbortController.signal)
          } else {
            agentStream = await invokeAgentCoreRuntime(
              userId,
              sessionId,
              message,
              modelConfig.model_id,
              enabledToolsList.length > 0 ? enabledToolsList : undefined,
              files,
              modelConfig.temperature,
              finalSystemPrompt,
              modelConfig.caching_enabled,
              agentCoreAbortController.signal,
              request_type,
              selected_artifact_id,
              userApiKeys,
              authToken
            )
          }
          agentStarted = true

          // Read from AgentCore stream and forward chunks
          const reader = agentStream.getReader()
          agentCoreReader = reader // Store for abort handler

          while (true) {
            const { done, value } = await reader.read()

            if (done) break

            // Check if controller is still open before enqueueing
            try {
              controller.enqueue(value)
              lastActivityTime = Date.now()
            } catch (err) {
              // Controller closed (client disconnected) - gracefully cancel AgentCore stream
              console.log('[BFF] Controller closed, cancelling AgentCore stream for graceful shutdown')
              try {
                await reader.cancel()
                console.log('[BFF] AgentCore stream cancelled successfully')
              } catch (cancelErr) {
                console.error('[BFF] Error cancelling AgentCore stream:', cancelErr)
              }
              break
            }
          }

        } catch (error) {
          console.error('[BFF] Error:', error)
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
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
                // Save model and tool preferences for session restoration
                metadata: {
                  lastModel: modelConfig.model_id,
                  lastTemperature: modelConfig.temperature,
                  enabledTools: enabledToolsList,
                  skillsEnabled: request_type === 'skill',
                },
              }

              // Save session metadata for all users (including anonymous in AWS)
              if (IS_LOCAL) {
                const { updateSession } = await import('@/lib/local-session-store')
                updateSession(userId, sessionId, updates)
              } else {
                const { updateSession: updateDynamoSession } = await import('@/lib/dynamodb-client')
                await updateDynamoSession(userId, sessionId, updates)
              }
            }
          } catch (updateError) {
            console.error('[BFF] Session update error:', updateError)
          }

          // Stop browser session polling
          if (browserSessionPollingStarted) {
            pollingAbortController.abort()
            console.log('[BFF] Stopped browser session polling')
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
