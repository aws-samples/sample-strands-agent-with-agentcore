/**
 * Stream tools endpoint (temporary mock for Phase 1 testing)
 * Returns SSE stream of tool events
 */
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send initial tools list as SSE event
      const event = {
        type: 'tools_list',
        data: {
          tools: [],
          mcp_servers: []
        }
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
      ...(sessionId && { 'X-Session-ID': sessionId })
    }
  })
}
