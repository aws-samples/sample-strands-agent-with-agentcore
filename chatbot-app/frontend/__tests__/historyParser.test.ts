import { describe, it, expect } from 'vitest'
import {
  parseConversationalEvent,
  parseBlobEvent,
  parseAgentCoreEvent,
  parseAgentCoreEvents,
  mergeMessageMetadata,
  AgentCoreEvent,
  ParsedMessage
} from '@/utils/historyParser'

describe('historyParser', () => {
  describe('parseConversationalEvent', () => {
    it('should parse valid conversational event', () => {
      const event: AgentCoreEvent = {
        eventId: 'evt-123',
        eventTime: '2024-01-01T12:00:00Z',
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({
                message: {
                  role: 'user',
                  content: [{ text: 'Hello' }]
                }
              })
            }
          }
        }]
      }

      const result = parseConversationalEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message).toEqual({
        role: 'user',
        content: [{ text: 'Hello' }],
        id: 'evt-123',
        timestamp: '2024-01-01T12:00:00Z'
      })
    })

    it('should generate id from sessionId and index when eventId missing', () => {
      const event: AgentCoreEvent = {
        eventTime: '2024-01-01T12:00:00Z',
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({ message: { role: 'user', content: [] } })
            }
          }
        }]
      }

      const result = parseConversationalEvent(event, 'session-abc', 5)

      expect(result.success).toBe(true)
      expect(result.message?.id).toBe('msg-session-abc-5')
    })

    it('should use current time when eventTime missing', () => {
      const event: AgentCoreEvent = {
        eventId: 'evt-123',
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({ message: { role: 'user', content: [] } })
            }
          }
        }]
      }

      const before = new Date().toISOString()
      const result = parseConversationalEvent(event, 'session-1', 0)
      const after = new Date().toISOString()

      expect(result.success).toBe(true)
      expect(result.message).toBeDefined()
      const timestamp = result.message!.timestamp
      expect(timestamp >= before).toBe(true)
      expect(timestamp <= after).toBe(true)
    })

    it('should fail for non-conversational event', () => {
      const event: AgentCoreEvent = {
        payload: [{ blob: 'something' }]
      }

      const result = parseConversationalEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a conversational event')
    })

    it('should fail for empty conversational content', () => {
      const event: AgentCoreEvent = {
        payload: [{
          conversational: {
            content: { text: '' }
          }
        }]
      }

      const result = parseConversationalEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Empty conversational content')
    })

    it('should fail for invalid JSON in content', () => {
      const event: AgentCoreEvent = {
        payload: [{
          conversational: {
            content: { text: '{invalid json' }
          }
        }]
      }

      const result = parseConversationalEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid JSON')
    })

    it('should fail when "message" key is missing', () => {
      const event: AgentCoreEvent = {
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({ data: 'something' })
            }
          }
        }]
      }

      const result = parseConversationalEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Missing "message" key in parsed content')
    })

    it('should preserve additional fields in message', () => {
      const event: AgentCoreEvent = {
        eventId: 'evt-123',
        eventTime: '2024-01-01T12:00:00Z',
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({
                message: {
                  role: 'assistant',
                  content: [{ text: 'Hi' }],
                  customField: 'customValue',
                  toolCalls: [{ id: 'tool-1' }]
                }
              })
            }
          }
        }]
      }

      const result = parseConversationalEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message?.customField).toBe('customValue')
      expect(result.message?.toolCalls).toEqual([{ id: 'tool-1' }])
    })
  })

  describe('parseBlobEvent', () => {
    it('should parse valid blob event with tuple format', () => {
      const messageData = {
        message: {
          role: 'assistant',
          content: [{ text: 'This is a very long message...' }]
        }
      }

      const event: AgentCoreEvent = {
        eventId: 'evt-456',
        eventTime: '2024-01-02T12:00:00Z',
        payload: [{
          blob: JSON.stringify([JSON.stringify(messageData), 'assistant'])
        }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message).toEqual({
        role: 'assistant',
        content: [{ text: 'This is a very long message...' }],
        id: 'evt-456',
        timestamp: '2024-01-02T12:00:00Z'
      })
    })

    it('should fail for non-blob event', () => {
      const event: AgentCoreEvent = {
        payload: [{
          conversational: { content: { text: 'something' } }
        }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a valid blob event')
    })

    it('should fail when blob is not a string', () => {
      const event: AgentCoreEvent = {
        payload: [{
          blob: { not: 'a string' } as any
        }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a valid blob event')
    })

    it('should fail for invalid JSON in blob', () => {
      const event: AgentCoreEvent = {
        payload: [{ blob: '{not valid json' }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid JSON in blob')
    })

    it('should fail when blob is not a tuple array', () => {
      const event: AgentCoreEvent = {
        payload: [{ blob: JSON.stringify({ not: 'an array' }) }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Blob is not in expected tuple format')
    })

    it('should fail for empty tuple array', () => {
      const event: AgentCoreEvent = {
        payload: [{ blob: JSON.stringify([]) }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Blob is not in expected tuple format')
    })

    it('should fail for invalid JSON in tuple first element', () => {
      const event: AgentCoreEvent = {
        payload: [{
          blob: JSON.stringify(['{invalid json}', 'user'])
        }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid JSON in blob tuple')
    })

    it('should fail when "message" key missing in blob data', () => {
      const event: AgentCoreEvent = {
        payload: [{
          blob: JSON.stringify([JSON.stringify({ data: 'something' }), 'user'])
        }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Missing "message" key in blob data')
    })

    it('should handle blob with only one tuple element', () => {
      const messageData = {
        message: { role: 'user', content: [{ text: 'Hello' }] }
      }

      const event: AgentCoreEvent = {
        eventId: 'evt-789',
        eventTime: '2024-01-03T12:00:00Z',
        payload: [{
          blob: JSON.stringify([JSON.stringify(messageData)])
        }]
      }

      const result = parseBlobEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message?.role).toBe('user')
    })
  })

  describe('parseAgentCoreEvent', () => {
    it('should parse conversational event', () => {
      const event: AgentCoreEvent = {
        eventId: 'evt-1',
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({ message: { role: 'user', content: [] } })
            }
          }
        }]
      }

      const result = parseAgentCoreEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message?.role).toBe('user')
    })

    it('should parse blob event', () => {
      const event: AgentCoreEvent = {
        eventId: 'evt-2',
        payload: [{
          blob: JSON.stringify([
            JSON.stringify({ message: { role: 'assistant', content: [] } }),
            'assistant'
          ])
        }]
      }

      const result = parseAgentCoreEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message?.role).toBe('assistant')
    })

    it('should fail for event without payload', () => {
      const event: AgentCoreEvent = {}

      const result = parseAgentCoreEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('No payload in event')
    })

    it('should fail for event with empty payload', () => {
      const event: AgentCoreEvent = { payload: [] }

      const result = parseAgentCoreEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('No payload in event')
    })

    it('should fail for event with neither conversational nor blob', () => {
      const event: AgentCoreEvent = {
        payload: [{ someOtherField: 'value' } as any]
      }

      const result = parseAgentCoreEvent(event, 'session-1', 0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Event has neither conversational nor blob payload')
    })

    it('should prioritize conversational over blob if both present', () => {
      const event: AgentCoreEvent = {
        eventId: 'evt-3',
        payload: [{
          conversational: {
            content: {
              text: JSON.stringify({ message: { role: 'user', content: [{ text: 'conv' }] } })
            }
          },
          blob: JSON.stringify([
            JSON.stringify({ message: { role: 'assistant', content: [{ text: 'blob' }] } }),
            'assistant'
          ])
        }]
      }

      const result = parseAgentCoreEvent(event, 'session-1', 0)

      expect(result.success).toBe(true)
      expect(result.message?.role).toBe('user')
      expect(result.message?.content[0].text).toBe('conv')
    })
  })

  describe('parseAgentCoreEvents', () => {
    it('should parse multiple events', () => {
      const events: AgentCoreEvent[] = [
        {
          eventId: 'evt-1',
          eventTime: '2024-01-01T12:00:00Z',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({ message: { role: 'user', content: [{ text: 'Hello' }] } })
              }
            }
          }]
        },
        {
          eventId: 'evt-2',
          eventTime: '2024-01-01T12:00:01Z',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({ message: { role: 'assistant', content: [{ text: 'Hi there' }] } })
              }
            }
          }]
        }
      ]

      const messages = parseAgentCoreEvents(events, 'session-1')

      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('user')
      expect(messages[0].id).toBe('evt-1')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].id).toBe('evt-2')
    })

    it('should skip invalid events and continue parsing', () => {
      const events: AgentCoreEvent[] = [
        {
          eventId: 'evt-1',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({ message: { role: 'user', content: [] } })
              }
            }
          }]
        },
        {
          eventId: 'evt-invalid',
          payload: [{ invalid: 'data' } as any]
        },
        {
          eventId: 'evt-3',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({ message: { role: 'assistant', content: [] } })
              }
            }
          }]
        }
      ]

      const messages = parseAgentCoreEvents(events, 'session-1')

      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe('evt-1')
      expect(messages[1].id).toBe('evt-3')
    })

    it('should return empty array for empty events', () => {
      const messages = parseAgentCoreEvents([], 'session-1')
      expect(messages).toEqual([])
    })

    it('should handle mixed conversational and blob events', () => {
      const events: AgentCoreEvent[] = [
        {
          eventId: 'evt-conv',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({ message: { role: 'user', content: [{ text: 'Short' }] } })
              }
            }
          }]
        },
        {
          eventId: 'evt-blob',
          payload: [{
            blob: JSON.stringify([
              JSON.stringify({ message: { role: 'assistant', content: [{ text: 'Very long...' }] } }),
              'assistant'
            ])
          }]
        }
      ]

      const messages = parseAgentCoreEvents(events, 'session-1')

      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe('evt-conv')
      expect(messages[1].id).toBe('evt-blob')
    })
  })

  describe('mergeMessageMetadata', () => {
    it('should return messages unchanged when no metadata', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'user', content: [], timestamp: '2024-01-01' }
      ]

      const result = mergeMessageMetadata(messages, null)

      expect(result).toEqual(messages)
    })

    it('should return messages unchanged when metadata.messages is missing', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'user', content: [], timestamp: '2024-01-01' }
      ]

      const result = mergeMessageMetadata(messages, {})

      expect(result).toEqual(messages)
    })

    it('should merge latency metadata', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'assistant', content: [], timestamp: '2024-01-01' }
      ]

      const metadata = {
        messages: {
          'msg-1': {
            latency: { timeToFirstToken: 100, endToEndLatency: 500 }
          }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].latencyMetrics).toEqual({
        timeToFirstToken: 100,
        endToEndLatency: 500
      })
    })

    it('should merge token usage metadata', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'assistant', content: [], timestamp: '2024-01-01' }
      ]

      const metadata = {
        messages: {
          'msg-1': {
            tokenUsage: { inputTokens: 100, outputTokens: 200 }
          }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 200
      })
    })

    it('should merge feedback metadata', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'assistant', content: [], timestamp: '2024-01-01' }
      ]

      const metadata = {
        messages: {
          'msg-1': {
            feedback: { rating: 'positive', comment: 'Great response!' }
          }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].feedback).toEqual({
        rating: 'positive',
        comment: 'Great response!'
      })
    })

    it('should merge documents metadata', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'assistant', content: [], timestamp: '2024-01-01' }
      ]

      const metadata = {
        messages: {
          'msg-1': {
            documents: [{ name: 'report.docx', s3Key: 'path/to/file' }]
          }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].documents).toEqual([
        { name: 'report.docx', s3Key: 'path/to/file' }
      ])
    })

    it('should merge multiple metadata fields', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'assistant', content: [], timestamp: '2024-01-01' }
      ]

      const metadata = {
        messages: {
          'msg-1': {
            latency: { timeToFirstToken: 100 },
            tokenUsage: { inputTokens: 50 },
            feedback: { rating: 'positive' },
            documents: [{ name: 'file.pdf' }]
          }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].latencyMetrics).toEqual({ timeToFirstToken: 100 })
      expect(result[0].tokenUsage).toEqual({ inputTokens: 50 })
      expect(result[0].feedback).toEqual({ rating: 'positive' })
      expect(result[0].documents).toEqual([{ name: 'file.pdf' }])
    })

    it('should only merge metadata for matching message ids', () => {
      const messages: ParsedMessage[] = [
        { id: 'msg-1', role: 'user', content: [], timestamp: '2024-01-01' },
        { id: 'msg-2', role: 'assistant', content: [], timestamp: '2024-01-02' }
      ]

      const metadata = {
        messages: {
          'msg-2': { latency: { timeToFirstToken: 200 } }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].latencyMetrics).toBeUndefined()
      expect(result[1].latencyMetrics).toEqual({ timeToFirstToken: 200 })
    })

    it('should preserve existing message properties', () => {
      const messages: ParsedMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: [{ text: 'Hello' }],
          timestamp: '2024-01-01',
          customField: 'custom'
        }
      ]

      const metadata = {
        messages: {
          'msg-1': { latency: { timeToFirstToken: 100 } }
        }
      }

      const result = mergeMessageMetadata(messages, metadata)

      expect(result[0].customField).toBe('custom')
      expect(result[0].content).toEqual([{ text: 'Hello' }])
    })
  })

  // ============================================================
  // Edge Case Tests
  // ============================================================
  describe('Edge Cases', () => {
    describe('Large Content Handling', () => {
      it('should handle very long message content (9000+ chars)', () => {
        const longText = 'A'.repeat(10000)
        const messageData = {
          message: {
            role: 'assistant',
            content: [{ text: longText }]
          }
        }

        const event: AgentCoreEvent = {
          eventId: 'evt-long',
          eventTime: '2024-01-01T12:00:00Z',
          payload: [{
            blob: JSON.stringify([JSON.stringify(messageData), 'assistant'])
          }]
        }

        const result = parseBlobEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content[0].text.length).toBe(10000)
      })

      it('should handle message with many content blocks', () => {
        const manyBlocks = Array.from({ length: 50 }, (_, i) => ({
          text: `Block ${i + 1}`
        }))

        const event: AgentCoreEvent = {
          eventId: 'evt-many',
          eventTime: '2024-01-01T12:00:00Z',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: { role: 'assistant', content: manyBlocks }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content).toHaveLength(50)
      })
    })

    describe('Special Characters', () => {
      it('should handle unicode in content', () => {
        const event: AgentCoreEvent = {
          eventId: 'evt-unicode',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: {
                    role: 'user',
                    content: [{ text: 'Hello in many languages: cafe, resume, naive' }]
                  }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content[0].text).toContain('cafe')
      })

      it('should handle escaped JSON in content', () => {
        const event: AgentCoreEvent = {
          eventId: 'evt-escaped',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: {
                    role: 'assistant',
                    content: [{ text: 'Code: {"key": "value"}' }]
                  }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content[0].text).toContain('{"key": "value"}')
      })

      it('should handle newlines and tabs in content', () => {
        const event: AgentCoreEvent = {
          eventId: 'evt-whitespace',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: {
                    role: 'assistant',
                    content: [{ text: 'Line 1\nLine 2\tTabbed' }]
                  }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content[0].text).toContain('\n')
        expect(result.message?.content[0].text).toContain('\t')
      })
    })

    describe('Complex Message Structures', () => {
      it('should handle tool use content blocks', () => {
        const event: AgentCoreEvent = {
          eventId: 'evt-tool',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: {
                    role: 'assistant',
                    content: [
                      { text: 'Let me search for that.' },
                      {
                        toolUse: {
                          toolUseId: 'tool-123',
                          name: 'web_search',
                          input: { query: 'test query' }
                        }
                      }
                    ]
                  }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content).toHaveLength(2)
        expect(result.message?.content[1].toolUse.name).toBe('web_search')
      })

      it('should handle tool result content blocks', () => {
        const event: AgentCoreEvent = {
          eventId: 'evt-toolresult',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: {
                    role: 'user',
                    content: [{
                      toolResult: {
                        toolUseId: 'tool-123',
                        content: [{ text: 'Search results...' }],
                        status: 'success'
                      }
                    }]
                  }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content[0].toolResult.status).toBe('success')
      })

      it('should handle image content blocks', () => {
        const event: AgentCoreEvent = {
          eventId: 'evt-image',
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: {
                    role: 'user',
                    content: [
                      { text: 'What is in this image?' },
                      {
                        image: {
                          format: 'png',
                          source: { base64: 'iVBORw0KGgo...' }
                        }
                      }
                    ]
                  }
                })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(true)
        expect(result.message?.content[1].image.format).toBe('png')
      })
    })

    describe('Malformed Data Handling', () => {
      it('should handle null payload array element', () => {
        const event: AgentCoreEvent = {
          payload: [null as any]
        }

        const result = parseAgentCoreEvent(event, 'session-1', 0)

        expect(result.success).toBe(false)
        expect(result.error).toBe('No payload in event')
      })

      it('should handle undefined content text', () => {
        const event: AgentCoreEvent = {
          payload: [{
            conversational: {
              content: { text: undefined as any }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Empty conversational content')
      })

      it('should handle null message in parsed content', () => {
        const event: AgentCoreEvent = {
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({ message: null })
              }
            }
          }]
        }

        const result = parseConversationalEvent(event, 'session-1', 0)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Missing "message" key in parsed content')
      })

      it('should handle deeply nested invalid structure', () => {
        const event: AgentCoreEvent = {
          payload: [{
            blob: JSON.stringify([
              JSON.stringify({
                message: {
                  role: 'assistant',
                  content: [{ invalid: { nested: { deep: 'value' } } }]
                }
              }),
              'assistant'
            ])
          }]
        }

        const result = parseBlobEvent(event, 'session-1', 0)

        // Should still parse - content structure is not validated
        expect(result.success).toBe(true)
      })
    })

    describe('Index Management', () => {
      it('should increment index correctly across multiple valid events', () => {
        const events: AgentCoreEvent[] = Array.from({ length: 5 }, (_, i) => ({
          payload: [{
            conversational: {
              content: {
                text: JSON.stringify({
                  message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [] }
                })
              }
            }
          }]
        }))

        const messages = parseAgentCoreEvents(events, 'session-1')

        expect(messages).toHaveLength(5)
        messages.forEach((msg, idx) => {
          expect(msg.id).toBe(`msg-session-1-${idx}`)
        })
      })

      it('should not increment index for failed events', () => {
        const events: AgentCoreEvent[] = [
          {
            payload: [{
              conversational: {
                content: {
                  text: JSON.stringify({ message: { role: 'user', content: [] } })
                }
              }
            }]
          },
          { payload: [{ invalid: 'data' } as any] }, // Will fail
          {
            payload: [{
              conversational: {
                content: {
                  text: JSON.stringify({ message: { role: 'assistant', content: [] } })
                }
              }
            }]
          }
        ]

        const messages = parseAgentCoreEvents(events, 'session-1')

        expect(messages).toHaveLength(2)
        expect(messages[0].id).toBe('msg-session-1-0')
        expect(messages[1].id).toBe('msg-session-1-1') // Index continues from valid messages only
      })
    })
  })
})
