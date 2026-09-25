import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), write: vi.fn() }))
vi.mock('@/lib/auth-utils', () => ({ extractUserFromRequest: mocks.auth }))
vi.mock('@/lib/artifact-edits', () => ({ writeArtifactEdit: mocks.write }))
import { PUT } from '@/app/api/artifacts/edit/route'
const request = (data: any, session = 'session-1') => new Request('http://localhost/api/artifacts/edit', { method: 'PUT', headers: { 'X-Session-ID': session }, body: JSON.stringify(data) }) as any
const scene = { id: 'diagram-1', baseTimestamp: '2026-09-12T00:00:00Z', content: { elements: [] } }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'user-a' }) })
it('requires a verified user before storing diagram edits', async () => {
  mocks.auth.mockResolvedValue({ userId: 'anonymous' })
  expect((await PUT(request(scene))).status).toBe(401)
  expect(mocks.write).not.toHaveBeenCalled()
})
it('scopes writes to the authenticated user and rejects invalid content', async () => {
  mocks.write.mockResolvedValue({ updatedAt: 'v1' })
  expect((await PUT(request({ ...scene, userId: 'someone-else' }))).status).toBe(200)
  expect(mocks.write.mock.calls[0][0]).toBe('user-a')
  expect((await PUT(request({ ...scene, content: {} }))).status).toBe(400)
  expect((await PUT(request(scene, '../other'))).status).toBe(400)
})
it('reports conflicts instead of overwriting someone else’s edits', async () => {
  mocks.write.mockRejectedValue(new Error('EDIT_CONFLICT'))
  expect((await PUT(request(scene))).status).toBe(409)
})
