import { describe, it, expect } from 'vitest'
import {
  parseSSELine,
  parseSSEData,
  parseSSEChunk,
  validateStreamEvent,
  createMockEvent,
  serializeToSSE
} from '@/utils/sseParser'
import type { StreamEvent } from '@/types/events'
import { EventType } from '@ag-ui/core'

describe('sseParser', () => {
  describe('parseSSELine', () => {
    it('should parse empty line', () => {
      const result = parseSSELine('')
      expect(result).toEqual({ type: 'empty', value: '' })
    })

    it('should parse comment line', () => {
      const result = parseSSELine(': this is a comment')
      expect(result).toEqual({ type: 'comment', value: 'this is a comment' })
    })

    it('should parse event line', () => {
      const result = parseSSELine('event: message')
      expect(result).toEqual({ type: 'event', value: 'message' })
    })

    it('should parse event line with extra whitespace', () => {
      const result = parseSSELine('event:   response  ')
      expect(result).toEqual({ type: 'event', value: 'response' })
    })

    it('should parse data line', () => {
      const result = parseSSELine('data: {"type":"response","text":"Hello"}')
      expect(result).toEqual({
        type: 'data',
        value: '{"type":"response","text":"Hello"}'
      })
    })

    it('should parse retry line', () => {
      const result = parseSSELine('retry: 3000')
      expect(result).toEqual({ type: 'retry', value: '3000' })
    })

    it('should treat unknown format as data', () => {
      const result = parseSSELine('some unknown format')
      expect(result).toEqual({ type: 'data', value: 'some unknown format' })
    })
  })

  describe('parseSSEData', () => {
    it('should return null for empty data', () => {
      expect(parseSSEData('')).toBeNull()
    })

    it('should parse valid JSON with type field', () => {
      const result = parseSSEData('{"type":"response","text":"Hello"}')
      expect(result).toEqual({ type: 'response', text: 'Hello' })
    })

    it('should return null for invalid JSON', () => {
      expect(parseSSEData('{invalid json}')).toBeNull()
    })

    it('should return null for JSON without type field', () => {
      expect(parseSSEData('{"data":"something"}')).toBeNull()
    })

    it('should parse complex event data', () => {
      const data = JSON.stringify({
        type: 'tool_use',
        toolUseId: 'tool-123',
        name: 'calculator',
        input: { expression: '2 + 2' }
      })

      const result = parseSSEData(data)
      expect(result).toEqual({
        type: 'tool_use',
        toolUseId: 'tool-123',
        name: 'calculator',
        input: { expression: '2 + 2' }
      })
    })
  })

  describe('parseSSEChunk', () => {
    it('should parse single event', () => {
      const chunk = 'data: {"type":"response","text":"Hi"}\n\n'

      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toEqual({ type: 'response', text: 'Hi' })
      expect(result.errors).toHaveLength(0)
    })

    it('should parse multiple events', () => {
      const chunk = [
        'data: {"type":"init","message":"Starting"}',
        '',
        'data: {"type":"response","text":"Hello"}',
        '',
        'data: {"type":"complete","message":"Done"}',
        ''
      ].join('\n')

      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(3)
      expect(result.events[0].type).toBe('init')
      expect(result.events[1].type).toBe('response')
      expect(result.events[2].type).toBe('complete')
    })

    it('should handle event type line followed by data', () => {
      const chunk = 'event: message\ndata: {"type":"response","text":"Hi"}\n\n'

      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('response')
    })

    it('should concatenate multiple data lines', () => {
      // SSE spec allows multiple data lines - they get concatenated with newlines
      // Our parser concatenates them, but the resulting string has a newline in the middle
      // which can make JSON parsing succeed if the split happens at valid JSON boundaries
      const chunk = [
        'data: {"type":"response",',
        'data: "text":"Hello World"}',
        ''
      ].join('\n')

      const result = parseSSEChunk(chunk)

      // The parser concatenates: '{"type":"response",\n"text":"Hello World"}'
      // JSON.parse handles newlines in strings, so this actually parses successfully
      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('response')
      expect((result.events[0] as any).text).toBe('Hello World')
    })

    it('should collect errors for invalid events', () => {
      const chunk = [
        'data: {"type":"response","text":"Valid"}',
        '',
        'data: {invalid json}',
        '',
        'data: {"type":"complete","message":"Done"}',
        ''
      ].join('\n')

      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(2)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Failed to parse SSE data')
    })

    it('should ignore comment lines', () => {
      const chunk = [
        ': this is a comment',
        'data: {"type":"response","text":"Hi"}',
        ''
      ].join('\n')

      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('response')
    })

    it('should handle empty chunk', () => {
      const result = parseSSEChunk('')

      expect(result.events).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle chunk with only whitespace', () => {
      const result = parseSSEChunk('  \n\n  ')

      expect(result.events).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validateStreamEvent', () => {
    it('should validate RUN_STARTED event', () => {
      const valid = { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1' } as unknown as StreamEvent
      const missingThreadId = { type: EventType.RUN_STARTED, runId: 'run-1' } as unknown as StreamEvent

      expect(validateStreamEvent(valid).valid).toBe(true)
      expect(validateStreamEvent(missingThreadId).valid).toBe(false)
      expect(validateStreamEvent(missingThreadId).errors[0]).toContain('threadId')
    })

    it('should validate RUN_ERROR event', () => {
      const valid = { type: EventType.RUN_ERROR, message: 'Something went wrong' } as unknown as StreamEvent
      const invalid = { type: EventType.RUN_ERROR } as unknown as StreamEvent

      expect(validateStreamEvent(valid).valid).toBe(true)
      expect(validateStreamEvent(invalid).valid).toBe(false)
    })

    it('should validate TEXT_MESSAGE_CONTENT event', () => {
      const valid = { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'msg-1', delta: 'Hello' } as unknown as StreamEvent
      const missingDelta = { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'msg-1' } as unknown as StreamEvent

      expect(validateStreamEvent(valid).valid).toBe(true)
      expect(validateStreamEvent(missingDelta).valid).toBe(false)
      expect(validateStreamEvent(missingDelta).errors[0]).toContain('delta')
    })

    it('should validate TOOL_CALL_START event', () => {
      const valid = { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'calculator' } as unknown as StreamEvent
      const missingName = { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1' } as unknown as StreamEvent

      expect(validateStreamEvent(valid).valid).toBe(true)
      expect(validateStreamEvent(missingName).valid).toBe(false)
      expect(validateStreamEvent(missingName).errors[0]).toContain('toolCallName')
    })

    it('should validate TOOL_CALL_RESULT event', () => {
      const valid = { type: EventType.TOOL_CALL_RESULT, toolCallId: 'tc-1', messageId: 'msg-1', content: 'result' } as unknown as StreamEvent
      const invalid = { type: EventType.TOOL_CALL_RESULT, messageId: 'msg-1', content: 'result' } as unknown as StreamEvent

      expect(validateStreamEvent(valid).valid).toBe(true)
      expect(validateStreamEvent(invalid).valid).toBe(false)
    })

    it('should validate CUSTOM event', () => {
      const valid = { type: EventType.CUSTOM, name: 'reasoning', value: {} } as unknown as StreamEvent
      const missingName = { type: EventType.CUSTOM, value: {} } as unknown as StreamEvent

      expect(validateStreamEvent(valid).valid).toBe(true)
      expect(validateStreamEvent(missingName).valid).toBe(false)
      expect(validateStreamEvent(missingName).errors[0]).toContain('name')
    })

    it('should allow unknown event types for forward compatibility', () => {
      const unknown = { type: 'unknown_type' } as unknown as StreamEvent

      const result = validateStreamEvent(unknown)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should allow legacy custom event types (passed via CUSTOM channel)', () => {
      // Legacy types like 'reasoning', 'interrupt' etc. fall through to default (valid)
      expect(validateStreamEvent({ type: 'reasoning' } as unknown as StreamEvent).valid).toBe(true)
      expect(validateStreamEvent({ type: 'init' } as unknown as StreamEvent).valid).toBe(true)
      expect(validateStreamEvent({ type: 'complete' } as unknown as StreamEvent).valid).toBe(true)
    })
  })

  describe('createMockEvent', () => {
    it('should create reasoning event with defaults', () => {
      const event = createMockEvent('reasoning')
      expect(event.type).toBe('reasoning')
      expect(event.text).toBe('')
      expect(event.step).toBe('thinking')
    })

    it('should create reasoning event with overrides', () => {
      const event = createMockEvent('reasoning', { text: 'Analyzing...' })
      expect(event.text).toBe('Analyzing...')
    })

    it('should create response event', () => {
      const event = createMockEvent('response', { text: 'Hello!' })
      expect(event.type).toBe('response')
      expect(event.text).toBe('Hello!')
    })

    it('should create tool_use event', () => {
      const event = createMockEvent('tool_use', {
        toolUseId: 'tool-abc',
        name: 'search',
        input: { query: 'test' }
      })
      expect(event.type).toBe('tool_use')
      expect(event.toolUseId).toBe('tool-abc')
      expect(event.name).toBe('search')
      expect(event.input).toEqual({ query: 'test' })
    })

    it('should create complete event with usage', () => {
      const event = createMockEvent('complete', {
        message: 'Done',
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300
        }
      })
      expect(event.type).toBe('complete')
      expect(event.usage).toEqual({
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300
      })
    })

    it('should create browser_progress event', () => {
      const event = createMockEvent('browser_progress', {
        stepNumber: 3,
        content: 'Filling form'
      })
      expect(event.type).toBe('browser_progress')
      expect(event.stepNumber).toBe(3)
      expect(event.content).toBe('Filling form')
    })
  })

  describe('serializeToSSE', () => {
    it('should serialize event without event name', () => {
      const event = { type: 'response', text: 'Hello' } as unknown as StreamEvent
      const result = serializeToSSE(event)

      expect(result).toBe('data: {"type":"response","text":"Hello"}\n\n')
    })

    it('should serialize event with event name', () => {
      const event = { type: 'response', text: 'Hello' } as unknown as StreamEvent
      const result = serializeToSSE(event, 'message')

      expect(result).toBe('event: message\ndata: {"type":"response","text":"Hello"}\n\n')
    })

    it('should handle complex event data', () => {
      const event = {
        type: 'tool_result',
        toolUseId: 'tool-123',
        result: 'success',
        images: [{ format: 'png', data: 'base64...' }]
      } as unknown as StreamEvent

      const result = serializeToSSE(event)
      const parsed = parseSSEChunk(result)

      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0]).toEqual(event)
    })

    it('should create parseable SSE format', () => {
      const event = createMockEvent('complete', { message: 'All done!' })
      const serialized = serializeToSSE(event)
      const { events } = parseSSEChunk(serialized)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('complete')
      expect((events[0] as any).message).toBe('All done!')
    })
  })

  // ============================================================
  // Interrupt Event Parsing Tests
  // ============================================================

  describe('interrupt event parsing', () => {
    it('should parse research approval interrupt event', () => {
      const chunk = `data: {"type":"interrupt","interrupts":[{"id":"chatbot-research-001","name":"chatbot-research-approval","reason":{"tool_name":"research_agent","plan":"Step 1: Search\\nStep 2: Analyze"}}]}\n\n`

      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('interrupt')

      const interruptEvent = result.events[0] as any
      expect(interruptEvent.interrupts).toHaveLength(1)
      expect(interruptEvent.interrupts[0].id).toBe('chatbot-research-001')
      expect(interruptEvent.interrupts[0].name).toBe('chatbot-research-approval')
    })

    it('should parse browser approval interrupt event', () => {
      const interruptData = {
        type: 'interrupt',
        interrupts: [{
          id: 'chatbot-browser-001',
          name: 'chatbot-browser-approval',
          reason: {
            tool_name: 'browser_use_agent',
            task: 'Navigate to Amazon and search for headphones',
            max_steps: 15
          }
        }]
      }

      const chunk = `data: ${JSON.stringify(interruptData)}\n\n`
      const result = parseSSEChunk(chunk)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('interrupt')

      const event = result.events[0] as any
      expect(event.interrupts[0].name).toBe('chatbot-browser-approval')
      expect(event.interrupts[0].reason.max_steps).toBe(15)
    })

    it('should allow legacy interrupt event (falls through to default, always valid)', () => {
      // interrupt is a legacy/custom type — validator allows all unknown types
      const missingInterrupts = { type: 'interrupt' } as unknown as StreamEvent
      const withInterrupts = {
        type: 'interrupt',
        interrupts: [{ id: 'int-1', name: 'chatbot-research-approval' }]
      } as unknown as StreamEvent

      expect(validateStreamEvent(missingInterrupts).valid).toBe(true)
      expect(validateStreamEvent(withInterrupts).valid).toBe(true)
    })

    it('should create mock interrupt event', () => {
      const event = createMockEvent('interrupt', {
        interrupts: [{
          id: 'mock-interrupt-001',
          name: 'chatbot-research-approval',
          reason: { plan: 'Test plan' }
        }]
      })

      expect(event.type).toBe('interrupt')
      expect((event as any).interrupts).toHaveLength(1)
      expect((event as any).interrupts[0].id).toBe('mock-interrupt-001')
    })

    it('should serialize and parse interrupt event correctly', () => {
      const originalEvent = {
        type: 'interrupt',
        interrupts: [{
          id: 'roundtrip-001',
          name: 'chatbot-research-approval',
          reason: {
            tool_name: 'research_agent',
            plan: 'Step 1: Do this\nStep 2: Do that'
          }
        }]
      } as unknown as StreamEvent

      const serialized = serializeToSSE(originalEvent)
      const { events, errors } = parseSSEChunk(serialized)

      expect(errors).toHaveLength(0)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('interrupt')

      const parsed = events[0] as any
      expect(parsed.interrupts[0].id).toBe('roundtrip-001')
      expect(parsed.interrupts[0].reason.plan).toContain('Step 1')
    })

    it('should handle interrupt in streaming conversation flow', () => {
      // Simulate: init -> thinking -> tool_use -> interrupt (HITL pause)
      const events = [
        `data: {"type":"init","message":"Starting agent"}\n\n`,
        `data: {"type":"thinking","message":"Processing request"}\n\n`,
        `data: {"type":"tool_use","toolUseId":"tool-001","name":"research_agent","input":{"topic":"AI trends"}}\n\n`,
        `data: {"type":"interrupt","interrupts":[{"id":"int-001","name":"chatbot-research-approval","reason":{"plan":"Research AI trends"}}]}\n\n`
      ].join('')

      const result = parseSSEChunk(events)

      expect(result.events).toHaveLength(4)
      expect(result.events[0].type).toBe('init')
      expect(result.events[1].type).toBe('thinking')
      expect(result.events[2].type).toBe('tool_use')
      expect(result.events[3].type).toBe('interrupt')

      // After interrupt, no complete event (waiting for user response)
    })

    it('should handle post-approval continuation flow', () => {
      // Simulate: After approval, agent continues
      // tool_result -> response -> complete
      const events = [
        `data: {"type":"tool_result","toolUseId":"tool-001","result":"Research completed successfully"}\n\n`,
        `data: {"type":"response","text":"Here are the AI trends I found...","step":"answering"}\n\n`,
        `data: {"type":"complete","message":"Done","usage":{"inputTokens":100,"outputTokens":200,"totalTokens":300}}\n\n`
      ].join('')

      const result = parseSSEChunk(events)

      expect(result.events).toHaveLength(3)
      expect(result.events[0].type).toBe('tool_result')
      expect(result.events[1].type).toBe('response')
      expect(result.events[2].type).toBe('complete')
    })
  })

  describe('round-trip parsing', () => {
    it('should handle full streaming conversation simulation', () => {
      const events: StreamEvent[] = [
        createMockEvent('init', { message: 'Starting' }),
        createMockEvent('thinking', { message: 'Processing' }),
        createMockEvent('reasoning', { text: 'Let me think...' }),
        createMockEvent('tool_use', {
          toolUseId: 'tool-1',
          name: 'calculator',
          input: { expression: '2+2' }
        }),
        createMockEvent('tool_result', {
          toolUseId: 'tool-1',
          result: '4'
        }),
        createMockEvent('response', { text: 'The answer is 4' }),
        createMockEvent('complete', {
          message: 'Done',
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }
        })
      ]

      // Serialize all events
      const sseStream = events.map(e => serializeToSSE(e)).join('')

      // Parse them back
      const { events: parsed, errors } = parseSSEChunk(sseStream)

      expect(errors).toHaveLength(0)
      expect(parsed).toHaveLength(events.length)

      // Verify each event
      parsed.forEach((parsedEvent, i) => {
        expect(parsedEvent.type).toBe(events[i].type)
      })
    })
  })
})
