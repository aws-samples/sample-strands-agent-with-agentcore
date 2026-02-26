/**
 * Resume SSE stream endpoint (BFF)
 * Replays buffered events from the BFF in-memory execution buffer.
 * Works identically in local and cloud modes.
 */
import { NextRequest } from 'next/server'
import * as executionBuffer from '../../lib/execution-buffer'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const executionId = request.nextUrl.searchParams.get('executionId')
  const cursor = parseInt(request.nextUrl.searchParams.get('cursor') || '0', 10)

  if (!executionId) {
    return new Response(
      JSON.stringify({ error: 'executionId is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const status = executionBuffer.getStatus(executionId)
  if (status === 'not_found') {
    return new Response(
      JSON.stringify({ error: 'Execution not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  console.log(`[Resume] Replaying execution ${executionId} from cursor ${cursor} (status: ${status})`)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const event of executionBuffer.subscribe(executionId, cursor, request.signal)) {
          if (request.signal.aborted) break
          controller.enqueue(encoder.encode(event))
        }
      } catch (error) {
        if (!request.signal.aborted) {
          console.error('[Resume] Error:', error)
        }
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  })
}
