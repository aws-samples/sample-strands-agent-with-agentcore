import { createHash } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { codeInterpreterWorkspaceId, getWorkspaceBucket } from './workspace/s3-repository'

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' })
const keyFor = (userId: string, sessionId: string, artifactId: string) => {
  if (!/^[\w-]+$/.test(sessionId) || !artifactId || artifactId.length > 512) throw new Error('Invalid artifact identity')
  const id = createHash('sha256').update(artifactId).digest('hex')
  return `code-interpreter-workspace/${codeInterpreterWorkspaceId(userId, sessionId)}/.metadata/diagram-edits/${id}.json`
}
export async function readArtifactEdit(userId: string, sessionId: string, id: string) {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: await getWorkspaceBucket(), Key: keyFor(userId, sessionId, id) }))
    return { edit: JSON.parse(await result.Body!.transformToString()), etag: result.ETag }
  } catch (error: any) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null
    throw error
  }
}
export async function writeArtifactEdit(userId: string, sessionId: string, body: any) {
  const current = await readArtifactEdit(userId, sessionId, body.id)
  const newerBase = current && Date.parse(body.baseTimestamp) > Date.parse(current.edit.baseTimestamp)
  if (!newerBase && (current?.edit.updatedAt || null) !== (body.version || null)) throw new Error('EDIT_CONFLICT')
  const edit = { id: body.id, baseTimestamp: body.baseTimestamp, content: body.content, updatedAt: new Date().toISOString() }
  await s3.send(new PutObjectCommand({
    Bucket: await getWorkspaceBucket(), Key: keyFor(userId, sessionId, body.id),
    Body: JSON.stringify(edit), ContentType: 'application/json',
    ...(current?.etag ? { IfMatch: current.etag } : { IfNoneMatch: '*' }),
  }))
  return edit
}
export async function mergeArtifactEdits(userId: string, sessionId: string, artifacts: any[]) {
  return Promise.all(artifacts.map(async artifact => {
    if (artifact.type !== 'excalidraw') return artifact
    const saved = await readArtifactEdit(userId, sessionId, artifact.id)
    const timestamp = artifact.updated_at || artifact.timestamp || artifact.created_at
    if (!saved || Date.parse(saved.edit.baseTimestamp) !== Date.parse(timestamp)) return artifact
    return { ...artifact, content: saved.edit.content, metadata: { ...artifact.metadata, editVersion: saved.edit.updatedAt, manuallyEdited: true } }
  }))
}
