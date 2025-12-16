/**
 * Tools endpoint - returns available tools with user-specific enabled state
 * Cloud: Loads tool registry from DynamoDB TOOL_REGISTRY + user preferences from DynamoDB
 * Local: Loads tool registry from JSON file + user preferences from local file storage
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import {
  getUserEnabledTools as getDynamoUserEnabledTools,
  getUserProfile,
  upsertUserProfile,
  getToolRegistry
} from '@/lib/dynamodb-client'
import toolsConfigFallback from '@/config/tools-config.json'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'

/**
 * Check if tool registry needs sync by comparing tool counts
 * Returns true if any category has different tool counts
 */
function checkIfRegistryNeedsSync(fallback: any, registry: any): boolean {
  try {
    // Helper to count tools in nested structures
    const countNestedTools = (items: any[] = []) => {
      return items.reduce((sum, item) => {
        if (item.tools && Array.isArray(item.tools)) {
          return sum + item.tools.length
        }
        return sum + 1 // Count the item itself if no nested tools
      }, 0)
    }

    // Compare each category
    const checks = [
      // Local tools
      (fallback.local_tools?.length || 0) !== (registry.local_tools?.length || 0),
      // Builtin tools
      (fallback.builtin_tools?.length || 0) !== (registry.builtin_tools?.length || 0),
      // Browser automation (nested tools)
      countNestedTools(fallback.browser_automation) !== countNestedTools(registry.browser_automation),
      // Gateway targets (nested tools)
      countNestedTools(fallback.gateway_targets) !== countNestedTools(registry.gateway_targets),
      // AgentCore Runtime A2A
      (fallback.agentcore_runtime_a2a?.length || 0) !== (registry.agentcore_runtime_a2a?.length || 0),
    ]

    const needsSync = checks.some(check => check === true)

    if (needsSync) {
      console.log('[API] Tool count comparison:')
      console.log(`  local_tools: ${fallback.local_tools?.length || 0} vs ${registry.local_tools?.length || 0}`)
      console.log(`  builtin_tools: ${fallback.builtin_tools?.length || 0} vs ${registry.builtin_tools?.length || 0}`)
      console.log(`  browser_automation (nested): ${countNestedTools(fallback.browser_automation)} vs ${countNestedTools(registry.browser_automation)}`)
      console.log(`  gateway_targets (nested): ${countNestedTools(fallback.gateway_targets)} vs ${countNestedTools(registry.gateway_targets)}`)
      console.log(`  agentcore_runtime_a2a: ${fallback.agentcore_runtime_a2a?.length || 0} vs ${registry.agentcore_runtime_a2a?.length || 0}`)
    }

    return needsSync
  } catch (error) {
    console.error('[API] Error checking registry sync status:', error)
    return false // On error, don't sync to avoid loops
  }
}

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Step 1: Load tool registry configuration
    let toolsConfig: typeof toolsConfigFallback = toolsConfigFallback
    if (!IS_LOCAL) {
      // Cloud: Load from DynamoDB TOOL_REGISTRY (auto-initializes if not exists)
      const registryFromDDB = await getToolRegistry(toolsConfigFallback)
      if (registryFromDDB) {
        // Auto-sync detection: Compare tool counts to detect changes
        const needsSync = checkIfRegistryNeedsSync(toolsConfigFallback, registryFromDDB)

        if (needsSync) {
          console.log('[API] Tool registry mismatch detected - auto-syncing from tools-config.json...')
          const { initializeToolRegistry } = await import('@/lib/dynamodb-client')
          await initializeToolRegistry(toolsConfigFallback)
          toolsConfig = toolsConfigFallback
          console.log('[API] Tool registry auto-synced successfully')
        } else {
          toolsConfig = registryFromDDB as typeof toolsConfigFallback
          console.log('[API] Tool registry loaded from DynamoDB (no changes detected)')
        }
      } else {
        console.log('[API] Tool registry not found in DynamoDB, using fallback JSON')
      }
    } else {
      console.log('[API] Local mode: using tools-config.json')
    }

    // Step 2: Load user-specific enabled tools
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
      // Anonymous user - load from local file (local) or DynamoDB (AWS)
      if (IS_LOCAL) {
        const { getUserEnabledTools: getLocalUserEnabledTools } = await import('@/lib/local-tool-store')
        enabledToolIds = getLocalUserEnabledTools(userId)
        console.log(`[API] Loaded anonymous user from local file: ${enabledToolIds.length} enabled`)
      } else {
        // AWS: Load from DynamoDB
        const storedTools = await getDynamoUserEnabledTools(userId)
        enabledToolIds = storedTools
        console.log(`[API] Loaded anonymous user from DynamoDB: ${enabledToolIds.length} enabled`)
      }
    }

    // Step 3: Map tools with user-specific enabled state
    const localTools = (toolsConfig.local_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: 'local_tools',
      tool_type: 'local',
      enabled: enabledToolIds.includes(tool.id)
    }))

    const builtinTools = (toolsConfig.builtin_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      icon: tool.icon,
      type: 'builtin_tools',
      tool_type: 'builtin',
      enabled: enabledToolIds.includes(tool.id)
    }))

    // Browser automation tools (separate category)
    const browserAutomation = (toolsConfig.browser_automation || []).map((group: any) => {
      // Check if any tool in the group is enabled (only if group has tools)
      const anyToolEnabled = group.tools && Array.isArray(group.tools)
        ? group.tools.some((tool: any) => enabledToolIds.includes(tool.id))
        : enabledToolIds.includes(group.id)

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        category: group.category,
        icon: group.icon,
        type: 'browser_automation',
        tool_type: 'browser_automation',
        enabled: anyToolEnabled,
        isDynamic: group.isDynamic ?? true,
        tools: group.tools && Array.isArray(group.tools)
          ? group.tools.map((tool: any) => ({
              id: tool.id,
              name: tool.name,
              description: tool.description,
              enabled: enabledToolIds.includes(tool.id)
            }))
          : undefined
      }
    })

    // Gateway tools (grouped like Browser Automation)
    const gatewayTargets = toolsConfig.gateway_targets || []
    const gatewayTools = gatewayTargets.map((target: any) => {
      // Check if any tool in the group is enabled (only if target has tools)
      const anyToolEnabled = target.tools && Array.isArray(target.tools)
        ? target.tools.some((tool: any) => enabledToolIds.includes(tool.id))
        : enabledToolIds.includes(target.id)

      return {
        id: target.id,
        name: target.name,
        description: target.description,
        category: target.category,
        icon: target.icon,
        type: 'gateway',
        tool_type: 'gateway',
        enabled: anyToolEnabled,
        isDynamic: target.isDynamic ?? true,
        tools: target.tools && Array.isArray(target.tools)
          ? target.tools.map((tool: any) => ({
              id: tool.id,
              name: tool.name,
              description: tool.description,
              enabled: enabledToolIds.includes(tool.id)
            }))
          : undefined
      }
    })

    // Runtime A2A agents (grouped)
    const runtimeA2AServers = toolsConfig.agentcore_runtime_a2a || []
    const runtimeA2ATools = runtimeA2AServers.map((server: any) => {
      // For A2A agents, check if the agent itself is enabled (not nested tools)
      const isEnabled = enabledToolIds.includes(server.id)

      return {
        id: server.id,
        name: server.name,
        description: server.description,
        category: server.category,
        icon: server.icon,
        type: 'runtime-a2a',
        tool_type: 'runtime-a2a',
        enabled: isEnabled,
        isDynamic: false,
        runtime_arn: server.runtime_arn
      }
    })

    console.log(`[API] Returning tools for user ${userId} - ${enabledToolIds.length} enabled`)

    return NextResponse.json({
      tools: [...localTools, ...builtinTools, ...browserAutomation, ...gatewayTools, ...runtimeA2ATools]
    })
  } catch (error) {
    console.error('[API] Error loading tools:', error)

    // Fallback: return all tools from fallback config with default enabled state
    const localTools = (toolsConfigFallback.local_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: 'local_tools',
      tool_type: 'local',
      enabled: tool.enabled ?? true
    }))

    const builtinTools = (toolsConfigFallback.builtin_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      icon: tool.icon,
      type: 'builtin_tools',
      tool_type: 'builtin',
      enabled: tool.enabled ?? true
    }))

    // Browser automation tools (fallback - grouped)
    const browserAutomation = (toolsConfigFallback.browser_automation || []).map((group: any) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      category: group.category,
      icon: group.icon,
      type: 'browser_automation',
      tool_type: 'browser_automation',
      enabled: group.enabled ?? true,
      isDynamic: group.isDynamic ?? true,
      tools: group.tools || undefined
    }))

    // Gateway tools (fallback - grouped)
    const gatewayTargets = toolsConfigFallback.gateway_targets || []
    const gatewayTools = gatewayTargets.map((target: any) => ({
      id: target.id,
      name: target.name,
      description: target.description,
      category: target.category,
      icon: target.icon,
      type: 'gateway',
      tool_type: 'gateway',
      enabled: target.enabled ?? false,
      isDynamic: target.isDynamic ?? true,
      tools: target.tools || undefined
    }))

    // Runtime A2A agents (fallback - grouped)
    const runtimeA2AServers = toolsConfigFallback.agentcore_runtime_a2a || []
    const runtimeA2ATools = runtimeA2AServers.map((server: any) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      category: server.category,
      icon: server.icon,
      type: 'runtime-a2a',
      tool_type: 'runtime-a2a',
      enabled: server.enabled ?? false,
      isDynamic: false,
      runtime_arn: server.runtime_arn
    }))

    return NextResponse.json({
      tools: [...localTools, ...builtinTools, ...browserAutomation, ...gatewayTools, ...runtimeA2ATools]
    })
  }
}
