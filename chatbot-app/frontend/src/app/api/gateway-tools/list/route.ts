import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AWS configuration
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const PROJECT_NAME = process.env.PROJECT_NAME || 'strands-agent-chatbot';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

// Lazy-loaded AWS clients
let SSMClient: any;
let GetParameterCommand: any;
let ssmClient: any;
let cachedGatewayUrl: string | null = null;

/**
 * Initialize AWS SSM client
 */
async function initializeAwsClients() {
  if (!SSMClient) {
    const ssmModule = await import('@aws-sdk/client-ssm');
    SSMClient = ssmModule.SSMClient;
    GetParameterCommand = ssmModule.GetParameterCommand;
    ssmClient = new SSMClient({ region: AWS_REGION });
  }
}

/**
 * Get Gateway URL from SSM Parameter Store
 * Throws error if not found - no fallback
 */
async function getGatewayUrl(): Promise<string> {
  if (cachedGatewayUrl) {
    return cachedGatewayUrl;
  }

  await initializeAwsClients();
  const paramPath = `/${PROJECT_NAME}/${ENVIRONMENT}/mcp/gateway-url`;
  console.log(`[BFF] Loading Gateway URL from Parameter Store: ${paramPath}`);

  const command = new GetParameterCommand({ Name: paramPath });
  const response = await ssmClient.send(command);

  if (!response.Parameter?.Value) {
    throw new Error(`Gateway URL not found in Parameter Store: ${paramPath}`);
  }

  console.log('[BFF] ✅ Gateway URL loaded from Parameter Store');
  cachedGatewayUrl = response.Parameter.Value;
  return response.Parameter.Value;
}

/**
 * Gateway Tools List API - Direct MCP connection
 *
 * Fetches tool list directly from AgentCore Gateway MCP endpoint.
 * Frontend → BFF (this) → Gateway MCP (direct HTTPS)
 */
export async function GET(request: NextRequest) {
  try {
    // Get Gateway URL from SSM (throws if not found)
    const gatewayUrl = await getGatewayUrl();

    console.log('[BFF] Fetching tools from Gateway MCP:', gatewayUrl);

    // Import AWS SDK v3
    const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers');
    const { SignatureV4 } = await import('@smithy/signature-v4');
    const { Sha256 } = await import('@aws-crypto/sha256-js');
    const { HttpRequest } = await import('@smithy/protocol-http');

    // Get AWS credentials
    const credentialsProvider = fromNodeProviderChain();
    const credentials = await credentialsProvider();

    // Parse Gateway URL and extract region
    const url = new URL(gatewayUrl);
    const regionMatch = gatewayUrl.match(/bedrock-agentcore\.([a-z0-9-]+)\.amazonaws\.com/);
    const region = regionMatch ? regionMatch[1] : (process.env.AWS_REGION || 'us-west-2');

    console.log('[BFF] Using region:', region);

    // MCP list_tools request
    const mcpRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    };

    const requestBody = JSON.stringify(mcpRequest);

    // Create HTTP request for signing
    const httpRequest = new HttpRequest({
      protocol: url.protocol.replace(':', ''),
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'host': url.hostname,
      },
      body: requestBody
    });

    // Sign the request with AWS SigV4
    const signer = new SignatureV4({
      credentials: credentials,
      region: region,
      service: 'bedrock-agentcore',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(httpRequest);

    // Make the signed request
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: signedRequest.headers as HeadersInit,
      body: requestBody
    });

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}`);
    }

    const mcpResponse = await response.json();

    // Convert MCP response to frontend format
    const tools = (mcpResponse.result?.tools || []).map((tool: any) => ({
      id: tool.name,
      name: tool.name.split('___').pop() || tool.name,
      full_name: tool.name,
      description: tool.description || 'Gateway MCP tool',
      category: 'gateway',
      enabled: false
    }));

    console.log('[BFF] ✅ Fetched', tools.length, 'tools from Gateway');

    return NextResponse.json({
      success: true,
      gateway_url: 'configured',
      tools,
      count: tools.length
    });

  } catch (error) {
    console.error('[BFF] Failed to fetch gateway tools:', error);

    // Return empty tools list instead of error to avoid breaking UI
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      tools: [],
      count: 0
    });
  }
}
