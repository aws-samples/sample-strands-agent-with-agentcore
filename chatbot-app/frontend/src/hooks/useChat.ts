import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { ReasoningState, ChatSessionState, ChatUIState, ToolProgressState } from '@/types/events'
import { detectBackendUrl } from '@/utils/chat'
import { useStreamEvents } from './useStreamEvents'
import { useChatAPI } from './useChatAPI'
import { getApiUrl } from '@/config/environment'
import API_CONFIG from '@/config/api'
import { fetchAuthSession } from 'aws-amplify/auth'


interface UseChatProps {
  onSessionCreated?: () => void  // Callback when new session is created
}

interface UseChatReturn {
  messages: Message[]
  groupedMessages: Array<{
    type: 'user' | 'assistant_turn'
    messages: Message[]
    id: string
  }>
  inputMessage: string
  setInputMessage: (message: string) => void
  isConnected: boolean
  isTyping: boolean
  agentStatus: 'idle' | 'thinking' | 'responding'
  availableTools: Tool[]
  currentToolExecutions: ToolExecution[]
  currentReasoning: ReasoningState | null
  toolProgress: ToolProgressState[]
  showProgressPanel: boolean
  toggleProgressPanel: () => void
  sendMessage: (e: React.FormEvent, files?: File[]) => Promise<void>
  stopGeneration: () => void
  newChat: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  refreshTools: () => Promise<void>
  sessionId: string | null
  loadSession: (sessionId: string) => Promise<void>
  onGatewayToolsChange: (enabledToolIds: string[]) => void
  browserSession: { sessionId: string | null; browserId: string | null } | null
}

export const useChat = (props?: UseChatProps): UseChatReturn => {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000')
  const [availableTools, setAvailableTools] = useState<Tool[]>([])
  const [gatewayToolIds, setGatewayToolIds] = useState<string[]>([])  // Gateway tool IDs from frontend

  const [sessionState, setSessionState] = useState<ChatSessionState>({
    reasoning: null,
    streaming: null,
    toolExecutions: [],
    toolProgress: [],
    browserSession: null
  })
  
  const [uiState, setUIState] = useState<ChatUIState>({
    isConnected: true,
    isTyping: false,
    showProgressPanel: false,
    agentStatus: 'idle',
    latencyMetrics: {
      requestStartTime: null,
      timeToFirstToken: null,
      endToEndLatency: null
    }
  })
  
  const currentToolExecutionsRef = useRef<ToolExecution[]>([])
  const currentTurnIdRef = useRef<string | null>(null)

  useEffect(() => {
    currentToolExecutionsRef.current = sessionState.toolExecutions
  }, [sessionState.toolExecutions])

  // Auto-detect backend URL
  useEffect(() => {
    const initBackend = async () => {
      const { url, connected } = await detectBackendUrl()
      setBackendUrl(url)
      setUIState(prev => ({ ...prev, isConnected: connected }))
    }
    initBackend()
  }, [])

  // Clear progress states on page refresh/reload
  useEffect(() => {
    const isPageRefresh = typeof window !== 'undefined' && 
      (window.performance?.navigation?.type === 1 || 
       (window.performance?.getEntriesByType('navigation')?.[0] as any)?.type === 'reload');
    
    if (isPageRefresh) {
      setSessionState(prev => ({ 
        ...prev, 
        toolProgress: [] 
      }));
    }
  }, []);

  const handleLegacyEvent = useCallback((data: any) => {
    switch (data.type) {
      case 'init':
      case 'thinking':
        setUIState(prev => ({ ...prev, isTyping: true }))
        break
      case 'complete':
        setUIState(prev => ({ ...prev, isTyping: false }))
        if (data.message) {
          setMessages(prev => [...prev, {
            id: Date.now(),
            text: data.message,
            sender: 'bot',
            timestamp: new Date().toLocaleTimeString(),
            images: data.images || []
          }])
        }
        break
      case 'error':
        setUIState(prev => ({ ...prev, isTyping: false }))
        setMessages(prev => [...prev, {
          id: Date.now(),
          text: data.message || 'An error occurred',
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString()
        }])
        break
    }
  }, [])

  // Initialize stream events hook
  const { handleStreamEvent } = useStreamEvents({
    sessionState,
    setSessionState,
    setMessages,
    setUIState,
    uiState,
    currentToolExecutionsRef,
    currentTurnIdRef,
    availableTools
  })

  // Callback when new session is created
  const handleSessionCreated = useCallback(() => {
    // Call window refresh function if available
    if (typeof (window as any).__refreshSessionList === 'function') {
      (window as any).__refreshSessionList();
    }
    // Also call prop callback if provided
    props?.onSessionCreated?.();
  }, [props]);

  // Initialize chat API hook
  const { loadTools, toggleTool: apiToggleTool, newChat: apiNewChat, sendMessage: apiSendMessage, cleanup, sessionId, loadSession } = useChatAPI({
    backendUrl,
    setUIState,
    setMessages,
    availableTools,
    setAvailableTools,
    handleStreamEvent,
    handleLegacyEvent,
    gatewayToolIds,
    onSessionCreated: handleSessionCreated
  })

  // Function to clear stored progress events
  const clearProgressEvents = useCallback(async () => {
    // Get current sessionId from sessionStorage to avoid stale closure
    const currentSessionId = sessionStorage.getItem('chat-session-id')
    if (!currentSessionId) return

    try {
      const response = await fetch(getApiUrl(`stream/tools/clear?session_id=${currentSessionId}`), {
        method: 'POST',
      })

      if (response.ok) {
        console.log('Progress events cleared for session:', currentSessionId)
      }
    } catch (error) {
      console.warn('Failed to clear progress events:', error)
    }
  }, [])

  // Load tools when backend is ready (only clear progress events on initial load)
  useEffect(() => {
    if (uiState.isConnected) {
      const timeoutId = setTimeout(async () => {
        // Only clear progress events on the very first connection
        const isFirstLoad = sessionStorage.getItem('chat-first-load') !== 'false'
        if (isFirstLoad) {
          await clearProgressEvents()
          sessionStorage.setItem('chat-first-load', 'false')
        }
        // Always load tools
        await loadTools()
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [uiState.isConnected, clearProgressEvents])

  // Restore last session on page load
  useEffect(() => {
    const lastSessionId = sessionStorage.getItem('chat-session-id')

    if (lastSessionId) {
      loadSession(lastSessionId).catch(error => {
        // Load failed, clear sessionStorage
        sessionStorage.removeItem('chat-session-id')
        setMessages([])
      })
    } else {
      setMessages([])
    }
  }, []) // Empty dependency - run once on mount

  // Restore browserSession from DynamoDB when chat session loads
  useEffect(() => {
    if (!sessionId) return

    async function loadBrowserSession() {
      try {
        // First try sessionStorage cache
        const cachedBrowserSession = sessionStorage.getItem(`browser-session-${sessionId}`)
        if (cachedBrowserSession) {
          const browserSession = JSON.parse(cachedBrowserSession)
          console.log('[useChat] Restoring browser session from cache:', browserSession)
          setSessionState(prev => ({
            ...prev,
            browserSession
          }))
          return
        }

        // Load from DynamoDB
        // Get auth headers
        const authHeaders: Record<string, string> = {}
        try {
          const session = await fetchAuthSession()
          const token = session.tokens?.idToken?.toString()
          if (token) {
            authHeaders['Authorization'] = `Bearer ${token}`
          } else {
            // No token available - skip this request
            console.log('[useChat] No auth token available, skipping browser session restore')
            return
          }
        } catch (error) {
          console.log('[useChat] No auth session available, skipping browser session restore')
          return
        }

        const response = await fetch(`/api/session/${sessionId}`, {
          headers: authHeaders
        })

        // 404 is expected for new sessions not yet saved to DynamoDB
        if (response.status === 404) {
          console.log('[useChat] Session not yet created in DynamoDB (new session)')
          // Clear browser session from previous session
          setSessionState(prev => ({
            ...prev,
            browserSession: null
          }))
          return
        }

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.session?.metadata?.browserSession) {
            const browserSession = data.session.metadata.browserSession
            console.log('[useChat] Restoring browser session from DynamoDB:', browserSession)

            // Update state
            setSessionState(prev => ({
              ...prev,
              browserSession
            }))

            // Cache in sessionStorage
            sessionStorage.setItem(`browser-session-${sessionId}`, JSON.stringify(browserSession))
          } else {
            // Clear browser session if no data
            console.log('[useChat] No browser session found for this session')
            setSessionState(prev => ({
              ...prev,
              browserSession: null
            }))
          }
        }
      } catch (e) {
        // Silently ignore errors - browserSession is optional
        console.log('[useChat] Could not load browser session:', e)
      }
    }

    loadBrowserSession()
  }, [sessionId]) // Run when sessionId changes

  // Wrapper functions to maintain the same interface
  const toggleTool = useCallback(async (toolId: string) => {
    await apiToggleTool(toolId)
  }, [apiToggleTool])

  const refreshTools = useCallback(async () => {
    await loadTools()
  }, [])

  const newChat = useCallback(async () => {
    // Save current sessionId to clean up its browser session
    const oldSessionId = sessionId

    const success = await apiNewChat()
    if (success) {
      setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [], browserSession: null })
      setUIState(prev => ({ ...prev, isTyping: false }))
      // Clear messages to start fresh
      setMessages([])
      // Clear browser session for old chat session
      if (oldSessionId) {
        sessionStorage.removeItem(`browser-session-${oldSessionId}`)
      }
    }
  }, [apiNewChat, setMessages, sessionId])

  const sendMessage = useCallback(async (e: React.FormEvent, files?: File[]) => {
    e.preventDefault()
    if (!inputMessage.trim() && (!files || files.length === 0)) return

    const userMessage: Message = {
      id: Date.now(),
      text: inputMessage,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString(),
      ...(files && files.length > 0 ? {
        uploadedFiles: files.map(file => ({
          name: file.name,
          type: file.type,
          size: file.size
        }))
      } : {})
    }

    // Generate new turn ID for this conversation turn
    const newTurnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    currentTurnIdRef.current = newTurnId

    // Record request start time for latency metrics
    const requestStartTime = Date.now()

    setMessages(prev => [...prev, userMessage])
    setUIState(prev => ({
      ...prev,
      isTyping: false,
      latencyMetrics: {
        requestStartTime,
        timeToFirstToken: null,
        endToEndLatency: null
      }
    }))
    // Keep browserSession from previous state - don't reset it
    setSessionState(prev => ({
      ...prev,
      reasoning: null,
      streaming: null,
      toolExecutions: [],
      toolProgress: []
    }))

    // Reset ref as well
    currentToolExecutionsRef.current = []

    const messageToSend = inputMessage || (files && files.length > 0 ? "Please analyze the uploaded file(s)." : "")
    setInputMessage('')

    await apiSendMessage(
      messageToSend,
      files,
      () => {
        // Success callback - already handled in API hook
      },
      (error) => {
        // Error callback
        setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [], browserSession: null })
      }
    )
  }, [inputMessage, apiSendMessage])

  // Group messages into turns for better UI
  const groupedMessages = useMemo(() => {
    const grouped: Array<{
      type: 'user' | 'assistant_turn'
      messages: Message[]
      id: string
    }> = []
    
    let currentAssistantTurn: Message[] = []
    
    for (const message of messages) {
      if (message.sender === 'user') {
        // Finish current assistant turn if exists
        if (currentAssistantTurn.length > 0) {
          grouped.push({
            type: 'assistant_turn',
            messages: [...currentAssistantTurn],
            id: `turn_${currentAssistantTurn[0].id}`
          })
          currentAssistantTurn = []
        }
        
        // Add user message
        grouped.push({
          type: 'user',
          messages: [message],
          id: `user_${message.id}`
        })
      } else {
        // Add to current assistant turn
        currentAssistantTurn.push(message)
      }
    }
    
    // Finish final assistant turn if exists
    if (currentAssistantTurn.length > 0) {
      grouped.push({
        type: 'assistant_turn',
        messages: [...currentAssistantTurn],
        id: `turn_${currentAssistantTurn[0].id}`
      })
    }
    
    return grouped
  }, [messages])

  // Progress panel toggle function
  const toggleProgressPanel = useCallback(() => {
    setUIState(prev => ({ ...prev, showProgressPanel: !prev.showProgressPanel }))
  }, [])

  // Handler for Gateway tool changes
  const handleGatewayToolsChange = useCallback((enabledToolIds: string[]) => {
    setGatewayToolIds(enabledToolIds);
  }, []);

  // Stop generation function
  const stopGeneration = useCallback(() => {
    // Calculate End-to-End Latency (when manually stopped)
    const requestStartTime = uiState.latencyMetrics.requestStartTime
    if (requestStartTime) {
      const e2eLatency = Date.now() - requestStartTime
      const ttft = uiState.latencyMetrics.timeToFirstToken || 0
      console.log(`[Latency] End-to-End Latency (Stopped): ${e2eLatency}ms (TTFT: ${ttft}ms)`)
    }

    cleanup()
    setUIState(prev => {
      const requestStartTime = prev.latencyMetrics.requestStartTime
      const e2eLatency = requestStartTime ? Date.now() - requestStartTime : null

      return {
        ...prev,
        isTyping: false,
        agentStatus: 'idle',
        latencyMetrics: {
          ...prev.latencyMetrics,
          endToEndLatency: e2eLatency
        }
      }
    })
  }, [cleanup, uiState])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    messages,
    groupedMessages,
    inputMessage,
    setInputMessage,
    isConnected: uiState.isConnected,
    isTyping: uiState.isTyping,
    agentStatus: uiState.agentStatus,
    availableTools,
    currentToolExecutions: sessionState.toolExecutions,
    currentReasoning: sessionState.reasoning,
    toolProgress: sessionState.toolProgress,
    showProgressPanel: uiState.showProgressPanel,
    toggleProgressPanel,
    sendMessage,
    stopGeneration,
    newChat,
    toggleTool,
    refreshTools,
    sessionId,
    loadSession,
    onGatewayToolsChange: handleGatewayToolsChange,
    browserSession: sessionState.browserSession
  }
}
