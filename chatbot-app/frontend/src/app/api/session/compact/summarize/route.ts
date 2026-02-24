/**
 * Session Compact - Step 2: Generate summary from old session
 *
 * Called after the UI has already switched to the new session.
 * Loads the old session's conversation history and generates a summary via Bedrock Converse.
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'

const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'
const AWS_REGION = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2'
const PROJECT_NAME = process.env.PROJECT_NAME || 'strands-agent-chatbot'
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev'

export const runtime = 'nodejs'

async function getMemoryId(): Promise<string | null> {
  const envMemoryId = process.env.MEMORY_ID || process.env.NEXT_PUBLIC_MEMORY_ID
  if (envMemoryId) return envMemoryId

  try {
    const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm')
    const ssmClient = new SSMClient({ region: AWS_REGION })
    const paramPath = `/${PROJECT_NAME}/${ENVIRONMENT}/agentcore/memory-id`
    const response = await ssmClient.send(new GetParameterCommand({ Name: paramPath }))
    return response.Parameter?.Value ?? null
  } catch {
    return null
  }
}

async function loadMessages(userId: string, sessionId: string): Promise<any[]> {
  if (userId === 'anonymous' || IS_LOCAL) {
    const { getSessionMessages } = await import('@/lib/local-session-store')
    return getSessionMessages(sessionId)
  }

  const memoryId = await getMemoryId()
  if (!memoryId) {
    const { getSessionMessages } = await import('@/lib/local-session-store')
    return getSessionMessages(sessionId)
  }

  const { BedrockAgentCoreClient, ListEventsCommand } = await import('@aws-sdk/client-bedrock-agentcore')
  const client = new BedrockAgentCoreClient({ region: AWS_REGION })

  let allEvents: any[] = []
  let nextToken: string | undefined
  do {
    const response = await client.send(new ListEventsCommand({
      memoryId,
      sessionId,
      actorId: userId,
      includePayloads: true,
      maxResults: 100,
      nextToken,
    }))
    allEvents.push(...(response.events || []))
    nextToken = response.nextToken
  } while (nextToken)

  const reversedEvents = [...allEvents].reverse()
  const messages: any[] = []

  for (const event of reversedEvents) {
    const payload = event.payload?.[0]
    if (!payload) continue

    if (payload.conversational) {
      const content = payload.conversational.content?.text || ''
      if (!content) continue
      try {
        const parsed = JSON.parse(content)
        if (parsed.agent_id && parsed.state) continue
        if (parsed.message) messages.push(parsed.message)
      } catch { /* skip */ }
    } else if (payload.blob && typeof payload.blob === 'string') {
      try {
        const blobParsed = JSON.parse(payload.blob)
        if (typeof blobParsed === 'object' && blobParsed.agent_id && blobParsed.state) continue
        if (Array.isArray(blobParsed) && blobParsed.length >= 1) {
          const blobMsg = JSON.parse(blobParsed[0])
          if (blobMsg?.message) messages.push(blobMsg.message)
        }
      } catch { /* skip */ }
    }
  }

  return messages
}

function buildTranscript(messages: any[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    const content = Array.isArray(msg.content)
      ? msg.content.filter((c: any) => c.text).map((c: any) => c.text).join('\n')
      : typeof msg.content === 'string' ? msg.content : ''
    if (content.trim()) {
      lines.push(`${role}: ${content.trim()}`)
    }
  }
  return lines.join('\n\n')
}

const MAX_TRANSCRIPT_CHARS = 200_000

/**
 * Truncate transcript to fit within the model's context window.
 * Drops oldest messages first, preserving the most recent context.
 * Returns the trimmed transcript and whether truncation occurred.
 */
function truncateTranscript(messages: any[], maxChars: number): { transcript: string; truncated: boolean } {
  const full = buildTranscript(messages)
  if (full.length <= maxChars) {
    return { transcript: full, truncated: false }
  }

  // Drop messages from the front until it fits
  for (let i = 1; i < messages.length; i++) {
    const trimmed = buildTranscript(messages.slice(i))
    if (trimmed.length <= maxChars) {
      return { transcript: trimmed, truncated: true }
    }
  }

  // Worst case: even the last message is too long — hard-truncate chars from the front
  return { transcript: full.slice(full.length - maxChars), truncated: true }
}

function buildPrompt(transcript: string, truncated: boolean): string {
  const truncationNote = truncated
    ? 'Note: The conversation was very long. The summary below covers the most recent portion.\n\n'
    : ''
  return `You are a helpful assistant. Below is a conversation transcript.
Write a concise but complete summary that captures:
- The main topics discussed
- Key decisions, findings, or outputs
- Any important context needed to continue the work

The summary will be used as the opening message in a new chat session so the assistant can continue seamlessly.
Keep it under 1000 words. Use clear, structured prose.

${truncationNote}Conversation:
${transcript}

Summary:`
}

async function callConverse(client: BedrockRuntimeClient, modelId: string, prompt: string): Promise<string> {
  const response = await client.send(new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 1500 },
  }))
  return response.output?.message?.content?.[0]?.text ?? 'Unable to generate summary.'
}

// Errors that indicate the input is too long
function isContextWindowError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('too long') ||
    msg.includes('context length') ||
    msg.includes('context window') ||
    msg.includes('input is too') ||
    msg.includes('ValidationException') ||
    msg.includes('maximum context')
  )
}

export async function POST(request: NextRequest) {
  try {
    const user = extractUserFromRequest(request)
    const userId = user.userId

    const { oldSessionId, modelId } = await request.json()
    if (!oldSessionId || !modelId) {
      return NextResponse.json(
        { success: false, error: 'oldSessionId and modelId are required' },
        { status: 400 }
      )
    }

    console.log(`[compact/summarize] Generating summary for session ${oldSessionId}`)

    const messages = await loadMessages(userId, oldSessionId)
    console.log(`[compact/summarize] Loaded ${messages.length} messages`)

    if (messages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No messages to summarize' },
        { status: 400 }
      )
    }

    // Pre-emptively truncate to avoid context window errors
    const { transcript, truncated } = truncateTranscript(messages, MAX_TRANSCRIPT_CHARS)
    if (truncated) {
      console.warn(`[compact/summarize] Transcript truncated to ${transcript.length} chars (oldest messages dropped)`)
    }

    const client = new BedrockRuntimeClient({ region: AWS_REGION })
    const prompt = buildPrompt(transcript, truncated)

    let summary: string
    try {
      summary = await callConverse(client, modelId, prompt)
    } catch (firstError) {
      if (!isContextWindowError(firstError)) throw firstError

      // Retry with half the transcript (most recent half)
      console.warn(`[compact/summarize] Context window error, retrying with reduced transcript`)
      const { transcript: shorter, truncated: moreTruncated } = truncateTranscript(
        messages,
        100_000
      )
      const shorterPrompt = buildPrompt(shorter, moreTruncated)
      summary = await callConverse(client, modelId, shorterPrompt)
    }

    console.log(`[compact/summarize] Summary generated (${summary.length} chars)`)

    return NextResponse.json({ success: true, summary })
  } catch (error) {
    console.error('[compact/summarize] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate summary',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
