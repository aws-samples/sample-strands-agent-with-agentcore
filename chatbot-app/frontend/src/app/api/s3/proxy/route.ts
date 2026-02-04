import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2'
})

// Content type mapping for Office files
const contentTypeMap: Record<string, string> = {
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'doc': 'application/msword',
  'xls': 'application/vnd.ms-excel',
  'ppt': 'application/vnd.ms-powerpoint',
  'pdf': 'application/pdf',
}

/**
 * Proxy endpoint for S3 files
 * Allows external services (like Office Online) to access S3 files
 * via a publicly accessible URL
 *
 * Usage: GET /api/s3/proxy?key=s3://bucket/path/file.docx
 */
export async function GET(request: NextRequest) {
  try {
    const s3Key = request.nextUrl.searchParams.get('key')

    if (!s3Key) {
      return NextResponse.json(
        { error: 'Missing required parameter: key' },
        { status: 400 }
      )
    }

    // Parse s3://bucket/path format
    const match = s3Key.match(/^s3:\/\/([^\/]+)\/(.+)$/)
    if (!match) {
      return NextResponse.json(
        { error: 'Invalid S3 key format. Expected: s3://bucket/path' },
        { status: 400 }
      )
    }

    const [, bucket, key] = match
    const filename = key.split('/').pop() || 'document'
    const ext = filename.split('.').pop()?.toLowerCase() || ''

    // Generate pre-signed URL
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600
    })

    // Fetch the document from S3
    const response = await fetch(presignedUrl)

    if (!response.ok) {
      console.error('[S3 Proxy] Failed to fetch from S3:', response.status)
      return NextResponse.json(
        { error: 'Failed to fetch document from S3' },
        { status: 502 }
      )
    }

    // Get content type
    const contentType = contentTypeMap[ext] || response.headers.get('content-type') || 'application/octet-stream'

    // Stream the response back
    const blob = await response.blob()

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (error) {
    console.error('[S3 Proxy] Error:', error)
    return NextResponse.json(
      { error: 'Failed to proxy S3 file' },
      { status: 500 }
    )
  }
}
