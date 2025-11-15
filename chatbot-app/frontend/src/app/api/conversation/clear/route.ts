/**
 * Conversation clear endpoint (temporary mock for Phase 1 testing)
 */
import { NextResponse } from 'next/server'

export async function POST() {
  // For now just return success
  // Phase 2 will clear Agent Core session
  return NextResponse.json({ success: true })
}
