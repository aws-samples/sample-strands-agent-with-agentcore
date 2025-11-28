import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentCoreClient, GetBrowserSessionCommand } from '@aws-sdk/client-bedrock-agentcore';

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Environment-configurable constants with fallback defaults
// Following Python SDK pattern for consistency
const region = process.env.AWS_REGION || 'us-west-2';
const dpEndpointOverride = process.env.BEDROCK_AGENTCORE_DP_ENDPOINT;

/**
 * Validate browser session status
 * GET /api/browser/validate-session?sessionId={sessionId}&browserId={browserId}
 *
 * Returns:
 * - isValid: boolean (true if status is READY)
 * - status: session status from AWS
 * - streams: stream endpoints if available
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    let browserId = searchParams.get('browserId');

    // Fallback to environment variable if browserId not provided
    if (!browserId) {
      browserId = process.env.BROWSER_ID || null;
    }

    if (!sessionId || !browserId) {
      return NextResponse.json(
        {
          isValid: false,
          error: 'Missing sessionId or browserId parameter'
        },
        { status: 400 }
      );
    }

    // Check session status
    // Use environment variable endpoint override if provided
    const clientConfig: any = { region };
    if (dpEndpointOverride) {
      clientConfig.endpoint = dpEndpointOverride;
    }
    const client = new BedrockAgentCoreClient(clientConfig);
    const sessionCommand = new GetBrowserSessionCommand({
      browserIdentifier: browserId,
      sessionId: sessionId,
    });

    const sessionResponse = await client.send(sessionCommand);

    // Session is valid if status is READY
    const isValid = sessionResponse.status === 'READY';

    return NextResponse.json({
      isValid,
      status: sessionResponse.status,
      sessionId: sessionId,
      browserId: browserId,
      streams: sessionResponse.streams,
      viewPort: sessionResponse.viewPort,
      lastUpdatedAt: sessionResponse.lastUpdatedAt,
    });

  } catch (error: any) {
    console.error('Failed to validate browser session:', error);

    // If session not found or any AWS error, consider it invalid
    return NextResponse.json(
      {
        isValid: false,
        error: error.message || 'Session validation failed',
        code: error.name
      },
      { status: 200 } // Return 200 to avoid error handling, just mark as invalid
    );
  }
}
