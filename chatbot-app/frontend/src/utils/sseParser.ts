/**
 * SSE (Server-Sent Events) parsing utilities
 * Extracted for testability from streaming hooks
 */

import type { StreamEvent } from '@/types/events'
import { STREAM_EVENT_TYPES } from '@/types/events'

/**
 * Parse a single SSE line into event type and data
 * SSE format: "event: type\ndata: json\n\n"
 */
export interface SSELine {
  type: 'event' | 'data' | 'comment' | 'retry' | 'empty'
  value: string
}

export function parseSSELine(line: string): SSELine {
  if (line === '') {
    return { type: 'empty', value: '' }
  }

  if (line.startsWith(':')) {
    return { type: 'comment', value: line.slice(1).trim() }
  }

  if (line.startsWith('event:')) {
    return { type: 'event', value: line.slice(6).trim() }
  }

  if (line.startsWith('data:')) {
    return { type: 'data', value: line.slice(5).trim() }
  }

  if (line.startsWith('retry:')) {
    return { type: 'retry', value: line.slice(6).trim() }
  }

  // Unknown line format - treat as data
  return { type: 'data', value: line }
}

/**
 * Parse SSE data into a StreamEvent
 * Returns null if parsing fails
 */
export function parseSSEData(data: string): StreamEvent | null {
  if (!data) {
    return null
  }

  try {
    const parsed = JSON.parse(data)

    // Validate that parsed object has a type
    if (!parsed.type) {
      return null
    }

    return parsed as StreamEvent
  } catch (e) {
    return null
  }
}

/**
 * Parse multiple SSE lines into events
 * Handles the SSE protocol where events are separated by double newlines
 */
export interface ParsedSSEChunk {
  events: StreamEvent[]
  errors: string[]
}

export function parseSSEChunk(chunk: string): ParsedSSEChunk {
  const events: StreamEvent[] = []
  const errors: string[] = []

  // Split by double newlines to get individual SSE messages
  const messages = chunk.split('\n\n').filter(msg => msg.trim() !== '')

  for (const message of messages) {
    const lines = message.split('\n')
    let eventType = ''
    let eventData = ''

    for (const line of lines) {
      const parsed = parseSSELine(line)

      switch (parsed.type) {
        case 'event':
          eventType = parsed.value
          break
        case 'data':
          // SSE allows multiple data lines; concatenate them
          eventData += (eventData ? '\n' : '') + parsed.value
          break
        case 'comment':
        case 'retry':
        case 'empty':
          // Ignore these for event parsing
          break
      }
    }

    if (eventData) {
      const event = parseSSEData(eventData)
      if (event) {
        events.push(event)
      } else {
        errors.push(`Failed to parse SSE data: ${eventData.slice(0, 100)}`)
      }
    }
  }

  return { events, errors }
}

/**
 * Validate a StreamEvent has required fields based on its type
 */
export function validateStreamEvent(event: StreamEvent): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  switch (event.type) {
    case 'reasoning':
      if (typeof event.text !== 'string') {
        errors.push('reasoning event missing "text" field')
      }
      break

    case 'response':
      if (typeof event.text !== 'string') {
        errors.push('response event missing "text" field')
      }
      break

    case 'tool_use':
      if (typeof event.toolUseId !== 'string') {
        errors.push('tool_use event missing "toolUseId" field')
      }
      if (typeof event.name !== 'string') {
        errors.push('tool_use event missing "name" field')
      }
      break

    case 'tool_result':
      if (typeof event.toolUseId !== 'string') {
        errors.push('tool_result event missing "toolUseId" field')
      }
      break

    case 'complete':
      // Complete event has optional fields
      break

    case 'error':
      if (typeof event.message !== 'string') {
        errors.push('error event missing "message" field')
      }
      break

    case 'interrupt':
      if (!Array.isArray(event.interrupts)) {
        errors.push('interrupt event missing "interrupts" array')
      }
      break

    case 'browser_progress':
      if (typeof event.stepNumber !== 'number') {
        errors.push('browser_progress event missing "stepNumber" field')
      }
      if (typeof event.content !== 'string') {
        errors.push('browser_progress event missing "content" field')
      }
      break

    case 'research_progress':
      if (typeof event.stepNumber !== 'number') {
        errors.push('research_progress event missing "stepNumber" field')
      }
      if (typeof event.content !== 'string') {
        errors.push('research_progress event missing "content" field')
      }
      break

    default:
      // Validate against known event types (from STREAM_EVENT_TYPES)
      // Unknown types are allowed but logged for debugging
      if (!STREAM_EVENT_TYPES.includes(event.type as any)) {
        // Don't error, just note it for debugging
        // errors.push(`Unknown event type: ${event.type}`)
      }
      break
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Create a mock StreamEvent for testing purposes
 */
export function createMockEvent<T extends StreamEvent['type']>(
  type: T,
  overrides: Partial<Extract<StreamEvent, { type: T }>> = {}
): Extract<StreamEvent, { type: T }> {
  const defaults: Record<string, any> = {
    reasoning: { type: 'reasoning', text: '', step: 'thinking' },
    response: { type: 'response', text: '', step: 'answering' },
    tool_use: { type: 'tool_use', toolUseId: '', name: '', input: {} },
    tool_result: { type: 'tool_result', toolUseId: '', result: '' },
    init: { type: 'init', message: '' },
    thinking: { type: 'thinking', message: '' },
    complete: { type: 'complete', message: '' },
    error: { type: 'error', message: '' },
    interrupt: { type: 'interrupt', interrupts: [] },
    progress: { type: 'progress' },
    metadata: { type: 'metadata' },
    browser_progress: { type: 'browser_progress', content: '', stepNumber: 0 },
    research_progress: { type: 'research_progress', content: '', stepNumber: 0 }
  }

  return { ...defaults[type], ...overrides } as Extract<StreamEvent, { type: T }>
}

/**
 * Serialize a StreamEvent to SSE format
 */
export function serializeToSSE(event: StreamEvent, eventName?: string): string {
  const lines: string[] = []

  if (eventName) {
    lines.push(`event: ${eventName}`)
  }

  lines.push(`data: ${JSON.stringify(event)}`)
  lines.push('')  // Empty line to end the message
  lines.push('')  // Second empty line for SSE separator

  return lines.join('\n')
}
