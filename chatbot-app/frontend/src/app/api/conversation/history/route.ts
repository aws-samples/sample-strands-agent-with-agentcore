/**
 * Conversation History API - Load chat messages from AgentCore Memory
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'
const AWS_REGION = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2'
const PROJECT_NAME = process.env.PROJECT_NAME || 'strands-agent-chatbot'
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev'

export const runtime = 'nodejs'

// Dynamic import for AWS SDK (only in cloud mode)
let BedrockAgentCoreClient: any
let ListEventsCommand: any
let SSMClient: any
let GetParameterCommand: any

// Cache for MEMORY_ID
let cachedMemoryId: string | null = null

async function getMemoryId(): Promise<string | null> {
  // Use environment variable if available
  const envMemoryId = process.env.MEMORY_ID || process.env.NEXT_PUBLIC_MEMORY_ID
  if (envMemoryId) {
    return envMemoryId
  }

  // Return cached value if available
  if (cachedMemoryId) {
    return cachedMemoryId
  }

  // Fetch from Parameter Store
  try {
    if (!SSMClient) {
      const ssmModule = await import('@aws-sdk/client-ssm')
      SSMClient = ssmModule.SSMClient
      GetParameterCommand = ssmModule.GetParameterCommand
    }

    const ssmClient = new SSMClient({ region: AWS_REGION })
    const paramPath = `/${PROJECT_NAME}/${ENVIRONMENT}/agentcore/memory-id`

    console.log(`[ConversationHistory] Fetching Memory ID from SSM: ${paramPath}`)

    const command = new GetParameterCommand({ Name: paramPath })
    const response = await ssmClient.send(command)

    if (response.Parameter?.Value) {
      cachedMemoryId = response.Parameter.Value
      console.log('[ConversationHistory] ✅ Memory ID loaded from Parameter Store')
      return cachedMemoryId
    }
  } catch (error) {
    console.warn('[ConversationHistory] ⚠️ Failed to load Memory ID from Parameter Store:', error)
  }

  return null
}

async function initializeAwsClients() {
  if (IS_LOCAL) return

  if (!BedrockAgentCoreClient) {
    const bedrockModule = await import('@aws-sdk/client-bedrock-agentcore')
    BedrockAgentCoreClient = bedrockModule.BedrockAgentCoreClient
    ListEventsCommand = bedrockModule.ListEventsCommand
  }
}

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const sessionId = searchParams.get('session_id')
    const limit = parseInt(searchParams.get('limit') || '100')

    if (!sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing session_id parameter',
        },
        { status: 400 }
      )
    }

    console.log(`[API] Loading conversation history for session ${sessionId}, user ${userId}`)

    let messages: any[] = []

    // Get Memory ID (from env or Parameter Store)
    const memoryId = await getMemoryId()

    if (userId === 'anonymous' || IS_LOCAL || !memoryId) {
      // Local mode or anonymous user - load from local file storage
      console.log(`[API] Using local file storage (IS_LOCAL=${IS_LOCAL}, memoryId=${memoryId ? 'present' : 'missing'})`)
      const { getSessionMessages } = await import('@/lib/local-session-store')
      messages = getSessionMessages(sessionId)
      console.log(`[API] Loaded ${messages.length} messages from local file`)
    } else {
      // AWS mode - load from AgentCore Memory
      console.log(`[API] Using AgentCore Memory: ${memoryId}`)
      await initializeAwsClients()

      if (!BedrockAgentCoreClient) {
        throw new Error('AgentCore Memory client not available')
      }

      const client = new BedrockAgentCoreClient({ region: AWS_REGION })

      const command = new ListEventsCommand({
        memoryId: memoryId,
        sessionId: sessionId,
        actorId: userId,
        includePayloads: true,
        maxResults: limit,
      })

      const response = await client.send(command)
      const events = response.events || []

      console.log(`[API] Retrieved ${events.length} events from AgentCore Memory`)

      // Convert AgentCore Memory events to chat messages
      // Events are returned newest-first, reverse to get chronological order
      const reversedEvents = [...events].reverse()

      // First pass: collect all blob events indexed by their position
      // Blobs appear AFTER the conversational event that contains the toolUse
      const blobsByIndex = new Map<number, any>()
      reversedEvents.forEach((event: any, index: number) => {
        if (event.payload && event.payload[0]?.blob) {
          // Associate this blob with the previous conversational event (index - 1)
          blobsByIndex.set(index - 1, event.payload[0].blob)
        }
      })

      if (blobsByIndex.size > 0) {
        console.log(`[API] Found ${blobsByIndex.size} blob event(s)`)
      }

      // Second pass: process conversational events and merge with blob toolResults
      const conversationalEvents = reversedEvents
        .map((event: any, index: number) => ({ event, index }))
        .filter(({ event }) => event.payload && event.payload[0]?.conversational)

      messages = conversationalEvents.map(({ event, index }, msgIndex) => {
        const conv = event.payload[0].conversational

        // Parse content - AgentCore Memory stores messages as JSON string {"message": {...}}
        const content = conv.content?.text || '';

        if (!content) {
          throw new Error(`Event ${event.eventId} has no content`);
        }

        const parsed = JSON.parse(content);

        // Must be in {"message": {...}} format
        if (!parsed.message) {
          throw new Error(`Event ${event.eventId} missing "message" key. Got: ${JSON.stringify(parsed)}`);
        }

        const message = {
          ...parsed.message, // Contains role and content array
          id: event.eventId || `msg-${sessionId}-${msgIndex}`,
          timestamp: event.eventTime || new Date().toISOString()
        }

        // Check if there's a blob associated with this conversational event
        // Blob events contain ALL toolResults for this assistant turn
        if (blobsByIndex.has(index) && message.role === 'assistant') {
          const blobData = blobsByIndex.get(index)

          if (blobData && typeof blobData === 'string') {
            try {
              // Blob from Strands SDK: JSON array ["message_json", "role"]
              const parsed = JSON.parse(blobData)

              if (Array.isArray(parsed) && parsed.length >= 1) {
                // Parse the message JSON (first element of array)
                const messageData = JSON.parse(parsed[0])

                // Extract ALL toolResults from blob and merge into message content
                if (messageData?.message?.content && Array.isArray(messageData.message.content)) {
                  const blobToolResults = messageData.message.content.filter((item: any) => item.toolResult)

                  // Process each toolResult
                  blobToolResults.forEach((toolResultItem: any) => {
                    const toolResult = toolResultItem.toolResult
                    const toolUseId = toolResult.toolUseId

                    // Add toolResult to message.content array (after corresponding toolUse)
                    // Find the index of the toolUse with matching toolUseId
                    const toolUseIndex = message.content.findIndex(
                      (item: any) => item.toolUse && item.toolUse.toolUseId === toolUseId
                    )

                    if (toolUseIndex !== -1) {
                      // Insert toolResult after toolUse
                      message.content.splice(toolUseIndex + 1, 0, { toolResult })
                    } else {
                      // ToolUse not found - append to end
                      message.content.push({ toolResult })
                    }

                    // No need to store in _blobImages - images are already in toolResult.content
                  })

                  if (blobToolResults.length > 0) {
                    console.log(`[API] Merged ${blobToolResults.length} toolResult(s) from blob into message ${message.id}`)
                  }
                }
              }
            } catch (e) {
              console.error(`[API] Failed to process blob:`, e)
            }
          }
        }

        return message
      })

      console.log(`[API] Loaded ${messages.length} messages for session ${sessionId}`)
    }

    // Return messages with merged toolResults from blobs
    return NextResponse.json({
      success: true,
      sessionId,
      messages: messages,
      count: messages.length,
    })
  } catch (error) {
    console.error('[API] Error loading conversation history:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load conversation history',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
