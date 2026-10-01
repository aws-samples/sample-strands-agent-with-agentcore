import { describe, expect, it } from 'vitest'

import { DEFAULT_MODEL_ID, normalizeModelId } from '@/lib/model-ids'
describe('model ID normalization', () => {
  it('uses the Bedrock Runtime inference profile as the default', () => {
    expect(DEFAULT_MODEL_ID).toBe('global.anthropic.claude-sonnet-5-5')
  })

  it.each([
    ['us.anthropic.claude-opus-5', 'anthropic.claude-opus-5-5'],
    ['openai.gpt-5.6-sol', 'openai.gpt-6.1-sol'],
    ['us.openai.gpt-5.6-sol', 'openai.gpt-6.1-sol'],
    ['openai.gpt-5.6-terra', 'openai.gpt-6.1-sol'],
    ['us.openai.gpt-5.6-terra', 'openai.gpt-6.1-sol'],
    ['openai.gpt-5.6-luna', 'openai.gpt-6-luna'],
    ['us.openai.gpt-5.6-luna', 'openai.gpt-6-luna'],
    ['us.openai.gpt-6-sol', 'openai.gpt-6.1-sol'],
    ['us.openai.gpt-6-luna', 'openai.gpt-6-luna'],
    ['us.anthropic.claude-opus-5-5', 'anthropic.claude-opus-5-5'],
    ['openai.gpt-6-astra', 'us.openai.gpt-6-astra'],
    ['openai.gpt-6-sol', 'openai.gpt-6.1-sol'],
    ['openai.gpt-6-luna', 'openai.gpt-6-luna'],
    ['xai.grok-4.3', 'us.xai.grok-4.7'],
    ['xai.grok-4.6', 'us.xai.grok-4.7'],
  ])('maps %s to %s', (legacyId, canonicalId) => {
    expect(normalizeModelId(legacyId)).toBe(canonicalId)
  })

  it('preserves current canonical IDs', () => {
    expect(normalizeModelId('us.xai.grok-4.7')).toBe('us.xai.grok-4.7')
    expect(normalizeModelId('global.anthropic.claude-sonnet-5-5'))
      .toBe('global.anthropic.claude-sonnet-5-5')
  })

  it.each([
    ['us.anthropic.claude-sonnet-5', 'global.anthropic.claude-sonnet-5-5'],
    ['moonshotai.kimi-k2.5', 'us.moonshotai.kimi-k3'],
    ['us.xai.grok-4.6', 'us.xai.grok-4.7'],
    ['openai.gpt-6-sol', 'openai.gpt-6.1-sol'],
  ])('migrates saved %s selections', (saved, current) => {
    expect(normalizeModelId(saved)).toBe(current)
  })

  it('restores saved Haiku as the default', () => {
    const haiku = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
    expect(normalizeModelId(haiku)).toBe(DEFAULT_MODEL_ID)
  })

})
