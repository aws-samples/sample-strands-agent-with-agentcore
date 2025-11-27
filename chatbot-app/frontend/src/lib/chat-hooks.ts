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
      if (IS_LOCAL) {
        const { upsertSession, getSession } = await import('@/lib/local-session-store')
        const existingSession = getSession(context.userId, context.sessionId)

        upsertSession(context.userId, context.sessionId, {
          title: existingSession?.title || context.message.substring(0, 50) + (context.message.length > 50 ? '...' : ''),
          lastMessageAt: new Date().toISOString(),
          messageCount: (existingSession?.messageCount || 0) + 1,
        })
      } else {
        const { upsertSession, getSession } = await import('@/lib/dynamodb-client')
        const existingSession = await getSession(context.userId, context.sessionId)

        await upsertSession(context.userId, context.sessionId, {
          title: existingSession?.title || context.message.substring(0, 50) + (context.message.length > 50 ? '...' : ''),
          lastMessageAt: new Date().toISOString(),
          messageCount: (existingSession?.messageCount || 0) + 1,
        })
      }

      return { success: true }
    } catch (error) {
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
      // Skip if enabledTools is not provided (undefined/null)
      // But allow empty array [] to be saved (user disabled all tools)
      if (context.enabledTools === undefined || context.enabledTools === null) {
        return { success: true }
      }

      if (context.userId === 'anonymous') {
        const { updateUserEnabledTools } = await import('@/lib/local-tool-store')
        updateUserEnabledTools(context.userId, context.enabledTools)
      } else {
        if (IS_LOCAL) {
          const { updateUserEnabledTools } = await import('@/lib/local-tool-store')
          updateUserEnabledTools(context.userId, context.enabledTools)
        } else {
          const { updateUserEnabledTools } = await import('@/lib/dynamodb-client')
          await updateUserEnabledTools(context.userId, context.enabledTools)
        }
      }

      return { success: true }
    } catch (error) {
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
      return { success: true }
    } catch (error) {
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

  registerBeforeHook(hook: ChatHook): void {
    this.beforeHooks.push(hook)
  }

  registerAfterHook(hook: ChatHook): void {
    this.afterHooks.push(hook)
  }

  async executeBeforeHooks(context: ChatHookContext): Promise<void> {
    for (const hook of this.beforeHooks) {
      const result = await hook.execute(context)
      if (!result.success) {
        console.warn(`[Hook:${hook.name}] Failed:`, result.error)
      }
    }
  }

  async executeAfterHooks(context: ChatHookContext): Promise<void> {
    for (const hook of this.afterHooks) {
      const result = await hook.execute(context)
      if (!result.success) {
        console.warn(`[Hook:${hook.name}] Failed:`, result.error)
      }
    }
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
