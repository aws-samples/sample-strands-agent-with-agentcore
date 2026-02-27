import { useCallback, useRef, useState, useEffect } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { AGUIStreamEvent, ChatUIState, AGUI_EVENT_TYPES } from '@/types/events'
import { HttpAgent } from '@ag-ui/client'
import type { RunAgentInput } from '@ag-ui/client'
import { EventType } from '@ag-ui/core'
import { getApiUrl } from '@/config/environment'
import logger from '@/utils/logger'
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth'
import { apiGet, apiPost } from '@/lib/api-client'
import { buildToolMaps, createToolExecution } from '@/utils/messageParser'
import { isSessionTimedOut, getLastActivity, updateLastActivity, clearSessionData, triggerWarmup, generateSessionId } from '@/config/session'
import { isA2ATool } from './usePolling'
import { useSSEReconnect } from './useSSEReconnect'

/**
 * Process swarm message content blocks in order to preserve text/tool interleaving.
 * Returns multiple messages: text -> tool -> text -> tool -> ...
 */
function processSwarmMessageContent(
  msg: any,
  msgIndex: number,
  sessionId: string,
  toolResultMap: Map<string, any>
): Message[] {
  const messages: Message[] = []
  let currentText = ''
  let swarmContext: { agentsUsed: string[]; sharedContext?: Record<string, any> } | undefined = undefined
  let subIndex = 0

  const createTextMessage = (text: string, isLast: boolean): Message => {
    const cleanedText = text.trim()
    return {
      id: `${sessionId}-${msgIndex}-${subIndex++}`,
      text: cleanedText,
      sender: 'bot' as const,
      timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
      // Only add swarmContext to the last message
      ...(isLast && swarmContext && { swarmContext })
    }
  }

  const createToolMessage = (toolUse: any, toolResult: any): Message => {
    const execution = createToolExecution(toolUse, toolResult, msg)
    return {
      id: `${sessionId}-${msgIndex}-${subIndex++}`,
      text: '',
      sender: 'bot' as const,
      timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
      toolExecutions: [execution],
      isToolMessage: true
    }
  }

  if (Array.isArray(msg.content)) {
    // First pass: extract swarm context (same logic as parseSwarmContext)
    for (const item of msg.content) {
      if (item.text?.includes('<swarm_context>')) {
        const contextMatch = item.text.match(/<swarm_context>([\s\S]*?)<\/swarm_context>/)
        if (contextMatch) {
          const contextContent = contextMatch[1]

          // Extract agents_used from the context
          const agentsMatch = contextContent.match(/agents_used:\s*\[(.*?)\]/)
          let agentsUsed: string[] = []
          if (agentsMatch) {
            agentsUsed = agentsMatch[1]
              .split(',')
              .map((s: string) => s.trim().replace(/['"]/g, ''))
              .filter((s: string) => s.length > 0)
          }

          // Extract shared_context for each agent
          const sharedContextData: Record<string, any> = {}
          const lines = contextContent.split('\n')
          for (const line of lines) {
            if (line.includes('agents_used:')) continue
            const agentDataMatch = line.match(/^(\w+):\s*(\{.*)/)
            if (agentDataMatch) {
              try {
                sharedContextData[agentDataMatch[1]] = JSON.parse(agentDataMatch[2])
              } catch {
                // Ignore parse errors
              }
            }
          }

          if (agentsUsed.length > 0) {
            swarmContext = {
              agentsUsed,
              ...(Object.keys(sharedContextData).length > 0 && { sharedContext: sharedContextData })
            }
          }
        }
      }
    }

    // Second pass: process content blocks in order
    for (let i = 0; i < msg.content.length; i++) {
      const item = msg.content[i]

      if (item.text) {
        // Skip swarm_context text blocks
        if (item.text.includes('<swarm_context>')) {
          // Extract non-context text if any
          const cleanedText = item.text.replace(/<swarm_context>[\s\S]*?<\/swarm_context>/g, '').trim()
          if (cleanedText) {
            currentText += cleanedText
          }
        } else {
          currentText += item.text
        }
      } else if (item.toolUse) {
        // Save current text as a message before tool
        if (currentText.trim()) {
          messages.push(createTextMessage(currentText, false))
          currentText = ''
        }
        // Create tool message
        const toolResult = toolResultMap.get(item.toolUse.toolUseId)
        messages.push(createToolMessage(item.toolUse, toolResult))
      }
      // toolResult is handled via toolResultMap, skip here
    }

    // Save remaining text as final message
    if (currentText.trim()) {
      messages.push(createTextMessage(currentText, true))
    } else if (messages.length > 0 && swarmContext) {
      // Add swarmContext to last message if no trailing text
      messages[messages.length - 1] = {
        ...messages[messages.length - 1],
        swarmContext
      }
    }
  }

  // If no messages were created, return empty array
  if (messages.length === 0) {
    return []
  }

  logger.debug(`[loadSession] Swarm message split into ${messages.length} messages`)
  return messages
}

/**
 * Get current authenticated user's ID from Amplify
 * Returns 'anonymous' if not authenticated
 */
async function getAuthUserId(): Promise<string> {
  try {
    const user = await getCurrentUser()
    return user.userId || user.username || 'anonymous'
  } catch {
    // Not authenticated
    return 'anonymous'
  }
}

interface UseChatAPIProps {
  backendUrl: string
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  availableTools: Tool[]  // Added: need current tools state
  setAvailableTools: React.Dispatch<React.SetStateAction<Tool[]>>
  handleStreamEvent: (event: AGUIStreamEvent) => void
  handleLegacyEvent: (data: any) => void
  onSessionCreated?: () => void  // Callback when new session is created
  gatewayToolIds?: string[]  // Gateway tool IDs from frontend
  sessionId: string | null
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
  currentModelId: string  // Per-session model ID from useChat state
  currentTemperature: number  // Per-session temperature from useChat state
}

// Session preferences returned when loading a session
export interface SessionPreferences {
  lastModel?: string
  enabledTools?: string[]
  skillsEnabled?: boolean
  selectedPromptId?: string
  customPromptText?: string
}

interface UseChatAPIReturn {
  loadTools: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  newChat: () => Promise<boolean>
  sendMessage: (messageToSend: string, files?: File[], onSuccess?: () => void, onError?: (error: string) => void, overrideEnabledTools?: string[], requestType?: string) => Promise<void>
  cleanup: () => void
  isLoadingTools: boolean
  loadSession: (sessionId: string) => Promise<{ preferences: SessionPreferences | null; messages: Message[] }>
}

export const useChatAPI = ({
  backendUrl,
  setUIState,
  setMessages,
  availableTools,
  setAvailableTools,
  handleStreamEvent,
  handleLegacyEvent,
  onSessionCreated,
  gatewayToolIds = [],
  sessionId,
  setSessionId,
  currentModelId,
  currentTemperature,
}: UseChatAPIProps) => {

  const abortRef = useRef<{ unsubscribe: () => void } | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const reconnect = useSSEReconnect()

  // Restore last session on page load (with timeout check) and trigger warmup
  useEffect(() => {
    const initSession = async () => {
      // 1. First, get userId from Amplify auth
      const userId = await getAuthUserId()
      console.warn(`[Session] Initialized with userId: ${userId}`)

      const lastSessionId = sessionStorage.getItem('chat-session-id')
      const lastActivityTime = getLastActivity()

      let currentSessionId: string | null = null

      if (lastSessionId && lastActivityTime) {
        if (isSessionTimedOut(lastActivityTime)) {
          const minutesSinceActivity = (Date.now() - lastActivityTime) / 1000 / 60
          console.warn(`[Session] Session timed out after ${minutesSinceActivity.toFixed(1)} minutes of inactivity`)
          clearSessionData()
        } else {
          const minutesSinceActivity = (Date.now() - lastActivityTime) / 1000 / 60
          console.warn(`[Session] Restoring session: ${lastSessionId} (${minutesSinceActivity.toFixed(1)} minutes since last activity)`)
          currentSessionId = lastSessionId
        }
      } else if (lastSessionId) {
        console.warn(`[Session] Restoring session without activity timestamp: ${lastSessionId}`)
        currentSessionId = lastSessionId
        updateLastActivity()
      }

      // 2. Generate new session with userId if none exists
      if (!currentSessionId) {
        currentSessionId = generateSessionId(userId)
        sessionStorage.setItem('chat-session-id', currentSessionId)
        console.warn(`[Session] Generated new session: ${currentSessionId}`)
      }

      setSessionId(currentSessionId)
      sessionIdRef.current = currentSessionId

      // 3. Trigger warmup with auth
      const authHeaders = await getAuthHeaders()
      triggerWarmup(currentSessionId, authHeaders)
    }

    initSession()
  }, [])

  // Sync sessionIdRef with sessionId state
  useEffect(() => {
    sessionIdRef.current = sessionId
    if (sessionId) {
      sessionStorage.setItem('chat-session-id', sessionId)
    }
  }, [sessionId])

  /**
   * Get Authorization header with Cognito JWT token
   */
  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    try {
      const session = await fetchAuthSession()
      const token = session.tokens?.idToken?.toString()

      if (token) {
        return { 'Authorization': `Bearer ${token}` }
      }
    } catch (error) {
      logger.debug('No auth session available (local dev or not authenticated)')
    }
    return {}
  }

  const loadTools = useCallback(async () => {
    try {
      const authHeaders = await getAuthHeaders()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...authHeaders
      }

      // Include session ID in headers if available (use ref to avoid dependency)
      const currentSessionId = sessionIdRef.current
      if (currentSessionId) {
        headers['X-Session-ID'] = currentSessionId
      }

      const response = await fetch(getApiUrl('tools'), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        // Extract session ID from response headers
        const responseSessionId = response.headers.get('X-Session-ID')

        // Only update session ID if we don't have one yet (initial load)
        if (responseSessionId && !currentSessionId) {
          setSessionId(responseSessionId)
        }

        const data = await response.json()
        // Combine regular tools and MCP servers from unified API response
        const allTools = [...(data.tools || []), ...(data.mcp_servers || [])]
        // Merge with existing enabled states to prevent flicker on tool refresh
        setAvailableTools(prevTools => {
          if (prevTools.length === 0) return allTools
          const enabledIds = new Set<string>()
          for (const tool of prevTools) {
            if ((tool as any).enabled) enabledIds.add(tool.id)
            if ((tool as any).isDynamic && (tool as any).tools) {
              for (const nt of (tool as any).tools) {
                if (nt.enabled) enabledIds.add(nt.id)
              }
            }
          }
          return allTools.map((tool: any) => {
            const updated = { ...tool, enabled: enabledIds.has(tool.id) }
            if (tool.isDynamic && tool.tools) {
              updated.tools = tool.tools.map((nt: any) => ({
                ...nt,
                enabled: enabledIds.has(nt.id)
              }))
            }
            return updated
          })
        })
      } else {
        setAvailableTools([])
      }
    } catch (error) {
      setAvailableTools([])
    }
  }, [setAvailableTools])

  /**
   * Toggle tool enabled state (in-memory only)
   * Tool preferences are committed to storage when message is sent
   */
  const toggleTool = useCallback(async (toolId: string) => {
    try {
      // Update frontend state
      setAvailableTools(prev => prev.map(tool => {
        // Check if this is a grouped tool with nested tools FIRST
        // (to handle case where parent id == nested id)
        if ((tool as any).isDynamic && (tool as any).tools) {
          const nestedTools = (tool as any).tools
          const nestedIndex = nestedTools.findIndex((t: any) => t.id === toolId)

          if (nestedIndex !== -1) {
            const updatedNestedTools = [...nestedTools]
            updatedNestedTools[nestedIndex] = {
              ...updatedNestedTools[nestedIndex],
              enabled: !updatedNestedTools[nestedIndex].enabled
            }
            return { ...tool, tools: updatedNestedTools }
          }
        }

        // Direct tool toggle (for non-grouped tools)
        if (tool.id === toolId) {
          return { ...tool, enabled: !tool.enabled }
        }

        return tool
      }))

      logger.debug(`Tool ${toolId} toggled (in-memory, will commit on next message)`)
    } catch (error) {
      logger.error('Failed to toggle tool:', error)
    }
  }, [setAvailableTools, availableTools])

  const newChat = useCallback(async () => {
    try {
      setMessages([])
      clearSessionData()

      // Get userId first, then generate session ID with it
      const userId = await getAuthUserId()
      const newSessionId = generateSessionId(userId)
      setSessionId(newSessionId)
      sessionIdRef.current = newSessionId
      sessionStorage.setItem('chat-session-id', newSessionId)
      console.warn(`[Session] New chat created: ${newSessionId}`)

      // Get auth headers for warmup affinity (userId must match)
      const authHeaders = await getAuthHeaders()
      triggerWarmup(newSessionId, authHeaders)
      return true
    } catch (error) {
      logger.error('Error clearing chat:', error)
      return false
    }
  }, [setMessages, setSessionId])

  // Generate summary from the provided messages (before clearing session events)
  const summarizeForCompact = useCallback(async (messages: any[]): Promise<string | null> => {
    try {
      const authHeaders = await getAuthHeaders()

      const response = await fetch(getApiUrl('session/compact/summarize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ messages, modelId: currentModelId }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message || `Summarize failed: ${response.status}`)
      }

      const data = await response.json()
      if (!data.success) throw new Error(data.message || 'Summarize failed')

      return data.summary
    } catch (error) {
      logger.error('Error generating compact summary:', error)
      return null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelId])

  // List all current eventIds for the session (snapshot before sending summary)
  const listSessionEvents = useCallback(async (): Promise<string[]> => {
    try {
      const currentSessionId = sessionIdRef.current
      if (!currentSessionId) return []

      const authHeaders = await getAuthHeaders()
      const response = await fetch(getApiUrl(`session/compact?sessionId=${encodeURIComponent(currentSessionId)}`), {
        method: 'GET',
        headers: authHeaders,
      })

      if (!response.ok) return []

      const data = await response.json()
      return data.eventIds ?? []
    } catch (error) {
      logger.error('Error listing session events:', error)
      return []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Delete specified eventIds from the session (pass oldEventIds captured before summary was sent)
  const compactSession = useCallback(async (eventIds?: string[]): Promise<boolean> => {
    try {
      const currentSessionId = sessionIdRef.current
      if (!currentSessionId) return false

      const authHeaders = await getAuthHeaders()

      const response = await fetch(getApiUrl('session/compact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sessionId: currentSessionId, eventIds }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message || `Compact failed: ${response.status}`)
      }

      const data = await response.json()
      if (!data.success) throw new Error(data.message || 'Compact failed')

      return true
    } catch (error) {
      logger.error('Error compacting session:', error)
      return false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendMessage = useCallback(async (
    messageToSend: string,
    files?: File[],
    onSuccess?: () => void,
    onError?: (error: string) => void,
    overrideEnabledTools?: string[], // Override enabled tools (for Research Agent interrupt)
    requestType?: string, // Request type: "normal", "swarm", "compose"
    additionalTools?: string[], // Additional tools to add (e.g., artifact editor when artifact is selected)
    systemPrompt?: string, // Additional system prompt context (e.g., artifact context)
    selectedArtifactId?: string | null // Selected artifact ID for tool context
  ) => {
    // Update last activity timestamp (for session timeout tracking)
    updateLastActivity()

    abortRef.current?.unsubscribe()
    abortRef.current = null
    reconnect.reset()

    try {
      const authHeaders = await getAuthHeaders()

      // Use ref to get latest sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current

      // Extract enabled tool IDs (including nested tools from groups)
      const enabledToolIds: string[] = []

      // If overrideEnabledTools is provided, use it instead of availableTools
      if (overrideEnabledTools) {
        enabledToolIds.push(...overrideEnabledTools)
      } else {
        availableTools.forEach(tool => {
          // Check if this is a grouped tool with nested tools
          if ((tool as any).isDynamic && (tool as any).tools) {
            // Add enabled nested tools
            const nestedTools = (tool as any).tools || []
            nestedTools.forEach((nestedTool: any) => {
              if (nestedTool.enabled) {
                enabledToolIds.push(nestedTool.id)
              }
            })
          } else if (tool.enabled && !tool.id.startsWith('gateway_')) {
            // Add regular enabled tools (exclude gateway prefix)
            enabledToolIds.push(tool.id)
          }
        })
      }

      // Combine with Gateway tool IDs (from props) - skip if overriding
      let allEnabledToolIds = overrideEnabledTools
        ? [...enabledToolIds]
        : [...enabledToolIds, ...gatewayToolIds]

      // Tool Gating: If research_agent is enabled, disable all other tools
      const hasResearchAgent = allEnabledToolIds.includes('agentcore_research-agent')

      if (hasResearchAgent) {
        // Only allow research_agent, disable all others
        allEnabledToolIds = ['agentcore_research-agent']
        logger.info(`🔒 Tool gating: Research Agent active - all other tools disabled`)
      }

      // Add additional tools (e.g., artifact editor when artifact is selected)
      if (additionalTools && additionalTools.length > 0) {
        additionalTools.forEach(toolId => {
          if (!allEnabledToolIds.includes(toolId)) {
            allEnabledToolIds.push(toolId)
          }
        })
        logger.info(`➕ Added ${additionalTools.length} additional tools: ${additionalTools.join(', ')}`)
      }

      logger.info(`Sending message with ${allEnabledToolIds.length} enabled tools (${enabledToolIds.length} local + ${gatewayToolIds.length} gateway)${files && files.length > 0 ? ` and ${files.length} files` : ''}`)

      const RETRYABLE_STATUSES = [502, 503, 504]
      const MAX_RETRIES = 2

      if (files && files.length > 0) {
        // ---------------------------------------------------------------
        // AG-UI multimodal path — files converted to base64 inline
        // ---------------------------------------------------------------
        const localAbortController = new AbortController()
        const readerHolder = { current: null as ReadableStreamDefaultReader<Uint8Array> | null }
        abortRef.current = {
          unsubscribe: () => {
            readerHolder.current?.cancel().catch(() => {})
            localAbortController.abort()
          }
        }

        // Convert files to base64 and build AG-UI InputContentPart array
        // AG-UI only supports 'text' and 'binary' content types
        type ContentPart =
          | { type: 'text'; text: string }
          | { type: 'binary'; mimeType: string; data: string; filename: string }

        const contentParts: ContentPart[] = [{ type: 'text', text: messageToSend }]
        for (const file of files) {
          const arrayBuffer = await file.arrayBuffer()
          const base64 = btoa(new Uint8Array(arrayBuffer).reduce((d, b) => d + String.fromCharCode(b), ''))
          contentParts.push({
            type: 'binary',
            mimeType: file.type || 'application/octet-stream',
            data: base64,
            filename: file.name,
          })
        }

        const threadId = sessionIdRef.current ?? crypto.randomUUID()
        const aguiBody = JSON.stringify({
          threadId,
          runId: crypto.randomUUID(),
          messages: [{ id: crypto.randomUUID(), role: 'user', content: contentParts }],
          tools: allEnabledToolIds.map(id => ({ name: id, description: '' })),
          context: [],
          state: {
            model_id: currentModelId,
            temperature: currentTemperature,
            ...(requestType && { request_type: requestType }),
            ...(systemPrompt && { system_prompt: systemPrompt }),
            ...(selectedArtifactId && { selected_artifact_id: selectedArtifactId }),
          },
        })

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...authHeaders,
        }
        if (currentSessionId) {
          headers['X-Session-ID'] = currentSessionId
        }

        let response = await fetch(getApiUrl('stream/chat'), {
          method: 'POST',
          headers,
          body: aguiBody,
          signal: localAbortController.signal
        })

        // Retry on transient errors (502, 503, 504) with exponential backoff
        if (!response.ok) {
          if (RETRYABLE_STATUSES.includes(response.status) && !localAbortController.signal.aborted) {
            let lastStatus = response.status
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 4000)
              const delay = Math.floor(baseDelay * (0.5 + Math.random() * 0.5)) // jitter to avoid thundering herd
              logger.info(`[useChatAPI] Retrying after ${response.status} (attempt ${attempt}/${MAX_RETRIES}, wait ${delay}ms)`)
              await new Promise(resolve => setTimeout(resolve, delay))

              if (localAbortController.signal.aborted) break

              try {
                const retryHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders }
                if (currentSessionId) retryHeaders['X-Session-ID'] = currentSessionId
                response = await fetch(getApiUrl('stream/chat'), {
                  method: 'POST',
                  headers: retryHeaders,
                  body: aguiBody,
                  signal: localAbortController.signal
                })

                if (response.ok) break
                lastStatus = response.status
                if (!RETRYABLE_STATUSES.includes(response.status)) break
              } catch (retryErr) {
                if (retryErr instanceof Error && retryErr.name === 'AbortError') throw retryErr
                logger.warn(`[useChatAPI] Retry ${attempt} failed:`, retryErr)
                if (attempt === MAX_RETRIES) throw retryErr
              }
            }

            if (!response.ok) {
              throw new Error(`Server temporarily unavailable (${lastStatus}). Please try again.`)
            }
          } else {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
        }

        // Extract session ID from response headers
        const responseSessionId = response.headers.get('X-Session-ID')

        if (responseSessionId && responseSessionId !== currentSessionId) {
          setSessionId(responseSessionId)
          sessionIdRef.current = responseSessionId
          sessionStorage.setItem('chat-session-id', responseSessionId)
          logger.info('Session updated:', responseSessionId)
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          throw new Error('No response body reader available')
        }

        readerHolder.current = reader

        // Capture the session ID this stream belongs to.
        // Used to skip event dispatch when the user switches sessions mid-stream.
        const streamSessionId = sessionIdRef.current

        let buffer = ''

        while (true) {
          let readResult: ReadableStreamReadResult<Uint8Array>
          try {
            readResult = await reader.read()
          } catch (readError) {
            // Stream read failed - typically a network disconnection mid-stream
            if (readError instanceof Error && readError.name === 'AbortError') throw readError
            logger.warn('[useChatAPI] Stream read error (connection may have dropped):', readError)
            throw new TypeError('Failed to fetch')
          }
          const { done, value } = readResult

          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          // Session guard: if user switched sessions, consume the stream
          // without dispatching events so the backend can finish normally.
          if (sessionIdRef.current !== streamSessionId) {
            continue
          }

          let currentEventId: number | null = null
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              continue
            }

            // Track SSE id: field for event injection
            if (line.startsWith('id: ')) {
              currentEventId = parseInt(line.substring(4), 10)
              continue
            }

            if (line.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(line.substring(6))

                // Basic validation: event must be an object with a type field
                if (!eventData || typeof eventData !== 'object') {
                  continue
                }

                // Extract execution metadata for reconnection
                if (eventData.type === 'CUSTOM' && eventData.name === 'execution_meta') {
                  const execId = eventData.value?.executionId
                  if (execId) {
                    reconnect.onStreamStart(execId)
                    logger.info(`[useChatAPI] Execution started: ${execId}`)
                  }
                  continue  // Don't dispatch metadata to UI
                }

                // Inject eventId for deduplication
                if (currentEventId !== null && currentEventId > 0) {
                  eventData._eventId = currentEventId
                }
                currentEventId = null

                // Debug: log metadata events (always show in production for debugging)
                if (eventData.type === 'metadata') {
                  logger.info('[useChatAPI] Received metadata event:', eventData)
                }

                if (eventData.type && (AGUI_EVENT_TYPES as readonly string[]).includes(eventData.type)) {
                  handleStreamEvent(eventData as AGUIStreamEvent)
                } else {
                  // Handle legacy/unknown event types
                  handleLegacyEvent(eventData)
                }
              } catch (error) {
                logger.error('Error processing SSE event:', error)
              }
            }
          }
        }

        setUIState(prev => ({ ...prev, isConnected: true }))

        // Skip post-stream callbacks if user switched sessions during streaming
        if (sessionIdRef.current !== streamSessionId) {
          logger.info(`[useChatAPI] Stream finished for stale session ${streamSessionId}, skipping callbacks`)
          return
        }

        // Session metadata is automatically updated by backend (/api/stream/chat)
        // Just check if it's a new session and refresh the list
        const isNewSession = response.headers.get('X-Session-Is-New') === 'true'

        if (isNewSession) {
          logger.info(`New session created: ${responseSessionId || sessionId}`)
          // Refresh session list to show new session
          onSessionCreated?.()
        }

        onSuccess?.()
      } else {
        // ---------------------------------------------------------------
        // JSON path — text-only messages use AG-UI RunAgentInput + HttpAgent
        // ---------------------------------------------------------------
        const runInput: RunAgentInput = {
          threadId: sessionIdRef.current ?? crypto.randomUUID(),
          runId: crypto.randomUUID(),
          messages: [{ id: crypto.randomUUID(), role: 'user' as const, content: messageToSend }],
          tools: allEnabledToolIds.map(id => ({ name: id, description: '' })),
          context: [],
          state: {
            model_id: currentModelId,
            temperature: currentTemperature,
            ...(requestType && { request_type: requestType }),
            ...(systemPrompt && { system_prompt: systemPrompt }),
            ...(selectedArtifactId && { selected_artifact_id: selectedArtifactId })
          }
        }

        const apiUrl = getApiUrl('stream/chat')
        const streamHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...(currentSessionId && { 'X-Session-ID': currentSessionId })
        }

        // Capture the session ID this stream belongs to.
        const streamSessionId = sessionIdRef.current

        // Retry on transient errors (502, 503, 504) with exponential backoff.
        // HTTP errors from HttpAgent surface as Error objects with a `.status` property.
        let lastHttpStatus = 0
        let streamAborted = false
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 4000)
            const delay = Math.floor(baseDelay * (0.5 + Math.random() * 0.5)) // jitter to avoid thundering herd
            logger.info(`[useChatAPI] Retrying after ${lastHttpStatus} (attempt ${attempt}/${MAX_RETRIES}, wait ${delay}ms)`)
            await new Promise(resolve => setTimeout(resolve, delay))
            if (streamAborted) break
          }

          let shouldRetry = false

          await new Promise<void>((resolve, reject) => {
            const agent = new HttpAgent({ url: apiUrl, headers: streamHeaders })
            const sub = agent.run(runInput).subscribe({
              next: (event) => {
                if (sessionIdRef.current !== streamSessionId) return

                // Extract execution metadata for reconnection
                if (event.type === EventType.CUSTOM) {
                  const customEvent = event as any
                  if (customEvent.name === 'execution_meta') {
                    const execId = customEvent.value?.executionId
                    if (execId) {
                      reconnect.onStreamStart(execId)
                      logger.info(`[useChatAPI] Execution started: ${execId}`)
                    }
                    return  // Don't dispatch metadata to UI
                  }
                  logger.info('[useChatAPI] Received custom event:', event)
                }
                handleStreamEvent(event as AGUIStreamEvent)
              },
              error: (err) => {
                const status = (err as any)?.status
                if (RETRYABLE_STATUSES.includes(status) && !streamAborted && attempt < MAX_RETRIES) {
                  lastHttpStatus = status
                  shouldRetry = true
                  resolve()
                } else {
                  reject(err)
                }
              },
              complete: () => resolve()
            })
            abortRef.current = {
              unsubscribe: () => {
                streamAborted = true
                sub.unsubscribe()
                resolve()
              }
            }
          })

          if (!shouldRetry) break
        }

        setUIState(prev => ({ ...prev, isConnected: true }))

        // Skip post-stream callbacks if user switched sessions during streaming
        if (sessionIdRef.current !== streamSessionId) {
          logger.info(`[useChatAPI] Stream finished for stale session ${streamSessionId}, skipping callbacks`)
          return
        }

        reconnect.reset()  // Clear persisted cursor on normal stream completion
        onSuccess?.()
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      // Attempt SSE reconnection on network errors (not user-initiated aborts)
      const isNetworkError = (error instanceof TypeError && (error.message === 'Failed to fetch' || error.message.includes('network')))
        || (error instanceof Error && error.message.includes('Stream read error'))
      if (isNetworkError) {
        logger.info('[useChatAPI] Network error detected, attempting SSE reconnection...')
        setUIState(prev => ({ ...prev, isReconnecting: true }))
        try {
          await reconnect.attemptReconnect(
            (event) => handleStreamEvent(event),
            () => {
              // Resume succeeded
              setUIState(prev => ({ ...prev, isReconnecting: false, isConnected: true }))
              onSuccess?.()
            },
            () => {
              // Resume failed — show error
              setUIState(prev => ({ ...prev, isReconnecting: false, isConnected: false, isTyping: false }))
              setMessages(prev => [...prev, {
                id: String(Date.now()),
                text: 'Connection lost. The response may be incomplete.',
                sender: 'bot',
                timestamp: new Date().toLocaleTimeString()
              }])
            },
            getAuthHeaders,
            () => {
              // Connected — clear badge while stream continues
              setUIState(prev => ({ ...prev, isReconnecting: false, isConnected: true }))
            },
          )
          return
        } catch {
          // Fall through to normal error handling
          setUIState(prev => ({ ...prev, isReconnecting: false }))
        }
      }

      logger.error('Error sending message:', error)
      setUIState(prev => ({ ...prev, isConnected: false, isTyping: false }))

      // Provide user-friendly error messages for common network issues
      let errorMessage: string
      const rawMessage = error instanceof Error ? error.message : 'Unknown error'

      if (error instanceof TypeError && rawMessage === 'Failed to fetch') {
        errorMessage = 'Network connection lost. Please check your connection and try again.'
      } else if (rawMessage.includes('Server temporarily unavailable')) {
        errorMessage = rawMessage
      } else {
        errorMessage = `Connection error: ${rawMessage}`
      }

      setMessages(prev => [...prev, {
        id: String(Date.now()),
        text: errorMessage,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString()
      }])

      onError?.(errorMessage)
    }
  }, [handleStreamEvent, handleLegacyEvent, setUIState, setMessages, availableTools, gatewayToolIds, onSessionCreated, currentModelId, currentTemperature, reconnect])
  // sessionId removed from dependency array - using sessionIdRef.current instead

  /**
   * Remove file hints from user message text (added for agent's context)
   * These hints should not be displayed in the UI
   */
  const removeFileHints = (text: string): string => {
    // Remove <uploaded_files>...</uploaded_files> blocks
    return text.replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, '').trim()
  }

  /**
   * Parse swarm context from assistant message text
   * Returns the agents used, shared context, and removes the tag from text
   */
  const parseSwarmContext = (text: string): {
    cleanedText: string;
    swarmContext?: {
      agentsUsed: string[];
      sharedContext?: Record<string, any>;
    }
  } => {
    const swarmContextMatch = text.match(/<swarm_context>([\s\S]*?)<\/swarm_context>/)

    if (!swarmContextMatch) {
      return { cleanedText: text }
    }

    const contextContent = swarmContextMatch[1]

    // Extract agents_used from the context
    const agentsMatch = contextContent.match(/agents_used:\s*\[(.*?)\]/)
    let agentsUsed: string[] = []
    if (agentsMatch) {
      agentsUsed = agentsMatch[1]
        .split(',')
        .map(s => s.trim().replace(/['"]/g, ''))
        .filter(s => s.length > 0)
    }

    // Extract shared_context for each agent (format: "agent_name: {json}")
    const sharedContext: Record<string, any> = {}
    const lines = contextContent.split('\n')
    for (const line of lines) {
      // Skip agents_used line
      if (line.includes('agents_used:')) continue

      // Match "agent_name: {json...}" or "agent_name: {...}"
      const agentDataMatch = line.match(/^(\w+):\s*(\{.*)/)
      if (agentDataMatch) {
        const agentName = agentDataMatch[1]
        let jsonStr = agentDataMatch[2]

        // Handle truncated JSON (ends with ...)
        if (jsonStr.endsWith('...')) {
          jsonStr = jsonStr.slice(0, -3)
          // Try to make it valid JSON by closing brackets
          const openBraces = (jsonStr.match(/\{/g) || []).length
          const closeBraces = (jsonStr.match(/\}/g) || []).length
          jsonStr += '}'.repeat(openBraces - closeBraces)
        }

        try {
          sharedContext[agentName] = JSON.parse(jsonStr)
        } catch {
          // If JSON parsing fails, store as string
          sharedContext[agentName] = agentDataMatch[2]
        }
      }
    }

    // Remove the swarm_context tag from text
    const cleanedText = text.replace(/<swarm_context>[\s\S]*?<\/swarm_context>/g, '').trim()

    return {
      cleanedText,
      swarmContext: agentsUsed.length > 0 ? {
        agentsUsed,
        ...(Object.keys(sharedContext).length > 0 && { sharedContext })
      } : undefined
    }
  }

  const loadSession = useCallback(async (newSessionId: string): Promise<{ preferences: SessionPreferences | null; messages: Message[] }> => {
    try {
      logger.info(`Loading session: ${newSessionId}`)

      // Only clear messages when switching to a different session (not during polling refresh)
      const currentStoredSessionId = sessionStorage.getItem('chat-session-id')
      const isSameSession = currentStoredSessionId === newSessionId
      setSessionId(newSessionId)
      sessionIdRef.current = newSessionId   // sync immediately so sendMessage uses new session
      sessionStorage.setItem('chat-session-id', newSessionId)
      if (!isSameSession) {
        setMessages([])
      }

      const authHeaders = await getAuthHeaders()

      // Load conversation history from AgentCore Memory
      const url = getApiUrl(`conversation/history?session_id=${newSessionId}`)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to load conversation history')
      }

      // Extract session preferences for restoration
      const sessionPreferences: SessionPreferences | null = data.sessionPreferences || null
      if (sessionPreferences) {
        logger.info(`Session preferences loaded: model=${sessionPreferences.lastModel}, tools=${sessionPreferences.enabledTools?.length || 0}`)
      }

      // Extract artifacts (if present)
      const artifacts = data.artifacts || []
      if (artifacts.length > 0) {
        logger.info(`[loadSession] Loaded ${artifacts.length} artifacts from history API`)
        // Store artifacts in sessionStorage for useArtifacts to pick up
        sessionStorage.setItem(`artifacts-${newSessionId}`, JSON.stringify(artifacts))
      }

      // Build tool maps for toolUse/toolResult matching
      const { toolUseMap, toolResultMap } = buildToolMaps(data.messages)

      // Process messages - keep all messages and parse tool executions
      const loadedMessages: Message[] = data.messages
        .map((msg: any, index: number) => {
          // Check if this is a swarm mode message (has swarm_context tag in content)
          const isSwarmMessage = msg.role === 'assistant' && Array.isArray(msg.content) &&
            msg.content.some((item: any) => item.text?.includes('<swarm_context>'))

          // For swarm messages, process content blocks in order to preserve text/tool interleaving
          if (isSwarmMessage) {
            return processSwarmMessageContent(msg, index, newSessionId, toolResultMap)
          }

          // Normal mode: original processing logic
          let text = ''
          const toolExecutions: ToolExecution[] = []
          const processedToolUseIds = new Set<string>()
          const uploadedFiles: Array<{ name: string; type: string; size: number }> = []

          if (Array.isArray(msg.content)) {
            msg.content.forEach((item: any) => {
              // Extract text content
              if (item.text) {
                text += item.text
              }

              // Extract document ContentBlocks for file badge display
              else if (item.document) {
                const doc = item.document
                const format = doc.format || 'unknown'
                const name = doc.name || 'document'

                // Reconstruct filename with extension (Bedrock stores name without extension)
                const filename = format !== 'unknown' ? `${name}.${format}` : name

                // Map format to MIME type
                const mimeTypeMap: Record<string, string> = {
                  'pdf': 'application/pdf',
                  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'doc': 'application/msword',
                  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'xls': 'application/vnd.ms-excel',
                  'csv': 'text/csv',
                  'txt': 'text/plain',
                  'md': 'text/markdown',
                  'html': 'text/html'
                }

                const mimeType = mimeTypeMap[format] || 'application/octet-stream'

                // Estimate size from bytes if available
                const size = doc.source?.bytes ? doc.source.bytes.length : 0

                uploadedFiles.push({
                  name: filename,
                  type: mimeType,
                  size: size
                })
              }

              // Extract image ContentBlocks for file badge display
              else if (item.image) {
                const image = item.image
                const format = image.format || 'png'

                // Generate filename (images don't have names in ContentBlock, use generic name)
                const filename = `image.${format}`

                // Map format to MIME type
                const imageMimeTypeMap: Record<string, string> = {
                  'png': 'image/png',
                  'jpeg': 'image/jpeg',
                  'jpg': 'image/jpeg',
                  'gif': 'image/gif',
                  'webp': 'image/webp',
                  'bmp': 'image/bmp'
                }

                const mimeType = imageMimeTypeMap[format] || 'image/png'

                // Estimate size from bytes if available
                const size = image.source?.bytes ? image.source.bytes.length : 0

                uploadedFiles.push({
                  name: filename,
                  type: mimeType,
                  size: size
                })
              }

              // Handle toolUse - toolResult is always paired with toolUse in the map
              else if (item.toolUse) {
                const toolUseId = item.toolUse.toolUseId

                // Skip duplicates
                if (processedToolUseIds.has(toolUseId)) {
                  return
                }
                processedToolUseIds.add(toolUseId)

                // Find matching toolResult (from blob or same message)
                const toolResult = toolResultMap.get(toolUseId)
                toolExecutions.push(createToolExecution(item.toolUse, toolResult, msg))
              }
              // Note: toolResult items are ignored here - they're accessed via toolResultMap
            })
          }

          // Clean message text and parse swarm context:
          // - User messages: remove file hints
          // - Assistant messages: parse and remove swarm context tags
          let cleanedText = text
          let swarmContext: { agentsUsed: string[]; sharedContext?: Record<string, any> } | undefined = undefined

          if (msg.role === 'user') {
            cleanedText = removeFileHints(text)
          } else {
            const parsed = parseSwarmContext(text)
            cleanedText = parsed.cleanedText
            swarmContext = parsed.swarmContext

            // Debug: log swarm message parsing
            if (swarmContext) {
              logger.debug(`[loadSession] Swarm message parsed:`, {
                originalTextLength: text.length,
                cleanedTextLength: cleanedText.length,
                agentsUsed: swarmContext.agentsUsed,
                hasSharedContext: !!swarmContext.sharedContext,
                cleanedTextPreview: cleanedText.substring(0, 100)
              })
            }
          }

          const currentMessage: Message = {
            id: msg.id || `${newSessionId}-${index}`,
            text: cleanedText,
            sender: msg.role === 'user' ? 'user' : 'bot',
            timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
            ...(toolExecutions.length > 0 && {
              toolExecutions: toolExecutions,
              isToolMessage: true
            }),
            ...(uploadedFiles.length > 0 && {
              uploadedFiles: uploadedFiles
            }),
            ...(msg.latencyMetrics && {
              latencyMetrics: msg.latencyMetrics
            }),
            ...(msg.tokenUsage && {
              tokenUsage: msg.tokenUsage
            }),
            ...(msg.feedback && {
              feedback: msg.feedback
            }),
            ...(msg.documents && {
              documents: msg.documents
            }),
            // Preserve voice message flag from local session store
            ...(msg.isVoiceMessage && {
              isVoiceMessage: true
            }),
            // Preserve swarm context from parsed message
            ...(swarmContext && {
              swarmContext: swarmContext
            }),
            // Preserve swarm node marker from session
            ...(msg.isSwarmNode && {
              isSwarmNode: true,
              swarmNodeId: msg.swarmNodeId,
              swarmNodeDescription: msg.swarmNodeDescription
            })
          }

          return [currentMessage]
        }).flat()
        // Filter out user messages that only contain toolResults (no actual text content)
        // These are intermediate messages that shouldn't be displayed
        .filter((msg: Message) => {
          // Skip user messages with no text
          if (msg.sender === 'user' && !msg.text) {
            return false
          }
          return true
        })

      // Non-A2A incomplete tools can't recover on reload — mark them cancelled to avoid permanent spinner.
      const finalMessages = loadedMessages.map(msg => {
        if (!msg.toolExecutions) return msg
        const updated = msg.toolExecutions.map(te =>
          !te.isComplete && !te.isCancelled && !isA2ATool(te.toolName)
            ? { ...te, isCancelled: true }
            : te
        )
        return { ...msg, toolExecutions: updated }
      })

      // Skip setMessages during polling if content hasn't changed (prevents re-render flicker)
      if (isSameSession) {
        setMessages(prevMessages => {
          if (prevMessages.length !== finalMessages.length) {
            return finalMessages
          }
          // Check tool execution completion status changes in recent messages
          for (let i = Math.max(0, prevMessages.length - 5); i < prevMessages.length; i++) {
            const prevTools = prevMessages[i].toolExecutions
            const nextTools = finalMessages[i]?.toolExecutions
            if ((!prevTools) !== (!nextTools)) return finalMessages
            if (prevTools && nextTools) {
              if (prevTools.length !== nextTools.length) return finalMessages
              for (let j = 0; j < prevTools.length; j++) {
                if (prevTools[j].isComplete !== nextTools[j].isComplete) return finalMessages
                if (prevTools[j].isCancelled !== nextTools[j].isCancelled) return finalMessages
              }
            }
          }
          // Check last message text change
          const prevLast = prevMessages[prevMessages.length - 1]
          const nextLast = finalMessages[finalMessages.length - 1]
          if (prevLast?.text !== nextLast?.text) return finalMessages
          // No meaningful change - return same reference to prevent re-render
          return prevMessages
        })
      } else {
        setMessages(finalMessages)
      }

      logger.info(`Session loaded: ${newSessionId} with ${finalMessages.length} messages`)

      // Check for a running execution that can be resumed (e.g., after page refresh)
      const hasExecution = reconnect.restoreFromSession(newSessionId)
      if (hasExecution) {
        logger.info(`[loadSession] Found persisted execution for session ${newSessionId}, attempting resume...`)

        // Remove the last assistant turn from history — replay will rebuild it.
        // This prevents duplicate messages (history + replay showing the same content).
        setMessages(prev => {
          let lastUserIdx = -1
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].sender === 'user') { lastUserIdx = i; break }
          }
          if (lastUserIdx >= 0) {
            return prev.slice(0, lastUserIdx + 1)
          }
          return prev
        })

        setUIState(prev => ({ ...prev, isTyping: true, isReconnecting: true, agentStatus: 'thinking' }))
        reconnect.attemptReconnect(
          (event) => handleStreamEvent(event),
          () => {
            // Resume succeeded
            logger.info('[loadSession] Resume after page refresh succeeded')
            setUIState(prev => ({ ...prev, isReconnecting: false, isTyping: false, isConnected: true, agentStatus: 'idle' }))
          },
          () => {
            // Resume failed — show history only
            logger.info('[loadSession] Resume after page refresh failed, showing history only')
            setUIState(prev => ({ ...prev, isReconnecting: false, isTyping: false, agentStatus: 'idle' }))
          },
          getAuthHeaders,
          () => {
            // Connected — clear badge, keep isTyping true since stream continues
            setUIState(prev => ({ ...prev, isReconnecting: false, isConnected: true }))
          },
        ).catch(() => {
          setUIState(prev => ({ ...prev, isReconnecting: false, isTyping: false, agentStatus: 'idle' }))
        })
      }

      // Return session preferences and messages for caller use
      return { preferences: sessionPreferences, messages: finalMessages }
    } catch (error) {
      logger.error('Failed to load session:', error)
      throw error
    }
  }, [setMessages, getAuthHeaders, reconnect, handleStreamEvent, setUIState])

  const cleanup = useCallback(() => {
    abortRef.current?.unsubscribe()
  }, [])

  const sendStopSignal = useCallback(() => {
    abortRef.current?.unsubscribe()
  }, [])

  return {
    loadTools,
    toggleTool,
    newChat,
    compactSession,
    summarizeForCompact,
    listSessionEvents,
    sendMessage,
    cleanup,
    sendStopSignal,
    isLoadingTools: false,
    loadSession,
    isReconnecting: reconnect.isReconnecting,
    reconnectAttempt: reconnect.reconnectAttempt,
  }
}