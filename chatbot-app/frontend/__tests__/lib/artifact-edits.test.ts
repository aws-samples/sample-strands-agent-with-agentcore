import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
vi.mock('@/lib/workspace/s3-repository', async importOriginal => ({ ...await importOriginal<any>(), getWorkspaceBucket: async () => 'test-bucket' }))
import { mergeArtifactEdits, writeArtifactEdit } from '@/lib/artifact-edits'

const objects = new Map<string, { Body: string; etag: string }>()
const send = vi.spyOn(S3Client.prototype, 'send')
const base = { id: 'diagram-a', type: 'excalidraw', updated_at: '2026-09-12T01:00:00Z', content: { elements: [{ text: 'Original' }] } }
const edit = { id: base.id, baseTimestamp: base.updated_at, content: { elements: [{ text: 'Manual note' }] } }
beforeEach(() => {
  objects.clear()
  send.mockImplementation(async (command: any) => {
    const input = command.input
    const prior = objects.get(input.Key)
    if (command instanceof GetObjectCommand) {
      if (!prior) throw Object.assign(new Error(), { name: 'NoSuchKey' })
      return { Body: { transformToString: async () => prior.Body }, ETag: prior.etag }
    }
    if (command instanceof PutObjectCommand) {
      if ((input.IfMatch && input.IfMatch !== prior?.etag) || (input.IfNoneMatch && prior)) throw Object.assign(new Error(), { $metadata: { httpStatusCode: 412 } })
      objects.set(input.Key, { Body: input.Body, etag: `etag-${objects.size}-${input.Body.length}` })
      return {}
    }
    throw new Error('Unexpected command')
  })
})
describe('durable diagram edits', () => {
  it('restores a saved scene in history and isolates it by user and session', async () => {
    await writeArtifactEdit('user-a', 'session-a', edit)
    expect((await mergeArtifactEdits('user-a', 'session-a', [base]))[0].content).toEqual(edit.content)
    expect((await mergeArtifactEdits('user-b', 'session-a', [base]))[0].content).toEqual(base.content)
    expect((await mergeArtifactEdits('user-a', 'session-b', [base]))[0].content).toEqual(base.content)
  })
  it('rejects stale edits and does not overlay a later agent revision', async () => {
    const saved = await writeArtifactEdit('user-a', 'session-a', edit)
    await expect(writeArtifactEdit('user-a', 'session-a', edit)).rejects.toThrow('EDIT_CONFLICT')
    await expect(writeArtifactEdit('user-a', 'session-a', { ...edit, version: saved.updatedAt })).resolves.toBeTruthy()
    const revised = { ...base, updated_at: '2026-09-12T02:00:00Z' }
    expect((await mergeArtifactEdits('user-a', 'session-a', [revised]))[0].content).toEqual(base.content)
  })
})
