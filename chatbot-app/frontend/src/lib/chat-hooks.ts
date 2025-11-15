/**
 * Chat Hooks - Lifecycle hooks for chat requests
 *
 * Provides a clean way to execute pre/post processing logic
 * before and after AgentCore Runtime invocation
 */

import type { NextRequest } from 'next/server'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

// ============================================================
// Hook Context Types
// ============================================================

export interface ChatHookContext {
  // Request info
  userId: string
  sessionId: string
  message: string

  // Configuration
  modelConfig: {
    model_id: string
    temperature: number
    system_prompt: string
    caching_enabled: boolean
  }
  enabledTools: string[]

  // Optional metadata
  files?: any[]
  metadata?: Record<string, any>
}

export interface HookResult {
  success: boolean
  error?: Error
  data?: any
}

// ============================================================
// Hook Interface
// ============================================================

export interface ChatHook {
  name: string
  execute: (context: ChatHookContext) => Promise<HookResult>
}

// ============================================================
// Built-in Hooks
// ============================================================

/**
 * Session Metadata Hook
 * Creates/updates session metadata for sidebar display
 */
export const sessionMetadataHook: ChatHook = {
  name: 'session-metadata',
  async execute(context: ChatHookContext): Promise<HookResult> {
    try {
      console.log(`[Hook:${this.name}] Upserting session metadata for ${context.sessionId}`)

      if (IS_LOCAL) {
        // Local: Use file-based session store
        const { upsertSession, getSession } = await import('@/lib/local-session-store')
        const existingSession = getSession(context.userId, context.sessionId)

        upsertSession(context.userId, context.sessionId, {
          title: existingSession?.title || context.message.substring(0, 50) + (context.message.length > 50 ? '...' : ''),
          lastMessageAt: new Date().toISOString(),
          messageCount: (existingSession?.messageCount || 0) + 1,
        })

        console.log(`[Hook:${this.name}] ✅ Local session metadata upserted (count: ${(existingSession?.messageCount || 0) + 1})`)
      } else {
        // AWS: Use DynamoDB
        const { upsertSession, getSession } = await import('@/lib/dynamodb-client')
        const existingSession = await getSession(context.userId, context.sessionId)

        await upsertSession(context.userId, context.sessionId, {
          title: existingSession?.title || context.message.substring(0, 50) + (context.message.length > 50 ? '...' : ''),
          lastMessageAt: new Date().toISOString(),
          messageCount: (existingSession?.messageCount || 0) + 1,
        })

        console.log(`[Hook:${this.name}] ✅ DynamoDB session metadata upserted (count: ${(existingSession?.messageCount || 0) + 1})`)
      }

      return { success: true }
    } catch (error) {
      console.error(`[Hook:${this.name}] ❌ Failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      }
    }
  }
}

/**
 * Tool Configuration Hook
 * Saves user's enabled tools configuration
 */
export const toolConfigurationHook: ChatHook = {
  name: 'tool-configuration',
  async execute(context: ChatHookContext): Promise<HookResult> {
    try {
      // Only save if tools were explicitly provided in request
      if (!context.enabledTools || context.enabledTools.length === 0) {
        console.log(`[Hook:${this.name}] ⏭️  No tools to save, skipping`)
        return { success: true }
      }

      console.log(`[Hook:${this.name}] Saving enabled tools: ${context.enabledTools.length} tools`)

      if (context.userId === 'anonymous') {
        // Anonymous user - save to local file storage
        const { updateUserEnabledTools } = await import('@/lib/local-tool-store')
        updateUserEnabledTools(context.userId, context.enabledTools)
        console.log(`[Hook:${this.name}] ✅ Anonymous user tools saved to local file`)
      } else {
        // Authenticated user
        if (IS_LOCAL) {
          const { updateUserEnabledTools } = await import('@/lib/local-tool-store')
          updateUserEnabledTools(context.userId, context.enabledTools)
          console.log(`[Hook:${this.name}] ✅ User tools saved to local file`)
        } else {
          const { updateUserEnabledTools } = await import('@/lib/dynamodb-client')
          await updateUserEnabledTools(context.userId, context.enabledTools)
          console.log(`[Hook:${this.name}] ✅ User tools saved to DynamoDB`)
        }
      }

      return { success: true }
    } catch (error) {
      console.error(`[Hook:${this.name}] ❌ Failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      }
    }
  }
}

/**
 * Model Configuration Hook
 * Saves user's model preferences (if changed)
 */
export const modelConfigurationHook: ChatHook = {
  name: 'model-configuration',
  async execute(context: ChatHookContext): Promise<HookResult> {
    try {
      // TODO: Implement model config saving if needed
      // For now, this is a placeholder for future model preference persistence
      console.log(`[Hook:${this.name}] ⏭️  Skipping (not implemented)`)
      return { success: true }
    } catch (error) {
      console.error(`[Hook:${this.name}] ❌ Failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      }
    }
  }
}

// ============================================================
// Hook Manager
// ============================================================

export class ChatHookManager {
  private beforeHooks: ChatHook[] = []
  private afterHooks: ChatHook[] = []

  /**
   * Register a hook to run before AgentCore invocation
   */
  registerBeforeHook(hook: ChatHook): void {
    this.beforeHooks.push(hook)
    console.log(`[HookManager] Registered before hook: ${hook.name}`)
  }

  /**
   * Register a hook to run after AgentCore invocation
   */
  registerAfterHook(hook: ChatHook): void {
    this.afterHooks.push(hook)
    console.log(`[HookManager] Registered after hook: ${hook.name}`)
  }

  /**
   * Execute all before hooks
   */
  async executeBeforeHooks(context: ChatHookContext): Promise<void> {
    console.log(`[HookManager] Executing ${this.beforeHooks.length} before hooks...`)

    for (const hook of this.beforeHooks) {
      const result = await hook.execute(context)

      if (!result.success) {
        console.warn(`[HookManager] Hook "${hook.name}" failed, but continuing...`, result.error)
        // Don't throw - hooks should not block the main flow
      }
    }

    console.log(`[HookManager] ✅ All before hooks completed`)
  }

  /**
   * Execute all after hooks
   */
  async executeAfterHooks(context: ChatHookContext): Promise<void> {
    console.log(`[HookManager] Executing ${this.afterHooks.length} after hooks...`)

    for (const hook of this.afterHooks) {
      const result = await hook.execute(context)

      if (!result.success) {
        console.warn(`[HookManager] Hook "${hook.name}" failed, but continuing...`, result.error)
      }
    }

    console.log(`[HookManager] ✅ All after hooks completed`)
  }
}

// ============================================================
// Default Hook Configuration
// ============================================================

/**
 * Create default hook manager with built-in hooks
 */
export function createDefaultHookManager(): ChatHookManager {
  const manager = new ChatHookManager()

  // Register before hooks (run before AgentCore invocation)
  manager.registerBeforeHook(sessionMetadataHook)
  manager.registerBeforeHook(toolConfigurationHook)
  // manager.registerBeforeHook(modelConfigurationHook) // Disabled for now

  // Register after hooks (run after AgentCore response)
  // (none yet, but could add analytics, logging, etc.)

  return manager
}
