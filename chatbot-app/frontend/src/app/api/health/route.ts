/**
 * Health check endpoint
 */
import { NextResponse } from 'next/server'

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'bff',
    version: VERSION
  })
}
