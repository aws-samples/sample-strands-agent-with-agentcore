import assert from 'node:assert/strict'
import test from 'node:test'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, normalizeModelId } from '../src/lib/constants.ts'

test('Haiku is unavailable and saved Haiku selections use Sonnet 5.5', () => {
  const haiku = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
  assert.equal(AVAILABLE_MODELS.some(model => model.id === haiku), false)
  assert.equal(DEFAULT_MODEL_ID, 'global.anthropic.claude-sonnet-5-5')
  assert.equal(normalizeModelId(haiku), DEFAULT_MODEL_ID)
})

test('saved model selections migrate to the current mobile catalog', () => {
  for (const [saved, current] of [
    ['us.anthropic.claude-sonnet-5', 'global.anthropic.claude-sonnet-5-5'],
    ['openai.gpt-6-sol', 'openai.gpt-6.1-sol'],
    ['us.xai.grok-4.6', 'us.xai.grok-4.7'],
    ['moonshotai.kimi-k2.5', 'us.moonshotai.kimi-k3'],
  ]) {
    assert.equal(normalizeModelId(saved), current)
    assert.ok(AVAILABLE_MODELS.some(model => model.id === current))
  }
})

test('current selections are retained and unknown models use the default', () => {
  for (const model of AVAILABLE_MODELS) {
    assert.equal(normalizeModelId(model.id), model.id)
  }
  assert.equal(normalizeModelId('retired-model'), DEFAULT_MODEL_ID)
})
