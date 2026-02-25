/**
 * Session Compact - Generate summary from conversation messages
 *
 * Receives the current messages directly from the frontend (no need to
 * re-load from AgentCore Memory, which avoids actorId / payload format issues).
 * Generates a summary via Bedrock Converse.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'

const AWS_REGION = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2'

export const runtime = 'nodejs'

/**
 * Build a plain-text transcript from UI messages.
 * Handles both API format (role/content) and UI format (sender/text).
 */
function buildTranscript(messages: any[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = (msg.role === 'user' || msg.sender === 'user') ? 'User' : 'Assistant'
    const content = Array.isArray(msg.content)
      ? msg.content.filter((c: any) => c.text).map((c: any) => c.text).join('\n')
      : typeof msg.content === 'string' ? msg.content
      : typeof msg.text === 'string' ? msg.text
      : ''
    if (content.trim()) {
      lines.push(`${role}: ${content.trim()}`)
    }
  }
  return lines.join('\n\n')
}

const MAX_TRANSCRIPT_CHARS = 200_000

function truncateTranscript(messages: any[], maxChars: number): { transcript: string; truncated: boolean } {
  const full = buildTranscript(messages)
  if (full.length <= maxChars) {
    return { transcript: full, truncated: false }
  }

  for (let i = 1; i < messages.length; i++) {
    const trimmed = buildTranscript(messages.slice(i))
    if (trimmed.length <= maxChars) {
      return { transcript: trimmed, truncated: true }
    }
  }

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
    const { messages, modelId } = await request.json()

    if (!messages || !Array.isArray(messages) || !modelId) {
      return NextResponse.json(
        { success: false, error: 'messages (array) and modelId are required' },
        { status: 400 }
      )
    }

    // Filter to only user/assistant text messages (skip tool messages)
    const textMessages = messages.filter((msg: any) => {
      const sender = msg.sender || msg.role
      return (sender === 'user' || sender === 'assistant' || sender === 'bot') &&
        !msg.isToolMessage &&
        (msg.text || msg.content)
    })

    if (textMessages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No messages to summarize' },
        { status: 400 }
      )
    }

    console.log(`[compact/summarize] Summarizing ${textMessages.length} messages`)

    const { transcript, truncated } = truncateTranscript(textMessages, MAX_TRANSCRIPT_CHARS)
    if (truncated) {
      console.warn(`[compact/summarize] Transcript truncated to ${transcript.length} chars`)
    }

    const client = new BedrockRuntimeClient({ region: AWS_REGION })
    const prompt = buildPrompt(transcript, truncated)

    let summary: string
    try {
      summary = await callConverse(client, modelId, prompt)
    } catch (firstError) {
      if (!isContextWindowError(firstError)) throw firstError

      console.warn(`[compact/summarize] Context window error, retrying with reduced transcript`)
      const { transcript: shorter, truncated: moreTruncated } = truncateTranscript(textMessages, 100_000)
      summary = await callConverse(client, modelId, buildPrompt(shorter, moreTruncated))
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
