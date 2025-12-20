import { NextRequest, NextResponse } from 'next/server'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'

const region = process.env.AWS_REGION || 'us-west-2'

/**
 * POST /api/documents/download
 *
 * Reconstructs S3 key from sessionId and filename, returns it for frontend to fetch presigned URL.
 *
 * Request body:
 * - sessionId: string (chat session ID)
 * - filename: string (document filename)
 * - toolType: string (e.g., 'word_document')
 *
 * Returns:
 * - s3Key: string (s3://bucket/path format for presigned URL generation)
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, filename, toolType } = await request.json()

    if (!sessionId || !filename || !toolType) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, filename, toolType' },
        { status: 400 }
      )
    }

    // Determine userId from sessionId format
    // For anonymous users: sessionId starts with 'anon' → userId = 'anonymous'
    // For authenticated users: sessionId starts with user's Cognito sub → userId = that sub
    const userId = sessionId.startsWith('anon') ? 'anonymous' : sessionId.split('_')[0]

    // Get document bucket from environment or Parameter Store
    let documentBucket = process.env.DOCUMENT_BUCKET

    if (!documentBucket) {
      // Try Parameter Store
      try {
        const ssmClient = new SSMClient({ region })
        const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot'
        const environment = process.env.ENVIRONMENT || 'dev'
        const paramName = `/${projectName}/${environment}/agentcore/document-bucket`

        const paramResponse = await ssmClient.send(
          new GetParameterCommand({ Name: paramName })
        )

        documentBucket = paramResponse.Parameter?.Value

        if (!documentBucket) {
          throw new Error('Document bucket not configured')
        }
      } catch (error) {
        console.error('[DocumentDownload] Failed to get bucket from Parameter Store:', error)
        return NextResponse.json(
          { error: 'Document bucket not configured' },
          { status: 500 }
        )
      }
    }

    // Reconstruct S3 path based on tool type
    let s3Key: string
    if (toolType === 'word_document') {
      s3Key = `s3://${documentBucket}/documents/${userId}/${sessionId}/word/${filename}`
    } else {
      // Future: support other document types
      s3Key = `s3://${documentBucket}/documents/${userId}/${sessionId}/${toolType}/${filename}`
    }

    console.log(`[DocumentDownload] Reconstructed S3 key: ${s3Key}`)

    return NextResponse.json({ s3Key })
  } catch (error) {
    console.error('[DocumentDownload] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate download path' },
      { status: 500 }
    )
  }
}
