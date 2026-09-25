import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = mocks.send },
  ListObjectsV2Command: class { constructor(public input: any) {} },
}))
vi.mock('@/lib/auth-utils', () => ({
  extractUserFromRequest: async () => ({ userId: 'user-one' }),
  getSessionId: () => ({ sessionId: 'chat-one' }),
}))
import { GET } from '@/app/api/workspace/files/route'
const request = (type: string) => ({ nextUrl: new URL(`http://localhost/api/workspace/files?docType=${type}`) }) as any
const workspaceId = createHash('sha256').update('user-one').update('\0').update('chat-one').digest('hex').slice(0, 48)
const canonical = `code-interpreter-workspace/${workspaceId}/artifacts/powerpoint/`
const legacy = 'documents/user-one/chat-one/powerpoint/'
const file = (key: string) => ({ Key: key, Size: 1024, LastModified: new Date('2026-09-13T00:00:00Z') })
beforeEach(() => { mocks.send.mockReset(); vi.stubEnv('ARTIFACT_BUCKET', 'test-bucket') })
it('lists the mounted presentation, deduplicates its legacy copy, and hides drafts and revisions', async () => {
  mocks.send.mockResolvedValueOnce({ Contents: [file(canonical + 'deck.pptx'), file(canonical + '.revisions/old.pptx'), file(canonical + '.draft.pptx')] })
  mocks.send.mockResolvedValueOnce({ Contents: [file(legacy + 'deck.pptx'), file(legacy + 'older.pptx')] })
  const response = await GET(request('powerpoint')); const data = await response.json()
  expect(data.files.map((f: any) => f.filename)).toEqual(['deck.pptx', 'older.pptx'])
  expect(data.files[0].s3_key).toBe(`s3://test-bucket/${canonical}deck.pptx`)
  expect(mocks.send.mock.calls.map(([command]) => command.input.Prefix)).toEqual([canonical, legacy])
})
it('follows continuation pages without omitting later files', async () => {
  const prefix = 'documents/user-one/chat-one/excel/'
  mocks.send.mockResolvedValueOnce({ Contents: [file(prefix + 'first.xlsx')], IsTruncated: true, NextContinuationToken: 'next' })
  mocks.send.mockResolvedValueOnce({ Contents: [file(prefix + 'second.xlsx')] })
  const data = await (await GET(request('excel'))).json()
  expect(data.files).toHaveLength(2)
  expect(mocks.send.mock.calls[1][0].input.ContinuationToken).toBe('next')
})
