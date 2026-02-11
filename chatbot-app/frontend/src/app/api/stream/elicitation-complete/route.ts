/**
 * Elicitation Complete API endpoint
 * Signals the backend that OAuth consent has completed.
 * The backend's elicitation bridge will unblock the waiting MCP tool.
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

  const envArn = process.env.AGENTCORE_RUNTIME_ARN
  if (envArn) {
    cachedRuntimeArn = envArn
    return envArn
  }

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
    const user = extractUserFromRequest(request)
    const userId = user.userId

    const body = await request.json().catch(() => ({}))
    const sessionId = body.sessionId
    const elicitationId = body.elicitationId

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    console.log(`[Elicitation] Complete signal for session=${sessionId}, elicitationId=${elicitationId}`)

    const payload = {
      input: {
        user_id: userId,
        session_id: sessionId,
        action: 'elicitation_complete',
        elicitation_id: elicitationId || null,
        message: ''
      }
    }

    if (IS_LOCAL) {
      const response = await fetch(`${AGENTCORE_URL}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[Elicitation] Local AgentCore error: ${errorText}`)
        return NextResponse.json(
          { error: 'Failed to signal elicitation complete' },
          { status: 500 }
        )
      }
    } else {
      const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import('@aws-sdk/client-bedrock-agentcore')
      const agentCoreClient = new BedrockAgentCoreClient({ region: AWS_REGION })
      const runtimeArn = await getAgentCoreRuntimeArn()

      const command = new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        qualifier: 'DEFAULT',
        contentType: 'application/json',
        payload: Buffer.from(JSON.stringify(payload)),
        runtimeUserId: userId,
        runtimeSessionId: sessionId
      })

      await agentCoreClient.send(command)
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[Elicitation] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
