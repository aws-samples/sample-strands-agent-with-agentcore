import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ chartId: string }> }
) {
  const params = await context.params;
  try {
    const { chartId } = params;
    
    // Remove .json extension if present
    const cleanChartId = chartId.replace('.json', '');
    
    // Get session_id and tool_use_id from query parameters or headers
    const sessionId = request.nextUrl.searchParams.get('session_id') || 
                     request.headers.get('X-Session-ID');
    const toolUseId = request.nextUrl.searchParams.get('tool_use_id');
    
    if (!sessionId) {
      console.error('No session_id provided for chart request');
      return NextResponse.json(
        { error: 'Session ID is required for chart access' },
        { status: 400 }
      );
    }
    
    // toolUseId is optional for backward compatibility
    // If not provided, the backend will try legacy lookup
    
    // Fetch chart data from AgentCore Runtime
    // Chart data is now directly sent via SSE, but this endpoint remains for backward compatibility
    const agentCoreUrl = process.env.NODE_ENV === 'production'
      ? process.env.AGENTCORE_URL || 'http://localhost:8080'
      : 'http://localhost:8080';

    const chartUrl = `${agentCoreUrl}/charts/${cleanChartId}?session_id=${sessionId}&tool_use_id=${toolUseId}`;
    
    const response = await fetch(chartUrl, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch chart data from ${chartUrl}: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: `Chart not found: ${cleanChartId}` },
        { status: 404 }
      );
    }
    
    const chartData = await response.json();
    
    return NextResponse.json(chartData, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
