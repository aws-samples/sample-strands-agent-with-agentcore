/**
 * Multimodal chat streaming endpoint (BFF)
 * Handles file uploads and proxies to AgentCore Runtime
 */
import { NextRequest } from 'next/server'
import { invokeAgentCoreRuntime } from '@/lib/agentcore-runtime-client'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'
export const maxDuration = 1800 // 30 minutes for long-running agent tasks (self-hosted, no Vercel limits)

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const message = formData.get('message') as string
    const files = formData.getAll('files') as File[]
    const enabledToolsJson = formData.get('enabled_tools') as string | null

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

    console.log(`[BFF] Multimodal request - User: ${userId}, Session: ${sessionId}`)
    console.log(`[BFF] Files: ${files.length} files`)

    // Handle enabled_tools from form data
    let enabledToolsList: string[] = []

    if (enabledToolsJson) {
      // Frontend sent enabled_tools - use them and commit to storage
      try {
        enabledToolsList = JSON.parse(enabledToolsJson)
        console.log(`[BFF] Received enabled_tools from frontend (${enabledToolsList.length}):`, enabledToolsList)

        // Commit to storage for authenticated users
        if (userId !== 'anonymous') {
          if (IS_LOCAL) {
            // Local: Use file-based storage
            const { updateUserEnabledTools } = await import('@/lib/local-tool-store')
            updateUserEnabledTools(userId, enabledToolsList)
            console.log(`[BFF] Committed enabled_tools to local file store for user ${userId}`)
          } else {
            // AWS: Use DynamoDB
            const { updateUserEnabledTools } = await import('@/lib/dynamodb-client')
            await updateUserEnabledTools(userId, enabledToolsList)
            console.log(`[BFF] Committed enabled_tools to DynamoDB for user ${userId}`)
          }
        }
      } catch (error) {
        console.error('[BFF] Error parsing enabled_tools:', error)
      }
    } else {
      // No enabled_tools in request - load from storage (backward compatibility)
      if (userId !== 'anonymous') {
        if (IS_LOCAL) {
          // Local: Load from file
          const { getUserEnabledTools } = await import('@/lib/local-tool-store')
          enabledToolsList = getUserEnabledTools(userId)
          console.log(`[BFF] Loaded enabled_tools from local file store (${enabledToolsList.length}):`, enabledToolsList)
        } else {
          // AWS: Load from DynamoDB
          const { getUserEnabledTools } = await import('@/lib/dynamodb-client')
          enabledToolsList = await getUserEnabledTools(userId)
          console.log(`[BFF] Loaded enabled_tools from DynamoDB (${enabledToolsList.length}):`, enabledToolsList)
        }
      } else {
        console.log('[BFF] Anonymous user - all tools enabled by default')
      }
    }

    // Convert files to base64
    const fileContents = await Promise.all(
      files.map(async (file) => {
        const arrayBuffer = await file.arrayBuffer()
        const bytes = Buffer.from(arrayBuffer).toString('base64')
        return {
          filename: file.name,
          content_type: file.type,
          bytes
        }
      })
    )

    // Note: AgentCore Runtime doesn't have a separate multimodal endpoint yet
    // Files are sent in the same payload as regular chat
    // TODO: Update invokeAgentCoreRuntime to support file attachments

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let keepAliveInterval: NodeJS.Timeout | null = null
        let lastActivityTime = Date.now()

        try {
          // Send initial keep-alive
          controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`))
          console.log('[BFF] Multimodal connection established, starting keep-alive')

          // Start keep-alive interval
          keepAliveInterval = setInterval(() => {
            const now = Date.now()
            const timeSinceActivity = now - lastActivityTime

            if (timeSinceActivity >= 20000) {
              const keepAlive = `: keep-alive ${new Date().toISOString()}\n\n`
              controller.enqueue(encoder.encode(keepAlive))
              console.log('[BFF] Sent keep-alive (multimodal)')
              lastActivityTime = now
            }
          }, 20000)

          // Invoke AgentCore Runtime with files
          console.log('[BFF] Invoking AgentCore Runtime with files...')
          console.log(`[BFF] Files: ${fileContents.length} files`)
          const agentStream = await invokeAgentCoreRuntime(
            userId,
            sessionId,
            message,
            undefined, // modelId
            enabledToolsList.length > 0 ? enabledToolsList : undefined,
            fileContents.length > 0 ? fileContents : undefined // Pass files
          )

          const reader = agentStream.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
            lastActivityTime = Date.now()
          }

          console.log('[BFF] Multimodal stream completed')
        } catch (error) {
          console.error('[BFF] Error streaming multimodal from AgentCore:', error)
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            content: error instanceof Error ? error.message : 'Unknown error',
            metadata: { session_id: sessionId }
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        } finally {
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval)
            console.log('[BFF] Keep-alive interval cleared (multimodal)')
          }
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Session-ID': sessionId,
        'Connection': 'keep-alive'
      }
    })
  } catch (error) {
    console.error('Error in multimodal endpoint:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
