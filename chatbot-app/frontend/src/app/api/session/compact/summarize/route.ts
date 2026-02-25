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
    ? 'Note: The conversation was very long. Only the most recent portion is included below.\n\n'
    : ''
  return `Your task is to create a detailed, structured summary of the conversation below. This summary will replace the original messages to keep context manageable, so it must capture all essential information needed to continue the work seamlessly.

Before writing your final summary, briefly organize your thoughts inside <analysis> tags:
1. Walk through the conversation chronologically and identify each user request, your response, and the outcome.
2. Note any files, tools, artifacts, or technical details mentioned.
3. Identify what was completed vs. what is still pending.

Then write your summary using the sections below. Omit any section that has no relevant content.

<sections>
1. **Primary Request and Intent**
   What the user explicitly asked for, including follow-up refinements.

2. **Key Decisions and Outcomes**
   Important decisions made, approaches chosen, and results delivered.

3. **Tools and Artifacts**
   Tools invoked (web search, code interpreter, documents, etc.), files created or modified, and key outputs.
   Include file names, artifact titles, or resource identifiers where applicable.

4. **Technical Details**
   Specific technical concepts, configurations, code patterns, or data referenced in the conversation.
   Include enough detail (e.g., parameter values, code snippets, API names) so context is not lost.

5. **Problems Solved**
   Bugs fixed, errors resolved, or troubleshooting steps taken.

6. **Pending Tasks**
   Any unfinished work the user explicitly asked for, or next steps that were agreed upon but not yet completed.

7. **Current Work**
   What was being worked on immediately before this summary, including the most recent user message and assistant action. Be precise — this is the continuation point.
</sections>

Guidelines:
- Be thorough on technical details but concise in prose. Aim for 500–1500 words depending on conversation length.
- Preserve specific names, values, and identifiers — do not generalize them away.
- If the conversation is non-technical (casual Q&A, general knowledge), keep the summary brief and skip technical sections.

${truncationNote}Conversation:
${transcript}

Now produce the summary following the instructions above.`
}

async function callConverse(client: BedrockRuntimeClient, modelId: string, prompt: string): Promise<string> {
  const response = await client.send(new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 4096 },
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
