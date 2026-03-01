import type { AGUIEvent } from '../types/events'

export type SSEEventHandler = (event: AGUIEvent) => void

/**
 * Reads a fetch ReadableStream and dispatches parsed AG-UI SSE events.
 *
 * The BFF emits lines in the format:  data: <JSON>\n\n
 * Keep-alive comments (: keep-alive) and event: lines are ignored.
 * Returns when the stream ends or the AbortSignal fires.
 */
export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: SSEEventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process all complete lines (split on \n, keep last partial line)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trimEnd()

        // Skip empty lines and keep-alive comments
        if (!trimmed || trimmed.startsWith(':')) continue

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6)
          if (!jsonStr || jsonStr === '[DONE]') continue
          try {
            const event = JSON.parse(jsonStr) as AGUIEvent
            onEvent(event)
          } catch {
            // Silently skip malformed JSON lines
          }
        }
        // Ignore `event: <name>` lines — we use type field inside data JSON
      }
    }

    // Flush any remaining partial line
    if (buffer.trimEnd().startsWith('data: ')) {
      const jsonStr = buffer.trimEnd().slice(6)
      if (jsonStr && jsonStr !== '[DONE]') {
        try {
          const event = JSON.parse(jsonStr) as AGUIEvent
          onEvent(event)
        } catch {
          // ignore
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // reader already released
    }
  }
}
