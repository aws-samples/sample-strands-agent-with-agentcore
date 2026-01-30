/**
 * Stop Signal API endpoint
 * Sets stop signal for a specific user-session to gracefully stop AgentCore streaming
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export async function POST(request: NextRequest) {
  try {
    // Extract user from request
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Get session ID from request body or header
    const body = await request.json().catch(() => ({}))
    let sessionId = body.sessionId

    // Fallback to header if not in body
    if (!sessionId) {
      const { sessionId: headerSessionId } = getSessionId(request, userId)
      sessionId = headerSessionId
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    console.log(`[StopSignal] Setting stop signal for user=${userId}, session=${sessionId}`)

    if (IS_LOCAL) {
      // Local mode: Call local AgentCore endpoint
      const AGENTCORE_URL = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://127.0.0.1:8080'

      const response = await fetch(`${AGENTCORE_URL}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, session_id: sessionId })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[StopSignal] Local AgentCore error: ${errorText}`)
        return NextResponse.json(
          { error: 'Failed to set stop signal' },
          { status: 500 }
        )
      }

      console.log(`[StopSignal] Local stop signal set successfully`)
    } else {
      // Cloud mode: Update DynamoDB directly
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb')
      const { UpdateItemCommand } = await import('@aws-sdk/client-dynamodb')
      const { marshall } = await import('@aws-sdk/util-dynamodb')

      const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot'
      const tableName = `${projectName}-users-v2`
      const region = process.env.AWS_REGION || 'us-west-2'

      const dynamoClient = new DynamoDBClient({ region })

      const dynamoKey = {
        userId: userId,
        sk: `SESSION#${sessionId}`
      }
      console.log(`[StopSignal] DynamoDB key: ${JSON.stringify(dynamoKey)}`)
      console.log(`[StopSignal] Table: ${tableName}`)

      const command = new UpdateItemCommand({
        TableName: tableName,
        Key: marshall(dynamoKey),
        UpdateExpression: 'SET stopRequested = :val, stopRequestedAt = :ts',
        ExpressionAttributeValues: marshall({
          ':val': true,
          ':ts': new Date().toISOString()
        })
      })

      await dynamoClient.send(command)
      console.log(`[StopSignal] DynamoDB stop signal set successfully for key: ${JSON.stringify(dynamoKey)}`)
    }

    return NextResponse.json({
      success: true,
      message: 'Stop signal set',
      userId,
      sessionId
    })

  } catch (error) {
    console.error('[StopSignal] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
