import { useCallback, useRef, useState, useEffect } from 'react'
import { Message, Tool } from '@/types/chat'
import { StreamEvent, ChatUIState } from '@/types/events'
import { getApiUrl } from '@/config/environment'
import logger from '@/utils/logger'

interface UseChatAPIProps {
  backendUrl: string
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setAvailableTools: React.Dispatch<React.SetStateAction<Tool[]>>
  handleStreamEvent: (event: StreamEvent) => void
  handleLegacyEvent: (data: any) => void
}

interface UseChatAPIReturn {
  loadTools: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  clearChat: () => Promise<boolean>
  sendMessage: (messageToSend: string, files?: File[], onSuccess?: () => void, onError?: (error: string) => void) => Promise<void>
  cleanup: () => void
  sessionId: string | null
  isLoadingTools: boolean
}

export const useChatAPI = ({
  backendUrl,
  setUIState,
  setMessages,
  setAvailableTools,
  handleStreamEvent,
  handleLegacyEvent
}: UseChatAPIProps) => {
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Clear session ID on page load/refresh to start fresh session
  useEffect(() => {
    // Always clear existing session ID on page load to start fresh
    sessionStorage.removeItem('chat-session-id')
    setSessionId(null)
  }, [])

  // Save session ID to sessionStorage when it changes
  useEffect(() => {
    if (sessionId) {
      sessionStorage.setItem('chat-session-id', sessionId)
    }
  }, [sessionId])

  const loadTools = useCallback(async () => {
    try {
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
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
        
        if (responseSessionId && responseSessionId !== sessionId) {
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

  const toggleTool = useCallback(async (toolId: string) => {
    try {
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      
      // Include session ID in headers if available
      if (sessionId) {
        headers['X-Session-ID'] = sessionId
      }
      
      const response = await fetch(getApiUrl(`tools/${toolId}/toggle`), {
        method: 'POST',
        headers
      })
      
      if (response.ok) {
        // Extract session ID from response headers
        const responseSessionId = response.headers.get('X-Session-ID')
        
        if (responseSessionId && responseSessionId !== sessionId) {
          setSessionId(responseSessionId)
        }
        
        const result = await response.json()
        
        if (result.success) {
          setAvailableTools(prev => prev.map(tool => 
            tool.id === toolId 
              ? { ...tool, enabled: result.enabled }
              : tool
          ))
        }
      }
    } catch (error) {
      logger.error('Failed to toggle tool:', error)
    }
  }, [setAvailableTools, sessionId])

  const clearChat = useCallback(async () => {
    try {
      const response = await fetch(getApiUrl('conversation/clear'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(sessionId && { 'X-Session-ID': sessionId })
        }
      })
      
      if (response.ok) {
        setMessages([])
        
        // Clear session ID to start fresh session
        setSessionId(null)
        sessionStorage.removeItem('chat-session-id')
        
        return true
      }
    } catch (error) {
      // Reset state even if request fails
      setMessages([])
      setSessionId(null)
      sessionStorage.removeItem('chat-session-id')
    }
    return false
  }, [setMessages, sessionId])

  const sendMessage = useCallback(async (
    messageToSend: string,
    files?: File[],
    onSuccess?: () => void,
    onError?: (error: string) => void
  ) => {
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      let response: Response;
      
      if (files && files.length > 0) {
        // Use multimodal endpoint for file uploads
        const formData = new FormData()
        formData.append('message', messageToSend)
        
        // Add all files to form data
        files.forEach((file) => {
          formData.append('files', file)
        })
        
        const headers: Record<string, string> = {}
        if (sessionId) {
          headers['X-Session-ID'] = sessionId
        }
        
        response = await fetch(getApiUrl('stream/multimodal'), {
          method: 'POST',
          headers,
          body: formData,
          signal: abortControllerRef.current.signal
        })
      } else {
        // Use regular text endpoint
        response = await fetch(getApiUrl('stream/chat'), {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...(sessionId && { 'X-Session-ID': sessionId })
          },
          body: JSON.stringify({ message: messageToSend }),
          signal: abortControllerRef.current.signal
        })
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // Extract session ID from response headers
      const responseSessionId = response.headers.get('X-Session-ID')
      
      if (responseSessionId && responseSessionId !== sessionId) {
        setSessionId(responseSessionId)
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
              
              // Handle new simplified events
              if (eventData.type && [
                'reasoning', 'response', 'tool_use', 'tool_result', 'tool_progress', 'complete', 'init', 'thinking', 'error',
                'spending_analysis_start', 'spending_analysis_step', 'spending_analysis_result', 
                'spending_analysis_progress', 'spending_analysis_complete', 'spending_analysis_chart'
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
  }, [handleStreamEvent, handleLegacyEvent, setUIState, setMessages, sessionId])

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  return {
    loadTools,
    toggleTool,
    clearChat,
    sendMessage,
    cleanup,
    sessionId,
    isLoadingTools: false
  }
}