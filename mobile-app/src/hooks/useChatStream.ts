import { useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ImagePickerAsset } from 'expo-image-picker'
import { connectSSEStream, type SSEClientHandle } from '../lib/sse-client'
import { apiPost } from '../lib/api-client'
import { ENDPOINTS, DEFAULT_MODEL_ID, DEFAULT_TEMPERATURE } from '../lib/constants'
import type { SSEEventHandler } from '../lib/sse-parser'
import type { RunAgentInput, Message, PickedDocument } from '../types/chat'

export interface UseChatStreamOptions {
  sessionId: string
  modelId?: string
  onEvent: SSEEventHandler
  onError: (err: string) => void
  onComplete: () => void
}

/**
 * Manages the lifecycle of a single SSE streaming connection to the BFF.
 * Supports both JSON (text-only) and FormData (with images) request paths.
 */
export function useChatStream({
  sessionId,
  modelId,
  onEvent,
  onError,
  onComplete,
}: UseChatStreamOptions) {
  const handleRef = useRef<SSEClientHandle | null>(null)

  const sendMessage = useCallback(
    (userText: string, history: Message[], images?: ImagePickerAsset[], documents?: PickedDocument[]) => {
      // Abort any lingering previous stream
      handleRef.current?.abort()

      // Build message content — multimodal when images/docs are attached.
      // AG-UI only supports 'text' and 'binary' content types.
      type ContentPart =
        | { type: 'text'; text: string }
        | { type: 'binary'; mimeType: string; data: string; filename: string }

      const hasAttachments = (images && images.length > 0) || (documents && documents.length > 0)
      let messageContent: string | ContentPart[]
      if (hasAttachments) {
        const parts: ContentPart[] = [{ type: 'text', text: userText }]
        for (const asset of images ?? []) {
          if (asset.base64) {
            parts.push({
              type: 'binary',
              mimeType: asset.mimeType ?? 'image/jpeg',
              data: asset.base64,
              filename: asset.fileName ?? 'image.jpg',
            })
          }
        }
        for (const doc of documents ?? []) {
          parts.push({
            type: 'binary',
            mimeType: doc.mimeType,
            data: doc.base64,
            filename: doc.name,
          })
        }
        messageContent = parts
      } else {
        messageContent = userText
      }

      // Always use the JSON AG-UI path (supports both text and multimodal).
      // history already contains the new user message as last item;
      // replace its content with multimodal content when images are attached.
      const messagesForBFF = history.map((m, idx) => {
        const isLastUserMsg = m.role === 'user' && idx === history.length - 1
        return {
          id: m.id,
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: (isLastUserMsg ? messageContent : m.text) as string,
        }
      })

      const body: RunAgentInput = {
        threadId: sessionId,
        runId: uuidv4(),
        messages: messagesForBFF,
        tools: [],
        context: [],
        state: {
          model_id: modelId ?? DEFAULT_MODEL_ID,
          temperature: DEFAULT_TEMPERATURE,
          request_type: 'skill',
          system_prompt: '',
          selected_artifact_id: null,
          enabled_tools: [],
        },
      }

      handleRef.current = connectSSEStream({
        path: ENDPOINTS.chat,
        body,
        extraHeaders: { 'X-Session-ID': sessionId },
        onEvent,
        onComplete,
        onError: (err: Error) => onError(err.message),
        maxRetries: 3,
        retryBaseDelayMs: 1000,
      })
    },
    [sessionId, modelId, onEvent, onError, onComplete],
  )

  /** Abort the local SSE connection only (no server-side stop). */
  const abortStream = useCallback(() => {
    handleRef.current?.abort()
    handleRef.current = null
  }, [])

  /** Abort local SSE + send stop signal to server. */
  const stopStream = useCallback(async () => {
    abortStream()
    try {
      await apiPost(ENDPOINTS.stop, { sessionId })
    } catch {
      // Best-effort; the local stream is already aborted
    }
  }, [sessionId, abortStream])

  const completeElicitation = useCallback(
    async (elicitationId?: string) => {
      await apiPost(ENDPOINTS.elicitationComplete, { sessionId, elicitationId })
    },
    [sessionId],
  )

  const getIsStreaming = useCallback(() => handleRef.current?.active ?? false, [])

  return { sendMessage, stopStream, abortStream, completeElicitation, getIsStreaming }
}
