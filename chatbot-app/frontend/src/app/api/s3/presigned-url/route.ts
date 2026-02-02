import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2'
})

export async function POST(request: NextRequest) {
  try {
    const { s3Key } = await request.json()

    if (!s3Key || typeof s3Key !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: s3Key is required' },
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

    // Generate pre-signed URL (expires in 1 hour)
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: 3600  // 1 hour
    })

    return NextResponse.json({ url })

  } catch (error) {
    console.error('[S3] Error generating pre-signed URL:', error)
    return NextResponse.json(
      { error: 'Failed to generate pre-signed URL' },
      { status: 500 }
    )
  }
}
