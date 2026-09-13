import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { writeArtifactEdit } from '@/lib/artifact-edits'

export async function PUT(request: NextRequest) {
  const user = await extractUserFromRequest(request)
  if (user.userId === 'anonymous') return NextResponse.json({ error: 'Sign in to save changes.' }, { status: 401 })
  const sessionId = request.headers.get('X-Session-ID') || ''
  const raw = await request.text()
  if (raw.length > 2_000_000) return NextResponse.json({ error: 'Diagram is too large to save.' }, { status: 413 })
  try {
    const body = JSON.parse(raw)
    if (!/^[\w-]+$/.test(sessionId) || typeof body.id !== 'string' || body.id.length > 512 ||
        !Number.isFinite(Date.parse(body.baseTimestamp)) || !Array.isArray(body.content?.elements) ||
        body.content.elements.length > 10000) {
      return NextResponse.json({ error: 'Invalid diagram.' }, { status: 400 })
    }
    const edit = await writeArtifactEdit(user.userId, sessionId, body)
    return NextResponse.json({ version: edit.updatedAt })
  } catch (error: any) {
    const conflict = error.message === 'EDIT_CONFLICT' || error.$metadata?.httpStatusCode === 412
    return NextResponse.json({ error: conflict ? 'This diagram was edited elsewhere. Export your changes before reloading.' : 'Changes could not be saved. Please retry.' }, { status: conflict ? 409 : 500 })
  }
}
