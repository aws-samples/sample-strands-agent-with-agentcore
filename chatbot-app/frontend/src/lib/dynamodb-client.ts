/**
 * DynamoDB Client for User and Session Management
 * Single Table Design: PK=userId, SK=record type
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type {
  UserProfile,
  UserPreferences,
  SessionMetadata,
  UserProfileRecord,
  SessionRecord,
} from './dynamodb-schema'
import {
  generateSessionSK,
  parseSessionSK,
  userRecordToProfile,
  sessionRecordToMetadata,
} from './dynamodb-schema'

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'strands-agent-chatbot-users'

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({ region: AWS_REGION })

// ============================================================
// User Profile Operations
// ============================================================

/**
 * Get user profile
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const command = new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        userId,
        sk: 'PROFILE',
      }),
    })

    const response = await dynamoClient.send(command)

    if (!response.Item) {
      return null
    }

    const record = unmarshall(response.Item) as UserProfileRecord
    return userRecordToProfile(record)
  } catch (error) {
    console.error('[DynamoDB] Error getting user profile:', error)
    throw error
  }
}

/**
 * Create or update user profile
 */
export async function upsertUserProfile(
  userId: string,
  email: string,
  username?: string,
  preferences?: Partial<UserPreferences>
): Promise<UserProfile> {
  try {
    const now = new Date().toISOString()

    // Get existing profile to preserve createdAt
    const existingProfile = await getUserProfile(userId)

    const record: UserProfileRecord = {
      userId,
      sk: 'PROFILE',
      email,
      username,
      createdAt: existingProfile?.createdAt || now,
      lastAccessAt: now,
      preferences: {
        ...(existingProfile?.preferences || {}),
        ...preferences,
      },
    }

    const command = new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(record),
    })

    await dynamoClient.send(command)

    console.log(`[DynamoDB] User profile created/updated: ${userId}`)
    return userRecordToProfile(record)
  } catch (error) {
    console.error('[DynamoDB] Error upserting user profile:', error)
    throw error
  }
}

/**
 * Update user preferences
 */
export async function updateUserPreferences(
  userId: string,
  preferences: Partial<UserPreferences>
): Promise<void> {
  try {
    const profile = await getUserProfile(userId)

    if (!profile) {
      throw new Error(`User profile not found: ${userId}`)
    }

    const updatedPreferences: UserPreferences = {
      ...(profile.preferences || {}),
      ...preferences,
    }

    const now = new Date().toISOString()

    const command = new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        userId,
        sk: 'PROFILE',
      }),
      UpdateExpression: 'SET preferences = :prefs, lastAccessAt = :lastAccess',
      ExpressionAttributeValues: marshall({
        ':prefs': updatedPreferences,
        ':lastAccess': now,
      }),
    })

    await dynamoClient.send(command)

    console.log(`[DynamoDB] User preferences updated: ${userId}`)
  } catch (error) {
    console.error('[DynamoDB] Error updating user preferences:', error)
    throw error
  }
}

/**
 * Get enabled tools for a user
 */
export async function getUserEnabledTools(userId: string): Promise<string[]> {
  try {
    const profile = await getUserProfile(userId)

    if (!profile || !profile.preferences) {
      return []
    }

    return profile.preferences.enabledTools || []
  } catch (error) {
    console.error('[DynamoDB] Error getting enabled tools:', error)
    return []
  }
}

/**
 * Update enabled tools for a user
 */
export async function updateUserEnabledTools(
  userId: string,
  enabledTools: string[]
): Promise<void> {
  try {
    await updateUserPreferences(userId, { enabledTools })
    console.log(`[DynamoDB] Enabled tools updated for ${userId}:`, enabledTools)
  } catch (error) {
    console.error('[DynamoDB] Error updating enabled tools:', error)
    throw error
  }
}

/**
 * Toggle specific tool (deprecated - use updateUserEnabledTools)
 */
export async function toggleUserTool(
  userId: string,
  toolId: string,
  enabled: boolean
): Promise<string[]> {
  try {
    const currentTools = await getUserEnabledTools(userId)
    let updatedTools: string[]

    if (enabled) {
      updatedTools = currentTools.includes(toolId) ? currentTools : [...currentTools, toolId]
    } else {
      updatedTools = currentTools.filter((t) => t !== toolId)
    }

    await updateUserEnabledTools(userId, updatedTools)
    return updatedTools
  } catch (error) {
    console.error('[DynamoDB] Error toggling tool:', error)
    throw error
  }
}

// ============================================================
// Session Operations
// ============================================================

/**
 * Create or update session metadata
 */
export async function upsertSession(
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
): Promise<SessionMetadata> {
  try {
    const now = new Date().toISOString()

    // Try to get existing session
    const existingSession = await getSession(userId, sessionId)

    const record: SessionRecord = {
      userId,
      sk: existingSession?.sk || generateSessionSK(sessionId, now),
      sessionId,
      title: data.title || existingSession?.title || 'New Conversation',
      status: data.status || existingSession?.status || 'active',
      createdAt: existingSession?.createdAt || now,
      lastMessageAt: data.lastMessageAt || existingSession?.lastMessageAt || now,
      messageCount: data.messageCount ?? existingSession?.messageCount ?? 0,
      starred: data.starred ?? existingSession?.starred ?? false,
      tags: data.tags || existingSession?.tags || [],
      metadata: {
        ...(existingSession?.metadata || {}),
        ...(data.metadata || {}),
      },
    }

    const command = new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(record),
    })

    await dynamoClient.send(command)

    console.log(`[DynamoDB] Session upserted: ${sessionId}`)
    return sessionRecordToMetadata(record)
  } catch (error) {
    console.error('[DynamoDB] Error upserting session:', error)
    throw error
  }
}

/**
 * Get specific session metadata
 */
export async function getSession(
  userId: string,
  sessionId: string
): Promise<SessionMetadata | null> {
  try {
    // Query all sessions for this user and find the matching sessionId
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :userId AND begins_with(sk, :sessionPrefix)',
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':sessionPrefix': 'SESSION#',
      }),
    })

    const response = await dynamoClient.send(command)

    if (!response.Items || response.Items.length === 0) {
      return null
    }

    // Find the session with matching sessionId
    const sessionRecord = response.Items.map((item) => unmarshall(item) as SessionRecord).find(
      (record) => record.sessionId === sessionId
    )

    if (!sessionRecord) {
      return null
    }

    return sessionRecordToMetadata(sessionRecord)
  } catch (error) {
    console.error('[DynamoDB] Error getting session:', error)
    return null
  }
}

/**
 * Get user's sessions (sorted by lastMessageAt descending)
 */
export async function getUserSessions(
  userId: string,
  limit: number = 20,
  status?: 'active' | 'archived' | 'deleted'
): Promise<SessionMetadata[]> {
  try {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :userId AND begins_with(sk, :sessionPrefix)',
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':sessionPrefix': 'SESSION#',
      }),
      ScanIndexForward: false, // Descending order (newest first)
      Limit: limit,
    })

    const response = await dynamoClient.send(command)

    if (!response.Items || response.Items.length === 0) {
      return []
    }

    let sessions = response.Items.map((item) => {
      const record = unmarshall(item) as SessionRecord
      return sessionRecordToMetadata(record)
    })

    // Filter by status if provided
    if (status) {
      sessions = sessions.filter((s) => s.status === status)
    }

    // Sort by lastMessageAt descending
    sessions.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    console.log(`[DynamoDB] Retrieved ${sessions.length} sessions for user ${userId}`)
    return sessions
  } catch (error) {
    console.error('[DynamoDB] Error getting user sessions:', error)
    return []
  }
}

/**
 * Update session metadata
 */
export async function updateSession(
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
): Promise<void> {
  try {
    // Get existing session to preserve SK and other fields
    const existingSession = await getSession(userId, sessionId)

    if (!existingSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Upsert with updated values
    await upsertSession(userId, sessionId, {
      ...existingSession,
      ...updates,
    })

    console.log(`[DynamoDB] Session updated: ${sessionId}`)
  } catch (error) {
    console.error('[DynamoDB] Error updating session:', error)
    throw error
  }
}

/**
 * Delete session (mark as deleted)
 */
export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  try {
    await updateSession(userId, sessionId, { status: 'deleted' })
    console.log(`[DynamoDB] Session deleted: ${sessionId}`)
  } catch (error) {
    console.error('[DynamoDB] Error deleting session:', error)
    throw error
  }
}

/**
 * Archive session
 */
export async function archiveSession(userId: string, sessionId: string): Promise<void> {
  try {
    await updateSession(userId, sessionId, { status: 'archived' })
    console.log(`[DynamoDB] Session archived: ${sessionId}`)
  } catch (error) {
    console.error('[DynamoDB] Error archiving session:', error)
    throw error
  }
}

/**
 * Toggle session star
 */
export async function toggleSessionStar(userId: string, sessionId: string): Promise<boolean> {
  try {
    const session = await getSession(userId, sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const newStarredState = !session.starred
    await updateSession(userId, sessionId, { starred: newStarredState })

    console.log(`[DynamoDB] Session star toggled: ${sessionId} -> ${newStarredState}`)
    return newStarredState
  } catch (error) {
    console.error('[DynamoDB] Error toggling session star:', error)
    throw error
  }
}
