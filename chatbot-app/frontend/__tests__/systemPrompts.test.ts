import { describe, it, expect } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT, getSystemPrompt } from '@/lib/system-prompts'

/**
 * Tests for System Prompts
 *
 * The system uses a single default prompt which is dynamically
 * enhanced with tool-specific guidance in the backend.
 */

describe('System Prompts', () => {
  describe('DEFAULT_SYSTEM_PROMPT', () => {
    it('should contain tool capability guidance', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('dynamic tool capabilities')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('ONLY use tools that are explicitly provided')
    })

    it('should contain key guidelines', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Key guidelines')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Break down complex tasks')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('explain your reasoning')
    })

    it('should have goal statement', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('helpful, accurate, and efficient')
    })
  })

  describe('getSystemPrompt', () => {
    it('should return the default system prompt', () => {
      const prompt = getSystemPrompt()
      expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT)
    })

    it('should return non-empty string', () => {
      const prompt = getSystemPrompt()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(0)
    })
  })
})
