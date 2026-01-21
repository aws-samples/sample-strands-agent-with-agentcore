/**
 * Voice Session Start API
 *
 * Called before WebSocket connection to Voice service.
 * Handles authentication, session initialization, and returns connection info.
 *
 * Architecture:
 * - Local mode: Direct WebSocket to local AgentCore (/voice/stream)
 * - Cloud mode: WebSocket to AgentCore Runtime via AWS managed endpoint
 *   - URL format: wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<arn>/ws
 *   - Returns SigV4 pre-signed URL for browser WebSocket authentication
 *   - Uses same signing method as bedrock-agentcore Python SDK
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'
import { SignatureV4 } from '@smithy/signature-v4'
import { Sha256 } from '@aws-crypto/sha256-js'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { HttpRequest } from '@smithy/protocol-http'

const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

// Cache for SSM parameter value (Runtime ARN)
let cachedRuntimeArn: string | null = null
let cacheExpiry: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

/**
 * Get AgentCore Runtime ARN from SSM Parameter Store (cloud mode only)
 */
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

/**
 * Generate SigV4 pre-signed WebSocket URL for AgentCore Runtime
 *
 * This replicates the behavior of bedrock-agentcore Python SDK's
 * generate_presigned_url() method which uses SigV4QueryAuth.
 */
async function generatePresignedWsUrl(
  runtimeArn: string,
  region: string,
  queryParams?: Record<string, string>
): Promise<string> {
  const host = `bedrock-agentcore.${region}.amazonaws.com`
  const encodedArn = encodeURIComponent(runtimeArn)
  const path = `/runtimes/${encodedArn}/ws`

  // Get credentials
  const credentials = await defaultProvider()()

  // Build the URL with query params first (these get signed)
  const url = new URL(`https://${host}${path}`)
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value)
    }
  }

  // Create HttpRequest for signing
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: host,
    port: 443,
    path: path,
    query: queryParams || {},
    headers: {
      host: host,
    },
  })

  // Create SigV4 signer
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: region,
    credentials: credentials,
    sha256: Sha256,
  })

  // Pre-sign the request (puts auth in query string for WebSocket)
  const signedRequest = await signer.presign(request, {
    expiresIn: 300,  // 5 minutes validity (max for AgentCore)
  })

  // Build final URL from signed request
  const signedUrl = new URL(`https://${host}${path}`)

  // Add all query parameters from signed request
  if (signedRequest.query) {
    for (const [key, value] of Object.entries(signedRequest.query)) {
      if (typeof value === 'string') {
        signedUrl.searchParams.set(key, value)
      } else if (Array.isArray(value)) {
        // Handle array values
        value.forEach(v => signedUrl.searchParams.append(key, v))
      }
    }
  }

  // Convert https:// to wss:// for WebSocket
  const wsUrl = signedUrl.toString().replace('https://', 'wss://')

  return wsUrl
}

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // 2. Session handling
    const { sessionId, isNew } = getSessionId(request, userId)

    // 3. Get enabled tools from request body
    const body = await request.json().catch(() => ({}))
    const enabledTools: string[] = body.enabledTools || []

    console.log(`[Voice Start] User: ${userId}, Session: ${sessionId}, New: ${isNew}, Tools: ${enabledTools.length}`)

    // 4. Initialize session if new
    if (isNew) {
      if (IS_LOCAL) {
        const { upsertSession } = await import('@/lib/local-session-store')
        upsertSession(userId, sessionId, {
          title: 'Voice Chat',
          messageCount: 0,
          lastMessageAt: new Date().toISOString(),
          metadata: { isVoiceSession: true },
        })
      } else {
        const { upsertSession } = await import('@/lib/dynamodb-client')
        await upsertSession(userId, sessionId, {
          title: 'Voice Chat',
          messageCount: 0,
          lastMessageAt: new Date().toISOString(),
          metadata: { isVoiceSession: true },
        })
      }
      console.log(`[Voice Start] Created new session: ${sessionId}`)
    }

    // 5. Build WebSocket URL for client
    let wsUrl: string
    const awsRegion = process.env.AWS_REGION || 'us-west-2'

    if (IS_LOCAL) {
      // Local mode: Direct WebSocket to local AgentCore
      const agentcoreUrl = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://localhost:8080'
      wsUrl = agentcoreUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/voice/stream'

      // Add query params for local mode
      const params = new URLSearchParams()
      params.set('session_id', sessionId)
      if (userId) params.set('user_id', userId)
      if (enabledTools.length > 0) params.set('enabled_tools', JSON.stringify(enabledTools))
      wsUrl = `${wsUrl}?${params.toString()}`
    } else {
      // Cloud mode: Generate SigV4 pre-signed WebSocket URL
      const runtimeArn = await getRuntimeArnFromSSM()

      if (!runtimeArn) {
        console.error('[Voice Start] AgentCore Runtime ARN not configured')
        return NextResponse.json(
          { success: false, error: 'AgentCore Runtime not configured' },
          { status: 500 }
        )
      }

      // Build query params to pass to AgentCore container
      const queryParams: Record<string, string> = {
        session_id: sessionId,
      }
      if (userId) queryParams.user_id = userId
      if (enabledTools.length > 0) queryParams.enabled_tools = JSON.stringify(enabledTools)

      // Generate pre-signed URL (same method as Python SDK)
      wsUrl = await generatePresignedWsUrl(runtimeArn, awsRegion, queryParams)

      console.log(`[Voice Start] Generated pre-signed WebSocket URL`)
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
