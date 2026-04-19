/**
 * Composer Client - Document composition API client
 *
 * Uses the standard chat API with workflow_type="compose"
 */

import { fetchAuthSession } from 'aws-amplify/auth'

/**
 * Get Authorization header with Cognito JWT token
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession()
    const token = session.tokens?.accessToken?.toString()
    if (token) {
      return { 'Authorization': `Bearer ${token}` }
    }
  } catch {
    // Not authenticated (local dev or anonymous)
  }
  return {}
}

export interface ComposeStartParams {
  sessionId: string
  message: string
  modelId?: string
  temperature?: number
}

export interface ComposeConfirmParams {
  sessionId: string
  approved: boolean
  feedback?: string
  specificChanges?: string[]
}

export interface ComposeEvent {
  type: string
  [key: string]: any
}

export type ComposeEventHandler = (event: ComposeEvent) => void

/**
 * Start document composition workflow
 */
export async function startComposition(
  params: ComposeStartParams,
  onEvent: ComposeEventHandler
): Promise<void> {
  const authHeaders = await getAuthHeaders()

  const response = await fetch('/api/stream/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': params.sessionId,  // Pass session ID in header for BFF
      ...authHeaders,  // Include JWT token for user identification
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      message: params.message,
      model_id: params.modelId,
      temperature: params.temperature,
      request_type: 'compose',  // Request type: compose workflow
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to start composition: ${response.status}`)
  }

  await processSSEStream(response, onEvent)
}

/**
 * Confirm or reject outline
 */
export async function confirmOutline(
  params: ComposeConfirmParams,
  onEvent: ComposeEventHandler
): Promise<void> {
  const authHeaders = await getAuthHeaders()

  // Send outline confirmation as JSON message with workflow_type
  const confirmMessage = JSON.stringify({
    approved: params.approved,
    feedback: params.feedback,
    specific_changes: params.specificChanges || [],
  })

  const response = await fetch('/api/stream/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': params.sessionId,  // Pass session ID in header for BFF
      ...authHeaders,  // Include JWT token for user identification
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      message: confirmMessage,
      request_type: 'compose',  // Request type: compose workflow
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to confirm outline: ${response.status}`)
  }

  await processSSEStream(response, onEvent)
}

/**
 * Process SSE stream from backend
 */
async function processSSEStream(
  response: Response,
  onEvent: ComposeEventHandler
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim()
          if (!dataStr || dataStr === '[DONE]') continue

          try {
            const event = JSON.parse(dataStr) as ComposeEvent
            onEvent(event)
          } catch (e) {
            console.error('Failed to parse SSE event:', dataStr, e)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
