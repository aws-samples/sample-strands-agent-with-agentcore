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
    // Note: limit parameter is deprecated - we now paginate through all events

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

    let artifacts: any[] = []

    if (userId === 'anonymous' || IS_LOCAL || !memoryId) {
      // Local mode or anonymous user - load from local file storage
      console.log(`[API] Using local file storage (IS_LOCAL=${IS_LOCAL}, memoryId=${memoryId ? 'present' : 'missing'})`)
      const { getSessionMessages, getSessionArtifacts } = await import('@/lib/local-session-store')
      messages = getSessionMessages(sessionId)
      artifacts = getSessionArtifacts(sessionId)
      console.log(`[API] Loaded ${messages.length} messages from local file`)
      console.log(`[API] Loaded ${artifacts.length} artifacts from local file`)
    } else {
      // AWS mode - load from AgentCore Memory
      console.log(`[API] Using AgentCore Memory: ${memoryId}`)
      await initializeAwsClients()

      if (!BedrockAgentCoreClient) {
        throw new Error('AgentCore Memory client not available')
      }

      const client = new BedrockAgentCoreClient({ region: AWS_REGION })

      // Paginate through all events (API max is 100 per request)
      let allEvents: any[] = []
      let nextToken: string | undefined

      do {
        const command = new ListEventsCommand({
          memoryId: memoryId,
          sessionId: sessionId,
          actorId: userId,
          includePayloads: true,
          maxResults: 100, // API maximum
          nextToken,
        })

        const response = await client.send(command)
        const pageEvents = response.events || []
        allEvents.push(...pageEvents)
        nextToken = response.nextToken

        console.log(`[API] Retrieved ${pageEvents.length} events (total: ${allEvents.length})${nextToken ? ', fetching more...' : ''}`)
      } while (nextToken)

      const events = allEvents
      console.log(`[API] Retrieved ${events.length} total events from AgentCore Memory`)

      // Convert AgentCore Memory events to chat messages
      // Events are returned newest-first, reverse to get chronological order
      const reversedEvents = [...events].reverse()

      // AgentCore Memory SDK stores messages in ONE of two formats (not both):
      // - conversational: messages under 9000 chars
      // - blob: messages 9000 chars or more
      //
      // SDK logic (session_manager.py create_message):
      //   if not exceeds_conversational_limit: create conversational event
      //   else: create blob event (no conversational)
      messages = []
      let msgIndex = 0

      // Also look for agent_state (artifacts are stored in agent.state.artifacts)
      // Events are newest-first, so we find the latest agent_state first
      let latestAgentState: any = null

      for (const event of events) {
        for (const payloadItem of event.payload || []) {
          if (payloadItem.blob && typeof payloadItem.blob === 'string') {
            try {
              const blobData = JSON.parse(payloadItem.blob)
              if (
                typeof blobData === 'object' &&
                blobData._payload_type === 'agent_state' &&
                blobData._agent_id === 'default'  // ChatAgent uses 'default' agent_id
              ) {
                latestAgentState = blobData
                break  // Found latest, stop searching
              }
            } catch {
              // Not JSON or invalid format, skip
            }
          }
        }
        if (latestAgentState) break  // Found latest agent_state
      }

      // Extract artifacts from agent_state
      if (latestAgentState?.state?.artifacts) {
        artifacts = Object.values(latestAgentState.state.artifacts)
        console.log(`[API] Loaded ${artifacts.length} artifacts from AgentCore Memory agent_state`)
      }

      for (let i = 0; i < reversedEvents.length; i++) {
        const event = reversedEvents[i]
        const payload = event.payload?.[0]

        if (!payload) continue

        // Case 1: Conversational event (message < 9000 chars)
        if (payload.conversational) {
          const conv = payload.conversational
          const content = conv.content?.text || ''

          if (!content) {
            console.warn(`[API] Event ${event.eventId} has no content, skipping`)
            continue
          }

          let parsed
          try {
            parsed = JSON.parse(content)
          } catch (e) {
            console.error(`[API] Failed to parse conversational content:`, e)
            continue
          }

          // Skip agent_state payloads (already processed above)
          if (parsed._payload_type === 'agent_state') {
            continue
          }

          if (!parsed.message) {
            console.warn(`[API] Event ${event.eventId} missing "message" key, skipping`)
            continue
          }

          const message = {
            ...parsed.message,
            id: event.eventId || `msg-${sessionId}-${msgIndex}`,
            timestamp: event.eventTime || new Date().toISOString()
          }
          msgIndex++
          messages.push(message)
        }
        // Case 2: Blob event (message >= 9000 chars)
        else if (payload.blob && typeof payload.blob === 'string') {
          try {
            const blobParsed = JSON.parse(payload.blob)

            // Skip agent_state blobs (already processed above)
            if (typeof blobParsed === 'object' && blobParsed._payload_type === 'agent_state') {
              continue
            }

            // Blob format from SDK: ["message_json", "role"] tuple
            if (Array.isArray(blobParsed) && blobParsed.length >= 1) {
              const blobMessageData = JSON.parse(blobParsed[0])

              if (blobMessageData?.message) {
                const message = {
                  ...blobMessageData.message,
                  id: event.eventId || `msg-${sessionId}-${msgIndex}`,
                  timestamp: event.eventTime || new Date().toISOString()
                }
                msgIndex++
                messages.push(message)
                console.log(`[API] Restored blob message (role: ${message.role}, content items: ${message.content?.length || 0})`)
              }
            }
          } catch (e) {
            console.error(`[API] Failed to parse blob:`, e)
          }
        }
      }

      console.log(`[API] Loaded ${messages.length} messages for session ${sessionId}`)
    }

    // Load session metadata and merge with messages
    let sessionMetadata: any = null
    if (IS_LOCAL) {
      const { getSession } = await import('@/lib/local-session-store')
      const session = getSession(userId, sessionId)
      sessionMetadata = session?.metadata
    } else {
      const { getSession } = await import('@/lib/dynamodb-client')
      const session = await getSession(userId, sessionId)
      sessionMetadata = session?.metadata
    }

    // Merge message metadata (latency, tokenUsage, feedback, documents, etc.) with messages
    if (sessionMetadata?.messages) {
      messages = messages.map(msg => {
        const messageMetadata = sessionMetadata.messages[msg.id]
        if (messageMetadata) {
          return {
            ...msg,
            // Merge latency metadata if available
            ...(messageMetadata.latency && { latencyMetrics: messageMetadata.latency }),
            // Merge token usage if available
            ...(messageMetadata.tokenUsage && { tokenUsage: messageMetadata.tokenUsage }),
            // Merge feedback if available
            ...(messageMetadata.feedback && { feedback: messageMetadata.feedback }),
            // Merge documents if available (for Word/PPT download buttons)
            ...(messageMetadata.documents && { documents: messageMetadata.documents }),
          }
        }
        return msg
      })
      console.log(`[API] Merged metadata for ${Object.keys(sessionMetadata.messages).length} message(s)`)
    }

    // Return messages with merged toolResults from blobs and metadata
    // Also include session preferences (model, tools) for restoration
    // And include artifacts
    return NextResponse.json({
      success: true,
      sessionId,
      messages: messages,
      count: messages.length,
      artifacts: artifacts, // Include artifacts in response
      // Include session preferences for restoration
      sessionPreferences: sessionMetadata ? {
        lastModel: sessionMetadata.lastModel,
        lastTemperature: sessionMetadata.lastTemperature,
        enabledTools: sessionMetadata.enabledTools,
      } : null,
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
