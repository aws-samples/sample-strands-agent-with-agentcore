import { beforeEach, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ getSession: vi.fn(), upsertSession: vi.fn() }))
vi.mock('@/lib/dynamodb-client', () => store)

it('persists model selection before generation starts and keeps unrelated metadata', async () => {
  vi.stubEnv('NEXT_PUBLIC_AGENTCORE_LOCAL', 'false')
  store.getSession.mockResolvedValue({ title: 'My chat', messageCount: 2, metadata: { custom: 'keep' } })
  const { sessionMetadataHook } = await import('@/lib/chat-hooks')
  const result = await sessionMetadataHook.execute({ userId: 'user', sessionId: 'session', message: 'Hello', modelConfig: { model_id: 'openai.gpt-6-sol', temperature: 0.3, system_prompt: '', caching_enabled: false }, metadata: { skillsEnabled: true } })
  expect(result.success).toBe(true)
  expect(store.upsertSession).toHaveBeenCalledWith('user', 'session', expect.objectContaining({ metadata: { custom: 'keep', lastModel: 'openai.gpt-6-sol', lastTemperature: 0.3, skillsEnabled: true } }))
})
