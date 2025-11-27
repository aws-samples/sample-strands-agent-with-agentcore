/**
 * Local Tool Store - File-based user preferences for development
 * Used instead of DynamoDB in local development mode
 * Stores both tool preferences and model configurations
 */

import fs from 'fs'
import path from 'path'

const STORE_DIR = path.join(process.cwd(), '.local-store')
const USER_TOOLS_FILE = path.join(STORE_DIR, 'user-tools.json')
const USER_MODEL_CONFIG_FILE = path.join(STORE_DIR, 'user-model-config.json')

// Model configuration interface
interface ModelConfig {
  model_id?: string
  temperature?: number
  system_prompt?: string // Deprecated: kept for backwards compatibility
  caching_enabled?: boolean
  selectedPromptId?: string // New: prompt ID (general, code, research, rag, custom)
  customPromptText?: string // New: custom prompt text for 'custom' promptId
}

// Ensure store directory exists
function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

// Load all user tool preferences
function loadToolStore(): Record<string, string[]> {
  ensureStoreDir()

  if (!fs.existsSync(USER_TOOLS_FILE)) {
    return {}
  }

  try {
    const content = fs.readFileSync(USER_TOOLS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error('[LocalToolStore] Failed to load tool store:', error)
    return {}
  }
}

// Save all user tool preferences
function saveToolStore(store: Record<string, string[]>) {
  ensureStoreDir()

  try {
    fs.writeFileSync(USER_TOOLS_FILE, JSON.stringify(store, null, 2), 'utf-8')
  } catch (error) {
    console.error('[LocalToolStore] Failed to save tool store:', error)
    throw error
  }
}

// Load all user model configurations
function loadModelConfigStore(): Record<string, ModelConfig> {
  ensureStoreDir()

  if (!fs.existsSync(USER_MODEL_CONFIG_FILE)) {
    return {}
  }

  try {
    const content = fs.readFileSync(USER_MODEL_CONFIG_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error('[LocalToolStore] Failed to load model config store:', error)
    return {}
  }
}

// Save all user model configurations
function saveModelConfigStore(store: Record<string, ModelConfig>) {
  ensureStoreDir()

  try {
    fs.writeFileSync(USER_MODEL_CONFIG_FILE, JSON.stringify(store, null, 2), 'utf-8')
  } catch (error) {
    console.error('[LocalToolStore] Failed to save model config store:', error)
    throw error
  }
}

// ============================================================
// Tool Preferences
// ============================================================

/**
 * Get enabled tools for a user
 */
export function getUserEnabledTools(userId: string): string[] {
  const store = loadToolStore()
  return store[userId] || []
}

/**
 * Update enabled tools for a user
 */
export function updateUserEnabledTools(userId: string, enabledTools: string[]): void {
  const store = loadToolStore()
  store[userId] = enabledTools
  saveToolStore(store)
  console.log(`[LocalToolStore] Updated tools for user ${userId}:`, enabledTools)
}

/**
 * Clear enabled tools for a user
 */
export function clearUserEnabledTools(userId: string): void {
  const store = loadToolStore()
  delete store[userId]
  saveToolStore(store)
  console.log(`[LocalToolStore] Cleared tools for user ${userId}`)
}

/**
 * Get all users with tool preferences
 */
export function getAllUsers(): string[] {
  const store = loadToolStore()
  return Object.keys(store)
}

// ============================================================
// Model Configuration
// ============================================================

/**
 * Get model configuration for a user
 */
export function getUserModelConfig(userId: string): ModelConfig | null {
  const store = loadModelConfigStore()
  return store[userId] || null
}

/**
 * Update model configuration for a user
 */
export function updateUserModelConfig(userId: string, config: ModelConfig): void {
  const store = loadModelConfigStore()
  store[userId] = config
  saveModelConfigStore(store)
  console.log(`[LocalToolStore] Updated model config for user ${userId}:`, config)
}

/**
 * Clear model configuration for a user
 */
export function clearUserModelConfig(userId: string): void {
  const store = loadModelConfigStore()
  delete store[userId]
  saveModelConfigStore(store)
  console.log(`[LocalToolStore] Cleared model config for user ${userId}`)
}
