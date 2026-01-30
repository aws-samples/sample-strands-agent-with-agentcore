/**
 * Voice Session Start API - returns WebSocket URL for voice chat
 * Local: Direct WS to AgentCore, Cloud: SigV4 pre-signed URL to AgentCore Runtime
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest, getSessionId, ensureSessionExists } from '@/lib/auth-utils'
import { SignatureV4 } from '@smithy/signature-v4'
import { Sha256 } from '@aws-crypto/sha256-js'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { HttpRequest } from '@smithy/protocol-http'

const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

// SSM cache for Runtime ARN
let cachedRuntimeArn: string | null = null
let cacheExpiry: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000

/** Get AgentCore Runtime ARN from SSM (cloud mode) */
async function getRuntimeArnFromSSM(): Promise<string | null> {
  // Check cache first
  if (cachedRuntimeArn && Date.now() < cacheExpiry) {
    return cachedRuntimeArn
  }

  const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot'
  const environment = process.env.ENVIRONMENT || 'dev'
  const parameterName = `/${projectName}/${environment}/agentcore/runtime-arn`

  try {
    const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm')
    const client = new SSMClient({ region: process.env.AWS_REGION || 'us-west-2' })

    const response = await client.send(new GetParameterCommand({
      Name: parameterName,
    }))

    if (response.Parameter?.Value) {
      cachedRuntimeArn = response.Parameter.Value
      cacheExpiry = Date.now() + CACHE_TTL_MS
      console.log(`[Voice Start] Loaded Runtime ARN from SSM: ${cachedRuntimeArn}`)
      return cachedRuntimeArn
    }
  } catch (error) {
    console.warn(`[Voice Start] Failed to get Runtime ARN from SSM (${parameterName}):`, error)
  }

  return null
}

/** Generate SigV4 pre-signed WebSocket URL for AgentCore Runtime */
async function generatePresignedWsUrl(
  runtimeArn: string,
  region: string,
  queryParams?: Record<string, string>
): Promise<string> {
  const host = `bedrock-agentcore.${region}.amazonaws.com`
  const encodedArn = encodeURIComponent(runtimeArn)
  const path = `/runtimes/${encodedArn}/ws`

  const credentials = await defaultProvider()()

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: host,
    port: 443,
    path: path,
    query: queryParams || {},
    headers: { host },
  })

  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: region,
    credentials: credentials,
    sha256: Sha256,
  })

  const signedRequest = await signer.presign(request, { expiresIn: 300 })

  const signedUrl = new URL(`https://${host}${path}`)
  if (signedRequest.query) {
    for (const [key, value] of Object.entries(signedRequest.query)) {
      if (typeof value === 'string') {
        signedUrl.searchParams.set(key, value)
      } else if (Array.isArray(value)) {
        value.forEach(v => signedUrl.searchParams.append(key, v))
      }
    }
  }

  return signedUrl.toString().replace('https://', 'wss://')
}

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = extractUserFromRequest(request)
    const userId = user.userId
    const { sessionId } = getSessionId(request, userId)
    const body = await request.json().catch(() => ({}))
    const enabledTools: string[] = body.enabledTools || []

    // Ensure session exists in storage (creates if not exists)
    const { isNew } = await ensureSessionExists(userId, sessionId, {
      title: 'Voice Chat',
      metadata: { isVoiceSession: true },
    })

    console.log(`[Voice Start] User: ${userId}, Session: ${sessionId}, New: ${isNew}, Tools: ${enabledTools.length}`)

    let wsUrl: string
    const awsRegion = process.env.AWS_REGION || 'us-west-2'

    if (IS_LOCAL) {
      const agentcoreUrl = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://127.0.0.1:8080'
      wsUrl = agentcoreUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/voice/stream'
      const params = new URLSearchParams()
      params.set('session_id', sessionId)
      if (userId) params.set('user_id', userId)
      if (enabledTools.length > 0) params.set('enabled_tools', JSON.stringify(enabledTools))
      wsUrl = `${wsUrl}?${params.toString()}`
    } else {
      const runtimeArn = await getRuntimeArnFromSSM()
      if (!runtimeArn) {
        return NextResponse.json({ success: false, error: 'AgentCore Runtime not configured' }, { status: 500 })
      }

      // All params need custom prefix to reach container (AgentCore Runtime requirement)
      const queryParams: Record<string, string> = {
        'X-Amzn-Bedrock-AgentCore-Runtime-Custom-Session-Id': sessionId,
      }
      if (userId) {
        queryParams['X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Id'] = userId
      }
      if (enabledTools.length > 0) {
        queryParams['X-Amzn-Bedrock-AgentCore-Runtime-Custom-Enabled-Tools'] = JSON.stringify(enabledTools)
      }

      wsUrl = await generatePresignedWsUrl(runtimeArn, awsRegion, queryParams)
    }

    console.log(`[Voice Start] WebSocket URL generated (${IS_LOCAL ? 'local' : 'cloud'} mode)`)

    return NextResponse.json({
      success: true,
      sessionId,
      userId,
      wsUrl,
      awsRegion,
      isNewSession: isNew,
    })
  } catch (error) {
    console.error('[Voice Start] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start voice session',
      },
      { status: 500 }
    )
  }
}
