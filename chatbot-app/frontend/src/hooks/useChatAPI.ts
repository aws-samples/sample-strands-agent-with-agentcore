import { useCallback, useRef, useState, useEffect } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatUIState } from '@/types/events'
import { getApiUrl } from '@/config/environment'
import logger from '@/utils/logger'
import { fetchAuthSession } from 'aws-amplify/auth'
import { apiGet, apiPost } from '@/lib/api-client'
import { buildToolMaps, createToolExecution } from '@/utils/messageParser'
import { isSessionTimedOut, getLastActivity, updateLastActivity, clearSessionData } from '@/config/session'

interface UseChatAPIProps {
  backendUrl: string
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  availableTools: Tool[]  // Added: need current tools state
  setAvailableTools: React.Dispatch<React.SetStateAction<Tool[]>>
  handleStreamEvent: (event: StreamEvent) => void
  handleLegacyEvent: (data: any) => void
  onSessionCreated?: () => void  // Callback when new session is created
  gatewayToolIds?: string[]  // Gateway tool IDs from frontend
  sessionId: string | null
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
}

// Session preferences returned when loading a session
export interface SessionPreferences {
  lastModel?: string
  lastTemperature?: number
  enabledTools?: string[]
  selectedPromptId?: string
  customPromptText?: string
}

interface UseChatAPIReturn {
  loadTools: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  newChat: () => Promise<boolean>
  sendMessage: (messageToSend: string, files?: File[], onSuccess?: () => void, onError?: (error: string) => void) => Promise<void>
  cleanup: () => void
  isLoadingTools: boolean
  loadSession: (sessionId: string) => Promise<SessionPreferences | null>
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
  setSessionId
}: UseChatAPIProps) => {

  const abortControllerRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // Restore last session on page load (with timeout check)
  useEffect(() => {
    const lastSessionId = sessionStorage.getItem('chat-session-id')
    const lastActivityTime = getLastActivity()

    if (lastSessionId && lastActivityTime) {
      // Check if session has timed out
      if (isSessionTimedOut(lastActivityTime)) {
        const minutesSinceActivity = (Date.now() - lastActivityTime) / 1000 / 60
        console.log(`[Session] Session timed out after ${minutesSinceActivity.toFixed(1)} minutes of inactivity`)
        console.log(`[Session] Starting new session...`)

        // Clear timed-out session
        clearSessionData()
        setSessionId(null)
        sessionIdRef.current = null
      } else {
        // Session is still valid - restore it
        const minutesSinceActivity = (Date.now() - lastActivityTime) / 1000 / 60
        console.log(`[Session] Restoring session: ${lastSessionId} (${minutesSinceActivity.toFixed(1)} minutes since last activity)`)

        setSessionId(lastSessionId)
        sessionIdRef.current = lastSessionId
        // Note: loadSession will be called by useChat hook
      }
    } else if (lastSessionId) {
      // Session ID exists but no activity timestamp - restore session
      console.log(`[Session] Restoring session without activity timestamp: ${lastSessionId}`)
      setSessionId(lastSessionId)
      sessionIdRef.current = lastSessionId
      updateLastActivity() // Set activity timestamp for future
    } else {
      // No session to restore
      setSessionId(null)
      sessionIdRef.current = null
    }
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

      // Include session ID in headers if available
      if (sessionId) {
        headers['X-Session-ID'] = sessionId
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
        if (responseSessionId && !sessionId) {
          setSessionId(responseSessionId)
        }

        const data = await response.json()
        // Combine regular tools and MCP servers from unified API response
        const allTools = [...(data.tools || []), ...(data.mcp_servers || [])]
        setAvailableTools(allTools)
      } else {
        setAvailableTools([])
      }
    } catch (error) {
      setAvailableTools([])
    }
  }, [setAvailableTools, sessionId])

  /**
   * Toggle tool enabled state (in-memory only)
   * Tool preferences are committed to storage when message is sent
   */
  const toggleTool = useCallback(async (toolId: string) => {
    try {
      // Mutually exclusive browser tools (parent IDs)
      const browserAutomationId = 'browser_automation'
      const browserUseAgentId = 'agentcore_browser-use-agent'

      // Find which parent group this tool belongs to (if it's a nested tool)
      let parentGroupId: string | null = null
      let isEnabling = false

      // Check if toolId is a top-level tool
      const topLevelTool = availableTools.find(t => t.id === toolId)
      if (topLevelTool) {
        // Direct tool (non-nested)
        isEnabling = !topLevelTool.enabled
        parentGroupId = toolId
      } else {
        // Check if it's a nested tool in any group
        for (const tool of availableTools) {
          if ((tool as any).isDynamic && (tool as any).tools) {
            const nestedTool = (tool as any).tools.find((t: any) => t.id === toolId)
            if (nestedTool) {
              isEnabling = !nestedTool.enabled
              parentGroupId = tool.id
              break
            }
          }
        }
      }

      // Determine if we should disable the other browser tool
      let shouldDisableOther = false
      let otherToolId: string | null = null

      if (isEnabling && parentGroupId) {
        if (parentGroupId === browserAutomationId) {
          shouldDisableOther = true
          otherToolId = browserUseAgentId
        } else if (parentGroupId === browserUseAgentId) {
          shouldDisableOther = true
          otherToolId = browserAutomationId
        }
      }

      // Update frontend state
      setAvailableTools(prev => prev.map(tool => {
        // Check if this is a grouped tool with nested tools FIRST
        // (to handle case where parent id == nested id)
        if ((tool as any).isDynamic && (tool as any).tools) {
          const nestedTools = (tool as any).tools
          const nestedIndex = nestedTools.findIndex((t: any) => t.id === toolId)

          if (nestedIndex !== -1) {
            // Toggle the nested tool
            const updatedNestedTools = [...nestedTools]
            updatedNestedTools[nestedIndex] = {
              ...updatedNestedTools[nestedIndex],
              enabled: !updatedNestedTools[nestedIndex].enabled
            }

            return {
              ...tool,
              tools: updatedNestedTools
            }
          }

          // Disable all nested tools in the other browser group (mutually exclusive)
          if (shouldDisableOther && tool.id === otherToolId) {
            logger.info(`Auto-disabling all tools in ${otherToolId} group (mutually exclusive with ${parentGroupId})`)
            const disabledNestedTools = nestedTools.map((t: any) => ({
              ...t,
              enabled: false
            }))
            return {
              ...tool,
              enabled: false,
              tools: disabledNestedTools
            }
          }
        }

        // Direct tool toggle (for non-grouped tools)
        if (tool.id === toolId) {
          return { ...tool, enabled: !tool.enabled }
        }

        // Disable the other browser tool if needed (mutually exclusive)
        if (shouldDisableOther && tool.id === otherToolId && tool.enabled) {
          logger.info(`Auto-disabling ${otherToolId} (mutually exclusive with ${parentGroupId})`)
          return { ...tool, enabled: false }
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
      // Clear local state only - no server call
      setMessages([])
      setSessionId(null)
      sessionIdRef.current = null
      clearSessionData() // Clear session ID and last activity timestamp

      return true
    } catch (error) {
      logger.error('Error clearing chat:', error)
      return false
    }
  }, [setMessages])

  const sendMessage = useCallback(async (
    messageToSend: string,
    files?: File[],
    onSuccess?: () => void,
    onError?: (error: string) => void
  ) => {
    // Update last activity timestamp (for session timeout tracking)
    updateLastActivity()

    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      let response: Response;

      const authHeaders = await getAuthHeaders()

      // Use ref to get latest sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current

      // Extract enabled tool IDs (including nested tools from groups)
      const enabledToolIds: string[] = []

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

      // Combine with Gateway tool IDs (from props)
      const allEnabledToolIds = [...enabledToolIds, ...gatewayToolIds]

      logger.info(`Sending message with ${allEnabledToolIds.length} enabled tools (${enabledToolIds.length} local + ${gatewayToolIds.length} gateway)${files && files.length > 0 ? ` and ${files.length} files` : ''}`)

      if (files && files.length > 0) {
        // Use FormData for file uploads
        const formData = new FormData()
        formData.append('message', messageToSend)
        formData.append('enabled_tools', JSON.stringify(allEnabledToolIds))

        // Add all files to form data
        files.forEach((file) => {
          formData.append('files', file)
        })

        const headers: Record<string, string> = {
          ...authHeaders
        }
        if (currentSessionId) {
          headers['X-Session-ID'] = currentSessionId
        }

        response = await fetch(getApiUrl('stream/chat'), {
          method: 'POST',
          headers,
          body: formData,
          signal: abortControllerRef.current.signal
        })
      } else {
        // Use JSON for text-only messages
        response = await fetch(getApiUrl('stream/chat'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            ...(currentSessionId && { 'X-Session-ID': currentSessionId })
          },
          body: JSON.stringify({
            message: messageToSend,
            enabled_tools: allEnabledToolIds
          }),
          signal: abortControllerRef.current.signal
        })
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
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

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            continue
          }
          
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.substring(6))
              
              // Debug: log metadata events (always show in production for debugging)
              if (eventData.type === 'metadata') {
                logger.info('[useChatAPI] Received metadata event:', eventData)
              }

              // Handle new simplified events
              if (eventData.type && [
                'text', 'reasoning', 'response', 'tool_use', 'tool_result', 'tool_progress', 'complete', 'init', 'thinking', 'error', 'interrupt', 'metadata', 'browser_progress'
              ].includes(eventData.type)) {
                handleStreamEvent(eventData as StreamEvent)
              } else {
                // Handle other event types
                handleLegacyEvent(eventData)
              }
            } catch (parseError) {
              logger.error('Error parsing SSE data:', parseError)
            }
          }
        }
      }

      setUIState(prev => ({ ...prev, isConnected: true }))

      // Session metadata is automatically updated by backend (/api/stream/chat)
      // Just check if it's a new session and refresh the list
      const isNewSession = response.headers.get('X-Session-Is-New') === 'true'

      if (isNewSession) {
        logger.info(`New session created: ${responseSessionId || sessionId}`)
        // Refresh session list to show new session
        onSessionCreated?.()
      }

      onSuccess?.()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return // Request was aborted, don't show error
      }
      
      logger.error('Error sending message:', error)
      setUIState(prev => ({ ...prev, isConnected: false, isTyping: false }))
      
      const errorMessage = `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: errorMessage,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString()
      }])
      
      onError?.(errorMessage)
    }
  }, [handleStreamEvent, handleLegacyEvent, setUIState, setMessages, availableTools, gatewayToolIds, onSessionCreated])
  // sessionId removed from dependency array - using sessionIdRef.current instead

  /**
   * Remove file hints from user message text (added for agent's context)
   * These hints should not be displayed in the UI
   */
  const removeFileHints = (text: string): string => {
    // Remove <uploaded_files>...</uploaded_files> blocks
    return text.replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, '').trim()
  }

  const loadSession = useCallback(async (newSessionId: string): Promise<SessionPreferences | null> => {
    try {
      logger.info(`Loading session: ${newSessionId}`)

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

      // Build tool maps for toolUse/toolResult matching
      const { toolUseMap, toolResultMap } = buildToolMaps(data.messages)

      // Process messages - keep all messages and parse tool executions
      const loadedMessages: Message[] = data.messages
        .map((msg: any, index: number) => {
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

          // Clean user message text by removing file hints (these are for agent's context only)
          const cleanedText = msg.role === 'user' ? removeFileHints(text) : text

          return {
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
            })
          }
        })
        // Filter out user messages that only contain toolResults (no actual text content)
        // These are intermediate messages that shouldn't be displayed
        .filter((msg: Message) => {
          // Skip user messages with no text
          if (msg.sender === 'user' && !msg.text) {
            return false
          }
          return true
        })

      // Update messages and session ID
      setMessages(loadedMessages)
      setSessionId(newSessionId)
      sessionStorage.setItem('chat-session-id', newSessionId)

      logger.info(`Session loaded: ${newSessionId} with ${loadedMessages.length} messages`)

      // Return session preferences for restoration by caller
      return sessionPreferences
    } catch (error) {
      logger.error('Failed to load session:', error)
      throw error
    }
  }, [setMessages, getAuthHeaders])

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  return {
    loadTools,
    toggleTool,
    newChat,
    sendMessage,
    cleanup,
    isLoadingTools: false,
    loadSession
  }
}