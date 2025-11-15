/**
 * Health check endpoint
 */
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'bff',
    version: '2.0.0'
  })
}
