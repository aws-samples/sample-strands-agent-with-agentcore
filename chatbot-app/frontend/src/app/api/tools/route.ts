/**
 * Tools endpoint - returns available tools with user-specific enabled state
 * Loads user preferences from DynamoDB (AWS) or local file storage (local)
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserEnabledTools as getDynamoUserEnabledTools, getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'

// All available tools (default catalog)
const ALL_TOOLS = [
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Perform mathematical operations',
    category: 'utilities',
    type: 'local_tools',
    tool_type: 'local'
  },
  {
    id: 'get_current_weather',
    name: 'Weather Lookup',
    description: 'Get current weather information for any US location',
    category: 'utilities',
    type: 'local_tools',
    tool_type: 'local'
  },
  {
    id: 'create_visualization',
    name: 'Visualization Creator',
    description: 'Create interactive charts and visualizations from data',
    category: 'visualization',
    type: 'local_tools',
    tool_type: 'local'
  },
  {
    id: 'ddg_web_search',
    name: 'Web Search',
    description: 'Search the web using DuckDuckGo for information and research',
    category: 'search',
    type: 'local_tools',
    tool_type: 'local'
  },
  {
    id: 'fetch_url_content',
    name: 'URL Fetcher',
    description: 'Fetch and extract text content from web pages',
    category: 'web',
    type: 'local_tools',
    tool_type: 'local'
  }
]

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    let enabledToolIds: string[] = []

    if (userId !== 'anonymous') {
      // Authenticated user - load from DynamoDB (AWS) or local file (local)
      if (IS_LOCAL) {
        // Local: Load from file
        const { getUserEnabledTools: getLocalUserEnabledTools } = await import('@/lib/local-tool-store')
        enabledToolIds = getLocalUserEnabledTools(userId)
        console.log(`[API] Loaded authenticated user ${userId} from local file: ${enabledToolIds.length} enabled`)
      } else {
        // AWS: Load from DynamoDB
        const storedTools = await getDynamoUserEnabledTools(userId)
        const profile = await getUserProfile(userId)

        if (!profile) {
          // New user - initialize with all tools DISABLED (default)
          enabledToolIds = []

          // Create user profile with default preferences (all disabled)
          await upsertUserProfile(userId, user.email || '', user.username, {
            enabledTools: []
          })

          console.log(`[API] Initialized NEW user ${userId} with all tools DISABLED (default)`)
        } else {
          // Existing user - use stored preferences
          enabledToolIds = storedTools
          console.log(`[API] Loaded existing user ${userId} from DynamoDB: ${enabledToolIds.length} enabled`)
        }
      }
    } else {
      // Anonymous user - load from local file storage (works for both local and AWS)
      const { getUserEnabledTools: getLocalUserEnabledTools } = await import('@/lib/local-tool-store')
      enabledToolIds = getLocalUserEnabledTools(userId)
      console.log(`[API] Loaded anonymous user from local file: ${enabledToolIds.length} enabled`)
    }

    // Map tools with user-specific enabled state
    const toolsWithUserState = ALL_TOOLS.map(tool => ({
      ...tool,
      enabled: enabledToolIds.includes(tool.id)
    }))

    console.log(`[API] Returning tools for user ${userId} - ${enabledToolIds.length} enabled`)

    return NextResponse.json({
      tools: toolsWithUserState,
      mcp_servers: []
    })
  } catch (error) {
    console.error('[API] Error loading tools:', error)

    // Fallback: return all tools as enabled on error
    const toolsWithDefaultState = ALL_TOOLS.map(tool => ({
      ...tool,
      enabled: true
    }))

    return NextResponse.json({
      tools: toolsWithDefaultState,
      mcp_servers: []
    })
  }
}
