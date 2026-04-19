import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const PROJECT_NAME = process.env.PROJECT_NAME || 'strands-agent-chatbot';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

let SSMClient: any;
let GetParameterCommand: any;
let ssmClient: any;
let cachedGatewayUrl: string | null = null;

async function initializeAwsClients() {
  if (!SSMClient) {
    const ssmModule = await import('@aws-sdk/client-ssm');
    SSMClient = ssmModule.SSMClient;
    GetParameterCommand = ssmModule.GetParameterCommand;
    ssmClient = new SSMClient({ region: AWS_REGION });
  }
}

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

  cachedGatewayUrl = response.Parameter.Value;
  return response.Parameter.Value;
}

/**
 * Gateway Tools List API - Direct MCP connection with JWT Bearer auth
 */
export async function GET(request: NextRequest) {
  try {
    const gatewayUrl = await getGatewayUrl();
    console.log('[BFF] Fetching tools from Gateway MCP:', gatewayUrl);

    const authHeader = request.headers.get('authorization') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader.startsWith('Bearer ')) {
      headers['Authorization'] = authHeader;
    }

    const mcpRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    };

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(mcpRequest),
    });

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}`);
    }

    const mcpResponse = await response.json();

    const tools = (mcpResponse.result?.tools || []).map((tool: any) => ({
      id: tool.name,
      name: tool.name.split('___').pop() || tool.name,
      full_name: tool.name,
      description: tool.description || 'Gateway MCP tool',
      category: 'gateway',
      enabled: false
    }));

    console.log('[BFF] Fetched', tools.length, 'tools from Gateway');

    return NextResponse.json({
      success: true,
      gateway_url: 'configured',
      tools,
      count: tools.length
    });

  } catch (error) {
    console.error('[BFF] Failed to fetch gateway tools:', error);

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      tools: [],
      count: 0
    });
  }
}
