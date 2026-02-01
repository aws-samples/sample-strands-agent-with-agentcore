/**
 * Local Session Store - File-based session metadata for development
 * Used for storing session metadata (title, message count, etc.)
 * Actual conversation messages are managed by FileSessionManager in AgentCore
 */

import fs from 'fs'
import path from 'path'
import type { SessionMetadata } from './dynamodb-schema'

const STORE_DIR = path.join(process.cwd(), '.local-store')
const USER_SESSIONS_FILE = path.join(STORE_DIR, 'user-sessions.json')

// Session store structure: { [userId]: SessionMetadata[] }
type SessionStore = Record<string, SessionMetadata[]>

/**
 * Validate sessionId to prevent path traversal attacks
 * Only allows alphanumeric characters, underscores, and hyphens
 */
function validateSessionId(sessionId: string): boolean {
  // Must be non-empty and contain only safe characters
  if (!sessionId || typeof sessionId !== 'string') {
    return false
  }
  // Only allow alphanumeric, underscore, and hyphen (no dots, slashes, etc.)
  return /^[a-zA-Z0-9_-]+$/.test(sessionId)
}

/**
 * Validate userId to prevent path traversal attacks
 */
function validateUserId(userId: string): boolean {
  if (!userId || typeof userId !== 'string') {
    return false
  }
  // Allow alphanumeric, underscore, hyphen, and @ for email-based userIds
  return /^[a-zA-Z0-9_@.-]+$/.test(userId)
}

/**
 * Validate agentId to prevent path traversal attacks
 * Only allows known agent IDs
 */
function validateAgentId(agentId: string): boolean {
  const ALLOWED_AGENT_IDS = ['default', 'voice']
  return ALLOWED_AGENT_IDS.includes(agentId)
}

/**
 * Validate that a resolved path stays within the expected base directory
 */
function isPathWithinBase(filePath: string, baseDir: string): boolean {
  const resolvedPath = path.resolve(filePath)
  const resolvedBase = path.resolve(baseDir)
  return resolvedPath.startsWith(resolvedBase + path.sep) || resolvedPath === resolvedBase
}

// Ensure store directory exists
function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

// Load all session metadata
function loadSessionStore(): SessionStore {
  ensureStoreDir()

  if (!fs.existsSync(USER_SESSIONS_FILE)) {
    return {}
  }

  try {
    const content = fs.readFileSync(USER_SESSIONS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error('[LocalSessionStore] Failed to load store:', error)
    return {}
  }
}

// Save all session metadata
function saveSessionStore(store: SessionStore) {
  ensureStoreDir()

  try {
    fs.writeFileSync(USER_SESSIONS_FILE, JSON.stringify(store, null, 2), 'utf-8')
  } catch (error) {
    console.error('[LocalSessionStore] Failed to save store:', error)
    throw error
  }
}

/**
 * Get all sessions for a user
 */
export function getUserSessions(
  userId: string,
  limit: number = 20,
  status?: 'active' | 'archived' | 'deleted'
): SessionMetadata[] {
  const store = loadSessionStore()
  let sessions = store[userId] || []

  // Filter by status - default to 'active' if not specified
  const filterStatus = status || 'active'
  sessions = sessions.filter((s) => s.status === filterStatus)

  // Sort by lastMessageAt descending (newest first)
  sessions.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

  // Limit results
  return sessions.slice(0, limit)
}

/**
 * Get specific session
 */
export function getSession(userId: string, sessionId: string): SessionMetadata | null {
  // Validate inputs to prevent path traversal
  if (!validateUserId(userId) || !validateSessionId(sessionId)) {
    console.error(`[LocalSessionStore] Invalid userId or sessionId format`)
    return null
  }

  const store = loadSessionStore()
  const sessions = store[userId] || []
  return sessions.find((s) => s.sessionId === sessionId) || null
}

/**
 * Create or update session
 */
export function upsertSession(
  userId: string,
  sessionId: string,
  data: {
    title?: string
    messageCount?: number
    lastMessageAt?: string
    status?: 'active' | 'archived' | 'deleted'
    starred?: boolean
    tags?: string[]
    metadata?: SessionMetadata['metadata']
  }
): SessionMetadata {
  // Validate inputs to prevent path traversal
  if (!validateUserId(userId) || !validateSessionId(sessionId)) {
    console.error(`[LocalSessionStore] Invalid userId or sessionId format`)
    throw new Error('Invalid userId or sessionId format')
  }

  const store = loadSessionStore()
  const sessions = store[userId] || []

  const existingIndex = sessions.findIndex((s) => s.sessionId === sessionId)
  const now = new Date().toISOString()

  let session: SessionMetadata

  if (existingIndex >= 0) {
    // Update existing session
    session = {
      ...sessions[existingIndex],
      ...data,
      lastMessageAt: data.lastMessageAt || sessions[existingIndex].lastMessageAt,
      messageCount: data.messageCount ?? sessions[existingIndex].messageCount,
    }
    sessions[existingIndex] = session
  } else {
    // Create new session
    session = {
      sessionId,
      userId,
      title: data.title || 'New Conversation',
      status: data.status || 'active',
      createdAt: now,
      lastMessageAt: data.lastMessageAt || now,
      messageCount: data.messageCount ?? 0,
      starred: data.starred ?? false,
      tags: data.tags || [],
      metadata: data.metadata || {},
    }
    sessions.push(session)
  }

  store[userId] = sessions
  saveSessionStore(store)

  console.log(`[LocalSessionStore] Session upserted for user ${userId}: ${sessionId}`)
  return session
}

/**
 * Update session
 */
export function updateSession(
  userId: string,
  sessionId: string,
  updates: {
    title?: string
    messageCount?: number
    lastMessageAt?: string
    status?: 'active' | 'archived' | 'deleted'
    starred?: boolean
    tags?: string[]
    metadata?: Partial<SessionMetadata['metadata']>
  }
): void {
  // Validate inputs to prevent path traversal
  if (!validateUserId(userId) || !validateSessionId(sessionId)) {
    console.error(`[LocalSessionStore] Invalid userId or sessionId format`)
    throw new Error('Invalid userId or sessionId format')
  }

  const existingSession = getSession(userId, sessionId)

  if (!existingSession) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  // Deep merge metadata.messages to preserve existing message metadata
  const mergedMetadata = {
    ...(existingSession.metadata || {}),
    ...(updates.metadata || {}),
  }

  // Deep merge messages object if both exist
  if (existingSession.metadata?.messages || updates.metadata?.messages) {
    mergedMetadata.messages = {
      ...(existingSession.metadata?.messages || {}),
      ...(updates.metadata?.messages || {}),
    }
  }

  upsertSession(userId, sessionId, {
    ...existingSession,
    ...updates,
    metadata: mergedMetadata,
  })

  console.log(`[LocalSessionStore] Session updated for user ${userId}: ${sessionId}`)
}

/**
 * Delete session (mark as deleted)
 */
export function deleteSession(userId: string, sessionId: string): void {
  updateSession(userId, sessionId, { status: 'deleted' })
  console.log(`[LocalSessionStore] Session deleted for user ${userId}: ${sessionId}`)
}

/**
 * Archive session
 */
export function archiveSession(userId: string, sessionId: string): void {
  updateSession(userId, sessionId, { status: 'archived' })
  console.log(`[LocalSessionStore] Session archived for user ${userId}: ${sessionId}`)
}

/**
 * Toggle session star
 */
export function toggleSessionStar(userId: string, sessionId: string): boolean {
  const session = getSession(userId, sessionId)

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  const newStarredState = !session.starred
  updateSession(userId, sessionId, { starred: newStarredState })

  console.log(`[LocalSessionStore] Session star toggled for user ${userId}: ${sessionId} -> ${newStarredState}`)
  return newStarredState
}

/**
 * Clear all sessions for a user
 */
export function clearUserSessions(userId: string): void {
  const store = loadSessionStore()
  delete store[userId]
  saveSessionStore(store)
  console.log(`[LocalSessionStore] Cleared all sessions for user ${userId}`)
}

/**
 * Read messages from a specific agent directory
 */
function readAgentMessages(
  sessionDir: string,
  agentId: string,
  baseDir: string
): Array<{ message: any; timestamp: string; source: string }> {
  // Validate agentId (only allow known values)
  if (!validateAgentId(agentId)) {
    console.error(`[LocalSessionStore] Invalid agentId: ${agentId}`)
    return []
  }

  const messagesDir = path.resolve(sessionDir, 'agents', `agent_${agentId}`, 'messages')

  // Verify path stays within base directory
  if (!messagesDir.startsWith(path.resolve(baseDir) + path.sep)) {
    console.error(`[LocalSessionStore] Path traversal attempt detected`)
    return []
  }

  if (!fs.existsSync(messagesDir)) {
    return []
  }

  const messageFiles = fs.readdirSync(messagesDir)
    .filter(f => f.startsWith('message_') && f.endsWith('.json'))

  return messageFiles.map(filename => {
    // Validate filename format strictly
    if (!/^message_\d+\.json$/.test(filename)) {
      return null
    }
    const filePath = path.resolve(messagesDir, filename)

    // Double-check path stays within base
    if (!filePath.startsWith(path.resolve(baseDir) + path.sep)) {
      return null
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const messageData = JSON.parse(content)

    return {
      message: messageData.message,
      timestamp: messageData.created_at || new Date().toISOString(),
      source: agentId, // Track which agent created this message
    }
  }).filter((msg): msg is NonNullable<typeof msg> => msg !== null)
}

/**
 * Get conversation messages for a session from AgentCore Runtime storage
 * This reads directly from the agentcore sessions directory
 *
 * Reads from both text (agent_default) and voice (agent_voice) agent directories
 * and merges them by timestamp for mixed text/voice conversations.
 */
export function getSessionMessages(sessionId: string): any[] {
  try {
    // Validate and sanitize sessionId to prevent path traversal
    if (!validateSessionId(sessionId)) {
      console.error(`[LocalSessionStore] Invalid sessionId format: ${sessionId}`)
      throw new Error('Invalid session ID format')
    }
    const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '')

    // Path to AgentCore Runtime storage
    const agentcoreSessionsDir = path.resolve(process.cwd(), '..', 'agentcore', 'sessions')
    const sessionDir = path.resolve(agentcoreSessionsDir, `session_${sanitizedSessionId}`)

    // Double-check path is within base
    if (!sessionDir.startsWith(agentcoreSessionsDir + path.sep)) {
      console.error(`[LocalSessionStore] Path traversal attempt detected`)
      return []
    }

    if (!fs.existsSync(sessionDir)) {
      console.log(`[LocalSessionStore] Session directory not found: ${sessionDir}`)
      return []
    }

    // Read messages from both text and voice agents
    const textMessages = readAgentMessages(sessionDir, 'default', agentcoreSessionsDir)
    const voiceMessages = readAgentMessages(sessionDir, 'voice', agentcoreSessionsDir)

    console.log(`[LocalSessionStore] Found ${textMessages.length} text messages, ${voiceMessages.length} voice messages`)

    // Merge all messages
    const allMessages = [...textMessages, ...voiceMessages]

    // Sort by timestamp to reconstruct the conversation chronologically
    allMessages.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    // Format messages for frontend
    const messages = allMessages.map((item, index) => ({
      ...item.message, // Contains role and content array
      id: `msg-${sessionId}-${index}`,
      timestamp: item.timestamp,
      isVoiceMessage: item.source === 'voice', // Mark voice messages for UI distinction
    }))

    console.log(`[LocalSessionStore] Loaded ${messages.length} total messages (merged)`)
    return messages
  } catch (error) {
    console.error('[LocalSessionStore] Failed to load session messages:', error)
    return []
  }
}

/**
 * Get artifacts for a session from agent state
 */
export function getSessionArtifacts(sessionId: string): any[] {
  try {
    // Validate and sanitize sessionId to prevent path traversal
    if (!validateSessionId(sessionId)) {
      console.error(`[LocalSessionStore] Invalid sessionId format: ${sessionId}`)
      throw new Error('Invalid session ID format')
    }
    // Sanitize: only keep alphanumeric, underscore, hyphen
    const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '')

    // Path to AgentCore Runtime storage
    const agentcoreSessionsDir = path.resolve(process.cwd(), '..', 'agentcore', 'sessions')
    const sessionDir = path.resolve(agentcoreSessionsDir, `session_${sanitizedSessionId}`)

    // Double-check path is within base (defense in depth)
    if (!sessionDir.startsWith(agentcoreSessionsDir + path.sep)) {
      console.error(`[LocalSessionStore] Path traversal attempt detected`)
      return []
    }

    if (!fs.existsSync(sessionDir)) {
      console.log(`[LocalSessionStore] Session directory not found for artifacts: ${sessionDir}`)
      return []
    }

    // Read agent.json from default agent (artifacts are stored in ChatAgent state)
    const agentJsonPath = path.resolve(sessionDir, 'agents', 'agent_default', 'agent.json')

    // Double-check path is within base
    if (!agentJsonPath.startsWith(agentcoreSessionsDir + path.sep)) {
      console.error(`[LocalSessionStore] Path traversal attempt detected`)
      return []
    }

    if (!fs.existsSync(agentJsonPath)) {
      console.log(`[LocalSessionStore] No agent.json found for artifacts`)
      return []
    }

    // Read and parse agent.json
    const agentData = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'))
    const artifacts = agentData?.state?.artifacts || {}

    // Convert artifacts object to array
    const artifactsArray = Object.values(artifacts)

    console.log(`[LocalSessionStore] Loaded ${artifactsArray.length} artifacts for session ${sessionId}`)
    return artifactsArray
  } catch (error) {
    console.error('[LocalSessionStore] Failed to load session artifacts:', error)
    return []
  }
}
