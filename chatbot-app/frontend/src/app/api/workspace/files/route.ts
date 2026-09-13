import { NextRequest, NextResponse } from 'next/server'
import { codeInterpreterWorkspaceId } from '@/lib/workspace/s3-repository'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'
import { TOOL_TO_DOC_TYPE, DOC_TYPE_TO_TOOL_TYPE, DocumentType } from '@/config/document-tools'

const region = process.env.AWS_REGION || 'us-west-2'

/**
 * GET /api/workspace/files
 *
 * Lists workspace files for a specific document type.
 *
 * Query params:
 * - toolName: string (tool name to determine document type)
 * - docType: string (optional, direct document type: 'word', 'excel', 'powerpoint')
 *
 * Returns:
 * - files: Array<{ filename, size_kb, last_modified, s3_key }>
 * - docType: string
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const toolName = searchParams.get('toolName')
    const directDocType = searchParams.get('docType')

    // Determine document type from tool name or direct param
    let docType: string | null = directDocType

    if (!docType && toolName) {
      docType = TOOL_TO_DOC_TYPE[toolName] || null
    }

    if (!docType) {
      return NextResponse.json(
        { error: 'Unable to determine document type. Provide toolName or docType.' },
        { status: 400 }
      )
    }

    // Extract user and session
    const user = await extractUserFromRequest(request)
    const userId = user.userId
    const { sessionId } = getSessionId(request, userId)

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    // Get document bucket
    let documentBucket = process.env.ARTIFACT_BUCKET

    if (!documentBucket) {
      try {
        const ssmClient = new SSMClient({ region })
        const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot'
        const environment = process.env.ENVIRONMENT || 'dev'
        const paramName = `/${projectName}/${environment}/agentcore/artifact-bucket`

        const paramResponse = await ssmClient.send(
          new GetParameterCommand({ Name: paramName })
        )

        documentBucket = paramResponse.Parameter?.Value

        if (!documentBucket) {
          throw new Error('Document bucket not configured')
        }
      } catch (error) {
        console.error('[Workspace] Failed to get bucket from Parameter Store:', error)
        return NextResponse.json(
          { error: 'Document bucket not configured' },
          { status: 500 }
        )
      }
    }

    // List files from S3
    const s3Client = new S3Client({ region })
    // PowerPoint publishes into the mounted workspace. Keep legacy documents
    // discoverable too, preferring the current file when both paths exist.
    const prefixes = docType === 'powerpoint'
      ? [
          `code-interpreter-workspace/${codeInterpreterWorkspaceId(userId, sessionId)}/artifacts/powerpoint/`,
          `documents/${userId}/${sessionId}/${docType}/`,
        ]
      : [`documents/${userId}/${sessionId}/${docType}/`]
    const byFilename = new Map<string, {
      filename: string; size_kb: string; last_modified: string; s3_key: string; tool_type: string
    }>()
    for (const prefix of prefixes) {
      let continuationToken: string | undefined
      do {
        const page = await s3Client.send(new ListObjectsV2Command({
          Bucket: documentBucket, Prefix: prefix, ContinuationToken: continuationToken,
        }))
        for (const obj of page.Contents || []) {
          const filename = obj.Key?.slice(prefix.length)
          // Only published files at this level, never draft/revision subfolders.
          if (!filename || filename.startsWith('.') || filename.includes('/') || byFilename.has(filename)
            || obj.Size === undefined || !obj.LastModified) continue
          byFilename.set(filename, {
            filename,
            size_kb: `${(obj.Size / 1024).toFixed(1)} KB`,
            last_modified: obj.LastModified.toISOString(),
            s3_key: `s3://${documentBucket}/${obj.Key}`,
            tool_type: DOC_TYPE_TO_TOOL_TYPE[docType as DocumentType] || 'word_document',
          })
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (continuationToken)
    }
    const files = [...byFilename.values()].sort((a, b) =>
      new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime())

    console.log(`[Workspace] Listed ${files.length} ${docType} file(s) for user=${userId}, session=${sessionId}`)

    return NextResponse.json({
      files,
      docType,
      userId,
      sessionId,
    })
  } catch (error) {
    console.error('[Workspace] Error listing files:', error)
    return NextResponse.json(
      { error: 'Failed to list workspace files' },
      { status: 500 }
    )
  }
}
