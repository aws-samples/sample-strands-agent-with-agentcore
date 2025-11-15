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

  // Filter by status if provided
  if (status) {
    sessions = sessions.filter((s) => s.status === status)
  }

  // Sort by lastMessageAt descending (newest first)
  sessions.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

  // Limit results
  return sessions.slice(0, limit)
}

/**
 * Get specific session
 */
export function getSession(userId: string, sessionId: string): SessionMetadata | null {
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
  const existingSession = getSession(userId, sessionId)

  if (!existingSession) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  upsertSession(userId, sessionId, {
    ...existingSession,
    ...updates,
    metadata: {
      ...(existingSession.metadata || {}),
      ...(updates.metadata || {}),
    },
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
