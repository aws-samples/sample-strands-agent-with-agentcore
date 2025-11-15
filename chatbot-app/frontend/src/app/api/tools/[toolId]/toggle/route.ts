/**
 * Tool toggle endpoint
 * Updates user's tool preferences in DynamoDB
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { toggleUserTool, getUserEnabledTools } from '@/lib/dynamodb-client'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params

    if (!toolId) {
      return NextResponse.json(
        { success: false, error: 'Tool ID is required' },
        { status: 400 }
      )
    }

    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    if (userId === 'anonymous') {
      // For anonymous users, use in-memory state (no persistence)
      return NextResponse.json({
        success: true,
        enabled: true, // Default to enabled for anonymous
        toolId,
        note: 'Anonymous user - changes not persisted'
      })
    }

    // Get current enabled tools
    const currentEnabledTools = await getUserEnabledTools(userId)

    // Determine new state (toggle)
    const isCurrentlyEnabled = currentEnabledTools.length === 0 || currentEnabledTools.includes(toolId)
    const newState = !isCurrentlyEnabled

    console.log(`[API] Tool toggle - User: ${userId}, Tool: ${toolId}, ${isCurrentlyEnabled} → ${newState}`)

    // Update DynamoDB
    const updatedEnabledTools = await toggleUserTool(userId, toolId, newState)

    console.log(`[API] Tool toggled successfully - Enabled tools:`, updatedEnabledTools)

    return NextResponse.json({
      success: true,
      enabled: newState,
      toolId,
      enabledTools: updatedEnabledTools,
    })
  } catch (error) {
    console.error('[API] Error toggling tool:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
