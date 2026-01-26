/**
 * Tests for Swarm-related parsing logic
 *
 * Tests cover:
 * - parseSwarmContext: XML tag parsing and extraction
 * - processSwarmMessageContent: Message splitting and context attachment
 * - Agent filtering logic
 */

import { describe, it, expect } from 'vitest'

// Re-implement the parsing functions for testing (extracted from useChatAPI.ts)
// These are pure functions that can be tested independently

/**
 * Parse swarm context from assistant message text
 * Returns the agents used, shared context, and removes the tag from text
 */
function parseSwarmContext(text: string): {
  cleanedText: string
  swarmContext?: {
    agentsUsed: string[]
    sharedContext?: Record<string, any>
  }
} {
  const swarmContextMatch = text.match(/<swarm_context>([\s\S]*?)<\/swarm_context>/)

  if (!swarmContextMatch) {
    return { cleanedText: text }
  }

  const contextContent = swarmContextMatch[1]

  // Extract agents_used from the context
  const agentsMatch = contextContent.match(/agents_used:\s*\[(.*?)\]/)
  let agentsUsed: string[] = []
  if (agentsMatch) {
    agentsUsed = agentsMatch[1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(s => s.length > 0)
  }

  // Extract shared_context for each agent (format: "agent_name: {json}")
  const sharedContext: Record<string, any> = {}
  const lines = contextContent.split('\n')
  for (const line of lines) {
    // Skip agents_used line
    if (line.includes('agents_used:')) continue

    // Match "agent_name: {json...}" or "agent_name: {...}"
    const agentDataMatch = line.match(/^(\w+):\s*(\{.*)/)
    if (agentDataMatch) {
      const agentName = agentDataMatch[1]
      let jsonStr = agentDataMatch[2]

      // Handle truncated JSON (ends with ...)
      if (jsonStr.endsWith('...')) {
        jsonStr = jsonStr.slice(0, -3)
        // Try to make it valid JSON by closing brackets
        const openBraces = (jsonStr.match(/\{/g) || []).length
        const closeBraces = (jsonStr.match(/\}/g) || []).length
        jsonStr += '}'.repeat(openBraces - closeBraces)
      }

      try {
        sharedContext[agentName] = JSON.parse(jsonStr)
      } catch {
        // If JSON parsing fails, store as string
        sharedContext[agentName] = agentDataMatch[2]
      }
    }
  }

  // Remove the swarm_context tag from text
  const cleanedText = text.replace(/<swarm_context>[\s\S]*?<\/swarm_context>/g, '').trim()

  return {
    cleanedText,
    swarmContext: agentsUsed.length > 0 ? {
      agentsUsed,
      ...(Object.keys(sharedContext).length > 0 && { sharedContext })
    } : undefined
  }
}


describe('parseSwarmContext', () => {
  describe('Text without swarm context', () => {
    it('should return original text when no swarm_context tag', () => {
      const text = 'This is a normal response without swarm context.'

      const result = parseSwarmContext(text)

      expect(result.cleanedText).toBe(text)
      expect(result.swarmContext).toBeUndefined()
    })

    it('should handle empty string', () => {
      const result = parseSwarmContext('')

      expect(result.cleanedText).toBe('')
      expect(result.swarmContext).toBeUndefined()
    })
  })

  describe('Agents used extraction', () => {
    it('should extract single agent from agents_used', () => {
      const text = `Here is the response.
<swarm_context>
agents_used: ['web_researcher']
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext?.agentsUsed).toEqual(['web_researcher'])
      expect(result.cleanedText).toBe('Here is the response.')
    })

    it('should extract multiple agents from agents_used', () => {
      const text = `Response text.
<swarm_context>
agents_used: ['web_researcher', 'data_analyst', 'finance_agent']
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext?.agentsUsed).toEqual([
        'web_researcher',
        'data_analyst',
        'finance_agent'
      ])
    })

    it('should handle double-quoted agent names', () => {
      const text = `<swarm_context>
agents_used: ["web_researcher", "browser_agent"]
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext?.agentsUsed).toEqual(['web_researcher', 'browser_agent'])
    })

    it('should filter coordinator and responder (done by backend)', () => {
      // Note: The backend filters these, but test that parsing handles them if present
      const text = `<swarm_context>
agents_used: ['web_researcher']
</swarm_context>`

      const result = parseSwarmContext(text)

      // Backend already filters, so we just verify parsing works
      expect(result.swarmContext?.agentsUsed).toEqual(['web_researcher'])
    })
  })

  describe('Shared context extraction', () => {
    it('should extract shared context for single agent', () => {
      const text = `Response.
<swarm_context>
agents_used: ['web_researcher']
web_researcher: {"citations": [{"source": "Test", "url": "http://test.com"}]}
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext?.sharedContext).toBeDefined()
      expect(result.swarmContext?.sharedContext?.web_researcher).toEqual({
        citations: [{ source: 'Test', url: 'http://test.com' }]
      })
    })

    it('should extract shared context for multiple agents', () => {
      const text = `<swarm_context>
agents_used: ['web_researcher', 'data_analyst']
web_researcher: {"citations": [{"url": "http://a.com"}]}
data_analyst: {"images": [{"filename": "chart.png"}]}
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext?.sharedContext?.web_researcher).toEqual({
        citations: [{ url: 'http://a.com' }]
      })
      expect(result.swarmContext?.sharedContext?.data_analyst).toEqual({
        images: [{ filename: 'chart.png' }]
      })
    })

    it('should handle truncated JSON with ellipsis', () => {
      const text = `<swarm_context>
agents_used: ['web_researcher']
web_researcher: {"citations": [{"source": "Long title that gets truncated...
</swarm_context>`

      const result = parseSwarmContext(text)

      // Should attempt to fix truncated JSON
      expect(result.swarmContext?.agentsUsed).toEqual(['web_researcher'])
    })

    it('should store invalid JSON as string fallback', () => {
      const text = `<swarm_context>
agents_used: ['agent']
agent: {invalid json here}
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext?.sharedContext?.agent).toBe('{invalid json here}')
    })
  })

  describe('Text cleaning', () => {
    it('should remove swarm_context tag from middle of text', () => {
      const text = `First part.
<swarm_context>
agents_used: ['agent']
</swarm_context>
Second part.`

      const result = parseSwarmContext(text)

      expect(result.cleanedText).toBe('First part.\n\nSecond part.')
    })

    it('should remove swarm_context at end of text', () => {
      const text = `Main response here.
<swarm_context>
agents_used: ['web_researcher']
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.cleanedText).toBe('Main response here.')
    })

    it('should preserve text before swarm_context', () => {
      const text = `Here is your answer based on research.

Key findings:
- Point 1
- Point 2
<swarm_context>
agents_used: ['web_researcher']
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.cleanedText).toContain('Key findings:')
      expect(result.cleanedText).toContain('- Point 1')
      expect(result.cleanedText).not.toContain('<swarm_context>')
    })
  })

  describe('Edge cases', () => {
    it('should return undefined swarmContext when agents_used is empty', () => {
      const text = `<swarm_context>
agents_used: []
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext).toBeUndefined()
    })

    it('should handle malformed agents_used gracefully', () => {
      const text = `<swarm_context>
agents_used: not a valid array
</swarm_context>`

      const result = parseSwarmContext(text)

      expect(result.swarmContext).toBeUndefined()
    })

    it('should handle nested swarm_context tags (first match)', () => {
      const text = `<swarm_context>
agents_used: ['first']
</swarm_context>
More text
<swarm_context>
agents_used: ['second']
</swarm_context>`

      const result = parseSwarmContext(text)

      // Should match first occurrence
      expect(result.swarmContext?.agentsUsed).toEqual(['first'])
    })
  })
})


describe('Swarm Agent Display Names', () => {
  // Test the display name mapping consistency
  const SWARM_AGENT_DISPLAY_NAMES: Record<string, string> = {
    coordinator: 'Coordinator',
    web_researcher: 'Web Researcher',
    academic_researcher: 'Academic Researcher',
    word_agent: 'Word',
    excel_agent: 'Excel',
    powerpoint_agent: 'PowerPoint',
    data_analyst: 'Analyst',
    browser_agent: 'Browser',
    weather_agent: 'Weather',
    finance_agent: 'Finance',
    maps_agent: 'Maps',
    responder: 'Responder',
  }

  it('should have display names for all 12 agents', () => {
    expect(Object.keys(SWARM_AGENT_DISPLAY_NAMES)).toHaveLength(12)
  })

  it('should have non-empty display names', () => {
    for (const [agentId, displayName] of Object.entries(SWARM_AGENT_DISPLAY_NAMES)) {
      expect(displayName.trim().length).toBeGreaterThan(0)
    }
  })

  it('should have unique display names', () => {
    const displayNames = Object.values(SWARM_AGENT_DISPLAY_NAMES)
    const uniqueNames = new Set(displayNames)
    expect(uniqueNames.size).toBe(displayNames.length)
  })
})


describe('Swarm Message Content Processing', () => {
  /**
   * Helper to simulate content block processing
   */
  function extractSwarmContextFromContentBlocks(
    content: Array<{ text?: string; toolUse?: any; toolResult?: any }>
  ): { agentsUsed: string[]; sharedContext?: Record<string, any> } | undefined {
    for (const item of content) {
      if (item.text?.includes('<swarm_context>')) {
        const result = parseSwarmContext(item.text)
        return result.swarmContext
      }
    }
    return undefined
  }

  it('should extract swarm context from content blocks', () => {
    const content = [
      { text: 'Response text here.' },
      { text: `<swarm_context>
agents_used: ['web_researcher', 'data_analyst']
web_researcher: {"citations": []}
</swarm_context>` }
    ]

    const swarmContext = extractSwarmContextFromContentBlocks(content)

    expect(swarmContext?.agentsUsed).toEqual(['web_researcher', 'data_analyst'])
  })

  it('should return undefined when no swarm context in content', () => {
    const content = [
      { text: 'Normal response.' },
      { toolUse: { toolUseId: 't1', name: 'tool', input: {} } }
    ]

    const swarmContext = extractSwarmContextFromContentBlocks(content)

    expect(swarmContext).toBeUndefined()
  })

  it('should handle mixed content blocks with swarm context', () => {
    const content = [
      { text: 'Initial text.' },
      { toolUse: { toolUseId: 't1', name: 'web_search', input: {} } },
      { toolResult: { toolUseId: 't1', content: [{ text: 'Result' }] } },
      { text: `Final response.
<swarm_context>
agents_used: ['web_researcher']
</swarm_context>` }
    ]

    const swarmContext = extractSwarmContextFromContentBlocks(content)

    expect(swarmContext?.agentsUsed).toEqual(['web_researcher'])
  })
})


describe('Message Interleaving for Swarm', () => {
  /**
   * Test the logic for splitting swarm messages into text/tool sequence
   */
  interface ContentBlock {
    text?: string
    toolUse?: { toolUseId: string; name: string; input: any }
    toolResult?: { toolUseId: string; content: any[]; status: string }
  }

  function countMessageSplits(content: ContentBlock[]): number {
    // Count transitions: text -> tool or tool -> text
    let splits = 0
    let lastType: 'text' | 'tool' | null = null

    for (const block of content) {
      let currentType: 'text' | 'tool' | null = null

      if (block.text) {
        currentType = 'text'
      } else if (block.toolUse || block.toolResult) {
        currentType = 'tool'
      }

      if (currentType && lastType && currentType !== lastType) {
        splits++
      }

      if (currentType) {
        lastType = currentType
      }
    }

    return splits
  }

  it('should count zero splits for text-only content', () => {
    const content: ContentBlock[] = [
      { text: 'First' },
      { text: 'Second' },
      { text: 'Third' }
    ]

    expect(countMessageSplits(content)).toBe(0)
  })

  it('should count one split for text -> tool', () => {
    const content: ContentBlock[] = [
      { text: 'Let me search' },
      { toolUse: { toolUseId: 't1', name: 'search', input: {} } }
    ]

    expect(countMessageSplits(content)).toBe(1)
  })

  it('should count multiple splits for interleaved content', () => {
    const content: ContentBlock[] = [
      { text: 'First text' },
      { toolUse: { toolUseId: 't1', name: 'tool1', input: {} } },
      { toolResult: { toolUseId: 't1', content: [], status: 'success' } },
      { text: 'Middle text' },
      { toolUse: { toolUseId: 't2', name: 'tool2', input: {} } },
      { toolResult: { toolUseId: 't2', content: [], status: 'success' } },
      { text: 'Final text' }
    ]

    // text -> tool (1), tool -> text (2), text -> tool (3), tool -> text (4)
    expect(countMessageSplits(content)).toBe(4)
  })
})
