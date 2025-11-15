/**
 * AgentCore Client - Supports both local and AWS deployment
 * - Local: HTTP POST to localhost:8080
 * - AWS: Bedrock AgentCore Runtime via AWS SDK
 */

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'
const AGENTCORE_URL = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://localhost:8080'

// AWS configuration (for cloud deployment)
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
const PROJECT_NAME = process.env.PROJECT_NAME || 'strands-agent-chatbot'
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev'

// Dynamic imports for AWS SDK (only loaded in cloud deployment)
let BedrockAgentCoreClient: any
let InvokeAgentRuntimeCommand: any
let SSMClient: any
let GetParameterCommand: any
let agentCoreClient: any
let ssmClient: any
let cachedRuntimeArn: string | null = null

/**
 * Initialize AWS clients (lazy loading for cloud deployment only)
 */
async function initializeAwsClients() {
  if (IS_LOCAL) return

  if (!BedrockAgentCoreClient) {
    const bedrockModule = await import('@aws-sdk/client-bedrock-agentcore')
    BedrockAgentCoreClient = bedrockModule.BedrockAgentCoreClient
    InvokeAgentRuntimeCommand = bedrockModule.InvokeAgentRuntimeCommand
    agentCoreClient = new BedrockAgentCoreClient({ region: AWS_REGION })

    const ssmModule = await import('@aws-sdk/client-ssm')
    SSMClient = ssmModule.SSMClient
    GetParameterCommand = ssmModule.GetParameterCommand
    ssmClient = new SSMClient({ region: AWS_REGION })
  }
}

/**
 * Get AgentCore Runtime ARN from Parameter Store or environment variable
 */
async function getAgentCoreRuntimeArn(): Promise<string> {
  if (cachedRuntimeArn) {
    return cachedRuntimeArn
  }

  // Try environment variable first
  const envArn = process.env.AGENTCORE_RUNTIME_ARN
  if (envArn) {
    console.log('[AgentCore] Using AGENTCORE_RUNTIME_ARN from environment')
    cachedRuntimeArn = envArn
    return envArn
  }

  // Try Parameter Store
  try {
    await initializeAwsClients()
    const paramPath = `/${PROJECT_NAME}/${ENVIRONMENT}/agentcore/runtime-arn`
    console.log(`[AgentCore] Loading Runtime ARN from Parameter Store: ${paramPath}`)

    const command = new GetParameterCommand({ Name: paramPath })
    const response = await ssmClient.send(command)

    if (response.Parameter?.Value) {
      console.log('[AgentCore] ✅ Runtime ARN loaded from Parameter Store')
      cachedRuntimeArn = response.Parameter.Value
      return response.Parameter.Value
    }
  } catch (error) {
    console.warn('[AgentCore] ⚠️ Failed to load from Parameter Store:', error)
  }

  throw new Error(
    'AGENTCORE_RUNTIME_ARN not configured. Please set environment variable or Parameter Store value.'
  )
}

/**
 * Invoke local AgentCore via HTTP POST
 */
async function invokeLocalAgentCore(
  userId: string,
  sessionId: string,
  message: string,
  modelId?: string,
  enabledTools?: string[],
  files?: any[],
  temperature?: number,
  systemPrompt?: string,
  cachingEnabled?: boolean
): Promise<ReadableStream> {
  console.log('[AgentCore] 🚀 Invoking LOCAL AgentCore via HTTP POST')
  console.log(`[AgentCore]    URL: ${AGENTCORE_URL}/invocations`)
  console.log(`[AgentCore]    User: ${userId}, Session: ${sessionId}`)

  const inputData: Record<string, any> = {
    user_id: userId,
    session_id: sessionId,
    message: message,
  }

  if (modelId) {
    inputData.model_id = modelId
  }

  if (temperature !== undefined) {
    inputData.temperature = temperature
  }

  if (systemPrompt) {
    inputData.system_prompt = systemPrompt
  }

  if (cachingEnabled !== undefined) {
    inputData.caching_enabled = cachingEnabled
  }

  if (enabledTools && enabledTools.length > 0) {
    inputData.enabled_tools = enabledTools
    console.log(`[AgentCore]    Enabled tools (${enabledTools.length}):`, enabledTools)
  }

  if (files && files.length > 0) {
    inputData.files = files
    console.log(`[AgentCore]    Files (${files.length}):`, files.map((f: any) => f.filename))
  }

  const payload = { input: inputData }

  // Log payload without bytes (to avoid massive console output)
  const payloadForLog = {
    input: {
      ...inputData,
      files: files?.map((f: any) => ({
        filename: f.filename,
        content_type: f.content_type,
        bytes: `<base64 data ${f.bytes?.length || 0} chars>`
      }))
    }
  }
  console.log('[AgentCore]    Payload:', JSON.stringify(payloadForLog, null, 2))

  const response = await fetch(`${AGENTCORE_URL}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`AgentCore returned ${response.status}: ${errorText}`)
  }

  console.log('[AgentCore] ✅ Local Runtime invoked successfully')
  console.log(`[AgentCore]    Status: ${response.status}`)

  if (!response.body) {
    throw new Error('No response stream received from AgentCore')
  }

  return response.body
}

/**
 * Invoke AWS Bedrock AgentCore Runtime
 */
async function invokeAwsAgentCore(
  userId: string,
  sessionId: string,
  message: string,
  modelId?: string,
  enabledTools?: string[],
  files?: any[],
  temperature?: number,
  systemPrompt?: string,
  cachingEnabled?: boolean
): Promise<ReadableStream> {
  await initializeAwsClients()
  const runtimeArn = await getAgentCoreRuntimeArn()

  console.log('[AgentCore] 🚀 Invoking AWS Bedrock AgentCore Runtime')
  console.log(`[AgentCore]    User: ${userId}, Session: ${sessionId}`)
  console.log(`[AgentCore]    ARN: ${runtimeArn}`)

  const inputData: Record<string, any> = {
    user_id: userId,
    session_id: sessionId,
    message: message,
  }

  if (modelId) {
    inputData.model_id = modelId
  }

  if (temperature !== undefined) {
    inputData.temperature = temperature
  }

  if (systemPrompt) {
    inputData.system_prompt = systemPrompt
  }

  if (cachingEnabled !== undefined) {
    inputData.caching_enabled = cachingEnabled
  }

  if (enabledTools && enabledTools.length > 0) {
    inputData.enabled_tools = enabledTools
    console.log(`[AgentCore]    Enabled tools (${enabledTools.length}):`, enabledTools)
  }

  if (files && files.length > 0) {
    inputData.files = files
    console.log(`[AgentCore]    Files (${files.length}):`, files.map((f: any) => f.filename))
  }

  const payload = { input: inputData }

  // Log payload without bytes (to avoid massive console output)
  const payloadForLog = {
    input: {
      ...inputData,
      files: files?.map((f: any) => ({
        filename: f.filename,
        content_type: f.content_type,
        bytes: `<base64 data ${f.bytes?.length || 0} chars>`
      }))
    }
  }
  console.log('[AgentCore]    Payload:', JSON.stringify(payloadForLog, null, 2))

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: runtimeArn,
    qualifier: 'DEFAULT',
    contentType: 'application/json',
    accept: 'text/event-stream',
    payload: Buffer.from(JSON.stringify(payload)),
    runtimeUserId: userId,
    runtimeSessionId: sessionId,
  })

  const response = await agentCoreClient.send(command)

  console.log('[AgentCore] ✅ AWS Runtime invoked successfully')
  console.log(`[AgentCore]    Trace ID: ${response.traceId}`)
  console.log(`[AgentCore]    Status Code: ${response.statusCode}`)

  if (!response.response) {
    throw new Error('No response stream received from AgentCore Runtime')
  }

  // AWS SDK returns SdkStream (Node.js Readable stream or AsyncIterable)
  // Convert to Web ReadableStream for uniform handling
  const sdkStream = response.response

  // Check if it's a Node.js Readable stream (has 'pipe' method)
  if (typeof (sdkStream as any).pipe === 'function') {
    // Node.js Readable stream -> Web ReadableStream
    const nodeStream = sdkStream as any

    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Uint8Array) => {
          controller.enqueue(chunk)
        })

        nodeStream.on('end', () => {
          controller.close()
        })

        nodeStream.on('error', (error: Error) => {
          console.error('[AgentCore] Stream error:', error)
          controller.error(error)
        })
      },

      cancel() {
        nodeStream.destroy()
      }
    })
  }

  // Otherwise, treat as AsyncIterable
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of sdkStream as any) {
          if (chunk) {
            controller.enqueue(chunk)
          }
        }
        controller.close()
      } catch (error) {
        console.error('[AgentCore] Error reading stream:', error)
        controller.error(error)
      }
    }
  })
}

/**
 * Invoke AgentCore and stream the response
 * Automatically uses local or AWS based on configuration
 */
export async function invokeAgentCoreRuntime(
  userId: string,
  sessionId: string,
  message: string,
  modelId?: string,
  enabledTools?: string[],
  files?: any[],
  temperature?: number,
  systemPrompt?: string,
  cachingEnabled?: boolean
): Promise<ReadableStream> {
  try {
    if (IS_LOCAL) {
      return await invokeLocalAgentCore(userId, sessionId, message, modelId, enabledTools, files, temperature, systemPrompt, cachingEnabled)
    } else {
      return await invokeAwsAgentCore(userId, sessionId, message, modelId, enabledTools, files, temperature, systemPrompt, cachingEnabled)
    }
  } catch (error) {
    console.error('[AgentCore] ❌ Failed to invoke Runtime:', error)
    throw new Error(
      `Failed to invoke AgentCore Runtime: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Health check - validates AgentCore configuration
 */
export async function validateAgentCoreConfig(): Promise<{
  configured: boolean
  url?: string
  runtimeArn?: string
  error?: string
}> {
  try {
    if (IS_LOCAL) {
      const response = await fetch(`${AGENTCORE_URL}/health`, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`)
      }

      return {
        configured: true,
        url: AGENTCORE_URL,
      }
    } else {
      const runtimeArn = await getAgentCoreRuntimeArn()
      return {
        configured: true,
        runtimeArn,
      }
    }
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
