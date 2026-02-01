/**
 * Stop Signal API endpoint
 * Sets stop signal for a specific user-session to gracefully stop AgentCore streaming
 *
 * Both local and cloud modes now use /invocations endpoint with action="stop"
 * This leverages session affinity to ensure the stop signal reaches the same container
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'
const AGENTCORE_URL = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://localhost:8080'

// AWS configuration
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
const PROJECT_NAME = process.env.PROJECT_NAME || 'strands-agent-chatbot'
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev'

// Cached runtime ARN
let cachedRuntimeArn: string | null = null

async function getAgentCoreRuntimeArn(): Promise<string> {
  if (cachedRuntimeArn) return cachedRuntimeArn

  // Try environment variable first
  const envArn = process.env.AGENTCORE_RUNTIME_ARN
  if (envArn) {
    cachedRuntimeArn = envArn
    return envArn
  }

  // Try Parameter Store
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm')
  const ssmClient = new SSMClient({ region: AWS_REGION })
  const paramPath = `/${PROJECT_NAME}/${ENVIRONMENT}/agentcore/runtime-arn`

  const command = new GetParameterCommand({ Name: paramPath })
  const response = await ssmClient.send(command)

  if (response.Parameter?.Value) {
    cachedRuntimeArn = response.Parameter.Value
    return response.Parameter.Value
  }

  throw new Error('AGENTCORE_RUNTIME_ARN not configured')
}

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

    // Prepare stop action payload
    const payload = {
      input: {
        user_id: userId,
        session_id: sessionId,
        action: 'stop',
        message: ''
      }
    }

    if (IS_LOCAL) {
      // Local mode: Call local AgentCore /invocations with action=stop
      const response = await fetch(`${AGENTCORE_URL}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[StopSignal] Local AgentCore error: ${errorText}`)
        return NextResponse.json(
          { error: 'Failed to set stop signal' },
          { status: 500 }
        )
      }

      const result = await response.json()
      console.log(`[StopSignal] Local stop signal set successfully:`, result)
    } else {
      // Cloud mode: Call AgentCore Runtime via Bedrock SDK with action=stop
      const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import('@aws-sdk/client-bedrock-agentcore')
      const agentCoreClient = new BedrockAgentCoreClient({ region: AWS_REGION })
      const runtimeArn = await getAgentCoreRuntimeArn()

      console.log(`[StopSignal] Invoking AgentCore Runtime with action=stop`)
      console.log(`[StopSignal] Runtime ARN: ${runtimeArn}`)

      const command = new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        qualifier: 'DEFAULT',
        contentType: 'application/json',
        payload: Buffer.from(JSON.stringify(payload)),
        runtimeUserId: userId,
        runtimeSessionId: sessionId
      })

      const response = await agentCoreClient.send(command)
      console.log(`[StopSignal] Cloud stop signal set successfully, traceId: ${response.traceId}`)
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
