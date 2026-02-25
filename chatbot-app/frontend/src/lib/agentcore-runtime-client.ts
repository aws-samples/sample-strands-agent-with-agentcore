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
  cachingEnabled?: boolean,
  abortSignal?: AbortSignal,
  requestType?: string,
  selectedArtifactId?: string,
  apiKeys?: Record<string, string>,
  authToken?: string
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

  // Always include enabled_tools (even if empty) to avoid Bedrock toolConfig validation errors
  if (enabledTools !== undefined) {
    inputData.enabled_tools = enabledTools
    console.log(`[AgentCore]    Enabled tools (${enabledTools.length}):`, enabledTools)
  }

  if (files && files.length > 0) {
    inputData.files = files
    console.log(`[AgentCore]    Files (${files.length}):`, files.map((f: any) => f.filename))
  }

  if (requestType) {
    inputData.request_type = requestType
    console.log(`[AgentCore]    Request type: ${requestType}`)
  }

  if (selectedArtifactId) {
    inputData.selected_artifact_id = selectedArtifactId
    console.log(`[AgentCore]    Selected artifact: ${selectedArtifactId}`)
  }

  if (apiKeys && Object.keys(apiKeys).length > 0) {
    inputData.api_keys = apiKeys
    console.log(`[AgentCore]    API keys provided: ${Object.keys(apiKeys).join(', ')}`)
  }

  if (authToken) {
    inputData.auth_token = authToken
  }

  const payload = { input: inputData }

  // Log payload without bytes, api_keys, auth_token (security)
  const payloadForLog = {
    input: {
      ...inputData,
      files: files?.map((f: any) => ({
        filename: f.filename,
        content_type: f.content_type,
        bytes: `<base64 data ${f.bytes?.length || 0} chars>`
      })),
      api_keys: apiKeys ? `<${Object.keys(apiKeys).length} keys>` : undefined,
      auth_token: authToken ? '<present>' : undefined
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
    signal: abortSignal, // Pass abort signal for cancellation
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
  cachingEnabled?: boolean,
  abortSignal?: AbortSignal,
  requestType?: string,
  selectedArtifactId?: string,
  apiKeys?: Record<string, string>,
  authToken?: string
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

  // Always include enabled_tools (even if empty) to avoid Bedrock toolConfig validation errors
  if (enabledTools !== undefined) {
    inputData.enabled_tools = enabledTools
    console.log(`[AgentCore]    Enabled tools (${enabledTools.length}):`, enabledTools)
  }

  if (files && files.length > 0) {
    inputData.files = files
    console.log(`[AgentCore]    Files (${files.length}):`, files.map((f: any) => f.filename))
  }

  if (requestType) {
    inputData.request_type = requestType
    console.log(`[AgentCore]    Request type: ${requestType}`)
  }

  if (selectedArtifactId) {
    inputData.selected_artifact_id = selectedArtifactId
    console.log(`[AgentCore]    Selected artifact: ${selectedArtifactId}`)
  }

  if (apiKeys && Object.keys(apiKeys).length > 0) {
    inputData.api_keys = apiKeys
    console.log(`[AgentCore]    API keys provided: ${Object.keys(apiKeys).join(', ')}`)
  }

  if (authToken) {
    inputData.auth_token = authToken
  }

  const payload = { input: inputData }

  // Log payload without bytes, api_keys, auth_token (security)
  const payloadForLog = {
    input: {
      ...inputData,
      files: files?.map((f: any) => ({
        filename: f.filename,
        content_type: f.content_type,
        bytes: `<base64 data ${f.bytes?.length || 0} chars>`
      })),
      api_keys: apiKeys ? `<${Object.keys(apiKeys).length} keys>` : undefined,
      auth_token: authToken ? '<present>' : undefined
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
        // Handle abort signal
        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            console.log('[AgentCore] Abort signal received, destroying Node.js stream')
            nodeStream.destroy()
            try {
              controller.close()
            } catch (e) {
              // Controller might already be closed
            }
          })
        }

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
        console.log('[AgentCore] Stream cancelled, destroying Node.js stream')
        nodeStream.destroy()
      }
    })
  }

  // Otherwise, treat as AsyncIterable
  let aborted = false

  // Handle abort signal for AsyncIterable
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      console.log('[AgentCore] Abort signal received for AsyncIterable stream')
      aborted = true
    })
  }

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of sdkStream as any) {
          if (aborted) {
            console.log('[AgentCore] Stream aborted, stopping iteration')
            break
          }
          if (chunk) {
            controller.enqueue(chunk)
          }
        }
        controller.close()
      } catch (error) {
        if (aborted) {
          console.log('[AgentCore] Stream aborted during iteration')
          try {
            controller.close()
          } catch (e) {
            // Controller might already be closed
          }
        } else {
          console.error('[AgentCore] Error reading stream:', error)
          controller.error(error)
        }
      }
    },

    cancel() {
      console.log('[AgentCore] AsyncIterable stream cancelled')
      aborted = true
    }
  })
}

/**
 * Invoke AgentCore with AG-UI RunAgentInput format (snake_case body sent directly)
 * Used when the frontend sends a RunAgentInput so the backend uses AGUIStreamEventProcessor.
 */
export async function invokeAgentCoreRuntimeAgui(
  aguiBody: Record<string, any>,
  abortSignal?: AbortSignal,
): Promise<ReadableStream> {
  try {
    if (IS_LOCAL) {
      console.log('[AgentCore] 🚀 Invoking LOCAL AgentCore via AG-UI HTTP POST')
      const response = await fetch(`${AGENTCORE_URL}/invocations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(aguiBody),
        signal: abortSignal,
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`AgentCore returned ${response.status}: ${errorText}`)
      }
      if (!response.body) throw new Error('No response stream received from AgentCore')
      return response.body
    } else {
      await initializeAwsClients()
      const runtimeArn = await getAgentCoreRuntimeArn()
      const threadId = aguiBody.thread_id
      const userId = aguiBody.state?.user_id || 'agui'

      console.log('[AgentCore] 🚀 Invoking AWS Bedrock AgentCore Runtime (AG-UI)')
      const command = new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        qualifier: 'DEFAULT',
        contentType: 'application/json',
        accept: 'text/event-stream',
        payload: Buffer.from(JSON.stringify(aguiBody)),
        runtimeUserId: userId,
        runtimeSessionId: threadId,
      })

      const response = await agentCoreClient.send(command)
      if (!response.response) throw new Error('No response stream received from AgentCore Runtime')

      const sdkStream = response.response
      let aborted = false
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => { aborted = true })
      }

      if (typeof (sdkStream as any).pipe === 'function') {
        const nodeStream = sdkStream as any
        return new ReadableStream({
          start(controller) {
            if (abortSignal) {
              abortSignal.addEventListener('abort', () => {
                nodeStream.destroy()
                try { controller.close() } catch (_) {}
              })
            }
            nodeStream.on('data', (chunk: Uint8Array) => controller.enqueue(chunk))
            nodeStream.on('end', () => controller.close())
            nodeStream.on('error', (error: Error) => controller.error(error))
          },
          cancel() { nodeStream.destroy() }
        })
      }

      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of sdkStream as any) {
              if (aborted) break
              if (chunk) controller.enqueue(chunk)
            }
            controller.close()
          } catch (error) {
            if (aborted) { try { controller.close() } catch (_) {} }
            else controller.error(error)
          }
        },
        cancel() { aborted = true }
      })
    }
  } catch (error) {
    console.error('[AgentCore] ❌ Failed to invoke Runtime (AG-UI):', error)
    throw new Error(
      `Failed to invoke AgentCore Runtime: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
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
  cachingEnabled?: boolean,
  abortSignal?: AbortSignal,
  requestType?: string,
  selectedArtifactId?: string,
  apiKeys?: Record<string, string>,
  authToken?: string
): Promise<ReadableStream> {
  try {
    if (IS_LOCAL) {
      return await invokeLocalAgentCore(userId, sessionId, message, modelId, enabledTools, files, temperature, systemPrompt, cachingEnabled, abortSignal, requestType, selectedArtifactId, apiKeys, authToken)
    } else {
      return await invokeAwsAgentCore(userId, sessionId, message, modelId, enabledTools, files, temperature, systemPrompt, cachingEnabled, abortSignal, requestType, selectedArtifactId, apiKeys, authToken)
    }
  } catch (error) {
    console.error('[AgentCore] ❌ Failed to invoke Runtime:', error)
    throw new Error(
      `Failed to invoke AgentCore Runtime: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

export async function pingAgentCoreRuntime(sessionId?: string, userId?: string): Promise<{
  success: boolean
  latencyMs: number
  mode: 'local' | 'aws'
  error?: string
}> {
  const startTime = Date.now()
  console.log(`[AgentCore Warmup] Starting (IS_LOCAL=${IS_LOCAL})`)

  try {
    if (IS_LOCAL) {
      console.log(`[AgentCore Warmup] Local mode: GET ${AGENTCORE_URL}/ping`)
      const response = await fetch(`${AGENTCORE_URL}/ping`, { method: 'GET' })
      const latencyMs = Date.now() - startTime
      if (!response.ok) throw new Error(`Ping failed: ${response.status}`)
      console.log(`[AgentCore Warmup] Local ping success: ${latencyMs}ms`)
      return { success: true, latencyMs, mode: 'local' }
    }

    console.log('[AgentCore Warmup] AWS mode: initializing clients')
    await initializeAwsClients()
    const runtimeArn = await getAgentCoreRuntimeArn()
    console.log(`[AgentCore Warmup] Runtime ARN: ${runtimeArn}`)

    const warmupSessionId = sessionId || `warmup00_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '')}`
    const warmupUserId = userId || 'anonymous'
    console.log(`[AgentCore Warmup] Invoking with sessionId=${warmupSessionId}, userId=${warmupUserId}`)

    const payload = {
      input: {
        user_id: warmupUserId,
        session_id: warmupSessionId,
        message: '',
        warmup: true
      }
    }

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      qualifier: 'DEFAULT',
      contentType: 'application/json',
      payload: Buffer.from(JSON.stringify(payload)),
      runtimeSessionId: warmupSessionId,
      runtimeUserId: warmupUserId,
    })

    const response = await agentCoreClient.send(command)
    const latencyMs = Date.now() - startTime
    console.log(`[AgentCore Warmup] AWS invoke success: ${latencyMs}ms, traceId=${response.traceId}`)
    return { success: true, latencyMs, mode: 'aws' }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[AgentCore Warmup] Failed after ${latencyMs}ms: ${errorMsg}`)
    if (error instanceof Error && error.stack) {
      console.error(`[AgentCore Warmup] Stack: ${error.stack}`)
    }
    return { success: false, latencyMs, mode: IS_LOCAL ? 'local' : 'aws', error: errorMsg }
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
