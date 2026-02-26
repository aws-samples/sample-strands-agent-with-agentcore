/**
 * Execution status endpoint (BFF)
 * Checks the in-memory execution buffer for status.
 * Works identically in local and cloud modes.
 */
import { NextRequest, NextResponse } from 'next/server'
import * as executionBuffer from '../../lib/execution-buffer'

export async function GET(request: NextRequest) {
  const executionId = request.nextUrl.searchParams.get('executionId')

  if (!executionId) {
    return NextResponse.json({ error: 'executionId is required' }, { status: 400 })
  }

  const status = executionBuffer.getStatus(executionId)
  return NextResponse.json({ status })
}
