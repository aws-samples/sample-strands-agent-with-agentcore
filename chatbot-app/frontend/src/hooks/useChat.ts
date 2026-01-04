import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { ReasoningState, ChatSessionState, ChatUIState, InterruptState, AgentStatus } from '@/types/events'
import { detectBackendUrl } from '@/utils/chat'
import { useStreamEvents } from './useStreamEvents'
import { useChatAPI, SessionPreferences } from './useChatAPI'
import { usePolling, hasOngoingA2ATools, A2A_TOOLS_REQUIRING_POLLING } from './usePolling'
import { getApiUrl } from '@/config/environment'
import { fetchAuthSession } from 'aws-amplify/auth'
import { apiPost } from '@/lib/api-client'

interface UseChatProps {
  onSessionCreated?: () => void
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
  agentStatus: AgentStatus
  availableTools: Tool[]
  currentToolExecutions: ToolExecution[]
  currentReasoning: ReasoningState | null
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
  browserProgress?: Array<{ stepNumber: number; content: string }>
  respondToInterrupt: (interruptId: string, response: string) => Promise<void>
  currentInterrupt: InterruptState | null
}

// Default preferences when session has no saved preferences
const DEFAULT_PREFERENCES: SessionPreferences = {
  lastModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  lastTemperature: 0.7,
  enabledTools: [],
  selectedPromptId: 'general',
}

export const useChat = (props?: UseChatProps): UseChatReturn => {
  // ==================== STATE ====================
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000')
  const [availableTools, setAvailableTools] = useState<Tool[]>([])
  const [gatewayToolIds, setGatewayToolIds] = useState<string[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const [sessionState, setSessionState] = useState<ChatSessionState>({
    reasoning: null,
    streaming: null,
    toolExecutions: [],
    browserSession: null,
    interrupt: null
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

  // ==================== REFS ====================
  const currentToolExecutionsRef = useRef<ToolExecution[]>([])
  const currentTurnIdRef = useRef<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  // Keep refs in sync with state
  useEffect(() => {
    currentToolExecutionsRef.current = sessionState.toolExecutions
  }, [sessionState.toolExecutions])

  useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  // ==================== BACKEND DETECTION ====================
  useEffect(() => {
    const initBackend = async () => {
      const { url, connected } = await detectBackendUrl()
      setBackendUrl(url)
      setUIState(prev => ({ ...prev, isConnected: connected }))
    }
    initBackend()
  }, [])

  // ==================== LEGACY EVENT HANDLER ====================
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
            id: String(Date.now()),
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
          id: String(Date.now()),
          text: data.message || 'An error occurred',
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString()
        }])
        break
    }
  }, [])

  // ==================== SESSION CREATED CALLBACK ====================
  const handleSessionCreated = useCallback(() => {
    if (typeof (window as any).__refreshSessionList === 'function') {
      (window as any).__refreshSessionList()
    }
    props?.onSessionCreated?.()
  }, [props])

  // ==================== POLLING HOOK ====================
  // Note: Initialize polling first, then pass startPolling to useStreamEvents
  const startPollingRef = useRef<((sessionId: string) => void) | null>(null)

  // ==================== STREAM EVENTS HOOK ====================
  const { handleStreamEvent, resetStreamingState } = useStreamEvents({
    sessionState,
    setSessionState,
    setMessages,
    setUIState,
    uiState,
    currentToolExecutionsRef,
    currentTurnIdRef,
    startPollingRef,
    sessionId,
    availableTools
  })

  // ==================== CHAT API HOOK ====================
  const {
    loadTools,
    toggleTool: apiToggleTool,
    newChat: apiNewChat,
    sendMessage: apiSendMessage,
    cleanup,
    sendStopSignal,
    loadSession: apiLoadSession
  } = useChatAPI({
    backendUrl,
    setUIState,
    setMessages,
    availableTools,
    setAvailableTools,
    handleStreamEvent,
    handleLegacyEvent,
    gatewayToolIds,
    sessionId,
    setSessionId,
    onSessionCreated: handleSessionCreated
  })

  // Initialize polling with apiLoadSession (now available)
  const { startPolling, stopPolling, checkAndStartPollingForA2ATools } = usePolling({
    sessionId,
    loadSession: apiLoadSession
  })

  // Update startPollingRef so useStreamEvents can use it
  useEffect(() => {
    startPollingRef.current = startPolling
  }, [startPolling])

  // ==================== A2A AGENT UI STATE MANAGEMENT ====================
  // Update UI status based on ongoing A2A agents (research/browser)
  // This is the ONLY place that sets researching/browser_automation status from messages
  useEffect(() => {
    if (!sessionId || currentSessionIdRef.current !== sessionId) return

    // Check for ongoing A2A agents
    const hasOngoingResearch = messages.some(msg =>
      msg.toolExecutions?.some(te =>
        !te.isComplete && !te.isCancelled && te.toolName === 'research_agent'
      )
    )

    const hasOngoingBrowser = messages.some(msg =>
      msg.toolExecutions?.some(te =>
        !te.isComplete && !te.isCancelled && te.toolName === 'browser_use_agent'
      )
    )

    if (hasOngoingResearch) {
      setUIState(prev => {
        if (prev.agentStatus !== 'researching') {
          console.log('[useChat] Setting status to researching')
          return { ...prev, isTyping: true, agentStatus: 'researching' }
        }
        return prev
      })
    } else if (hasOngoingBrowser) {
      setUIState(prev => {
        if (prev.agentStatus !== 'browser_automation') {
          console.log('[useChat] Setting status to browser_automation')
          return { ...prev, isTyping: true, agentStatus: 'browser_automation' }
        }
        return prev
      })
    }
    // Note: We do NOT set idle here. Only stream event handlers (complete/error) set idle.
  }, [messages, sessionId])

  // ==================== SESSION LOADING ====================
  const loadSessionWithPreferences = useCallback(async (newSessionId: string) => {
    // Immediately update session ref to prevent race conditions
    currentSessionIdRef.current = newSessionId

    // Stop any existing polling
    stopPolling()

    // Reset UI and session state
    setUIState(prev => ({
      ...prev,
      isTyping: false,
      agentStatus: 'idle',
      showProgressPanel: false
    }))

    setSessionState({
      reasoning: null,
      streaming: null,
      toolExecutions: [],
      browserSession: null,
      interrupt: null
    })

    const preferences = await apiLoadSession(newSessionId)

    // Verify session hasn't changed during async load
    if (currentSessionIdRef.current !== newSessionId) {
      console.log(`[useChat] Session changed during load, aborting setup`)
      return
    }

    // Check for ongoing A2A tools and start polling if needed
    // Use setTimeout to ensure messages state is updated
    setTimeout(() => {
      setMessages(currentMessages => {
        checkAndStartPollingForA2ATools(currentMessages, newSessionId)
        return currentMessages
      })
    }, 100)

    // Merge saved preferences with defaults
    const effectivePreferences: SessionPreferences = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
      lastModel: preferences?.lastModel || DEFAULT_PREFERENCES.lastModel,
      lastTemperature: preferences?.lastTemperature ?? DEFAULT_PREFERENCES.lastTemperature,
    }

    console.log(`[useChat] ${preferences ? 'Restoring session' : 'Using default'} preferences:`, effectivePreferences)

    // Restore tool states
    const enabledTools = effectivePreferences.enabledTools || []
    setAvailableTools(prevTools => prevTools.map(tool => ({
      ...tool,
      enabled: enabledTools.includes(tool.id)
    })))
    console.log(`[useChat] Tool states updated: ${enabledTools.length} enabled`)

    // Restore model configuration
    try {
      await apiPost('model/config/update', {
        model_id: effectivePreferences.lastModel,
        temperature: effectivePreferences.lastTemperature,
      }, {
        headers: newSessionId ? { 'X-Session-ID': newSessionId } : {},
      })
      console.log(`[useChat] Model config updated: ${effectivePreferences.lastModel}, temp=${effectivePreferences.lastTemperature}`)
    } catch (error) {
      console.warn('[useChat] Failed to update model config:', error)
    }
  }, [apiLoadSession, setAvailableTools, setUIState, setSessionState, stopPolling, checkAndStartPollingForA2ATools])

  // ==================== PROGRESS EVENTS ====================
  const clearProgressEvents = useCallback(async () => {
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

  // ==================== INITIALIZATION EFFECTS ====================
  // Load tools when backend is ready
  useEffect(() => {
    if (uiState.isConnected) {
      const timeoutId = setTimeout(async () => {
        const isFirstLoad = sessionStorage.getItem('chat-first-load') !== 'false'
        if (isFirstLoad) {
          await clearProgressEvents()
          sessionStorage.setItem('chat-first-load', 'false')
        }
        await loadTools()
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [uiState.isConnected, clearProgressEvents, loadTools])

  // Restore last session on page load
  useEffect(() => {
    const lastSessionId = sessionStorage.getItem('chat-session-id')
    if (lastSessionId) {
      loadSessionWithPreferences(lastSessionId).catch(() => {
        sessionStorage.removeItem('chat-session-id')
        setMessages([])
      })
    } else {
      setMessages([])
    }
  }, [])

  // Restore browserSession from DynamoDB when chat session loads
  useEffect(() => {
    if (!sessionId) return

    async function loadBrowserSession() {
      try {
        // Try sessionStorage cache first
        const cachedBrowserSession = sessionStorage.getItem(`browser-session-${sessionId}`)
        if (cachedBrowserSession) {
          const browserSession = JSON.parse(cachedBrowserSession)
          console.log('[useChat] Restoring browser session from cache:', browserSession)
          setSessionState(prev => ({ ...prev, browserSession }))
          return
        }

        // Get auth headers
        const authHeaders: Record<string, string> = {}
        try {
          const session = await fetchAuthSession()
          const token = session.tokens?.idToken?.toString()
          if (token) {
            authHeaders['Authorization'] = `Bearer ${token}`
          } else {
            console.log('[useChat] No auth token available, skipping browser session restore')
            return
          }
        } catch {
          console.log('[useChat] No auth session available, skipping browser session restore')
          return
        }

        const response = await fetch(`/api/session/${sessionId}`, { headers: authHeaders })

        if (response.status === 404) {
          console.log('[useChat] Session not yet created in DynamoDB (new session)')
          setSessionState(prev => ({ ...prev, browserSession: null }))
          return
        }

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.session?.metadata?.browserSession) {
            const browserSession = data.session.metadata.browserSession
            console.log('[useChat] Restoring browser session from DynamoDB:', browserSession)
            setSessionState(prev => ({ ...prev, browserSession }))
            sessionStorage.setItem(`browser-session-${sessionId}`, JSON.stringify(browserSession))
          } else {
            console.log('[useChat] No browser session found for this session')
            setSessionState(prev => ({ ...prev, browserSession: null }))
          }
        }
      } catch (e) {
        console.log('[useChat] Could not load browser session:', e)
      }
    }

    loadBrowserSession()
  }, [sessionId])

  // ==================== ACTIONS ====================
  const toggleTool = useCallback(async (toolId: string) => {
    await apiToggleTool(toolId)
  }, [apiToggleTool])

  const refreshTools = useCallback(async () => {
    await loadTools()
  }, [loadTools])

  const newChat = useCallback(async () => {
    const oldSessionId = sessionId

    // Invalidate current session
    currentSessionIdRef.current = `temp_${Date.now()}`
    stopPolling()

    const success = await apiNewChat()
    if (success) {
      setSessionState({
        reasoning: null,
        streaming: null,
        toolExecutions: [],
        browserSession: null,
        interrupt: null
      })
      setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
      setMessages([])
      if (oldSessionId) {
        sessionStorage.removeItem(`browser-session-${oldSessionId}`)
      }
    }
  }, [apiNewChat, sessionId, stopPolling])

  const respondToInterrupt = useCallback(async (interruptId: string, response: string) => {
    if (!sessionState.interrupt) return

    setSessionState(prev => ({ ...prev, interrupt: null }))

    const isResearchInterrupt = sessionState.interrupt.interrupts.some(
      int => int.reason?.tool_name === 'research_agent'
    )
    const isBrowserUseInterrupt = sessionState.interrupt.interrupts.some(
      int => int.reason?.tool_name === 'browser_use_agent'
    )

    let agentStatus: 'thinking' | 'researching' | 'browser_automation' = 'thinking'
    if (isResearchInterrupt) agentStatus = 'researching'
    else if (isBrowserUseInterrupt) agentStatus = 'browser_automation'

    setUIState(prev => ({ ...prev, isTyping: true, agentStatus }))

    const overrideTools = isResearchInterrupt
      ? ['agentcore_research-agent']
      : isBrowserUseInterrupt
      ? ['agentcore_browser-use-agent']
      : undefined

    try {
      await apiSendMessage(
        JSON.stringify([{ interruptResponse: { interruptId, response } }]),
        undefined,
        undefined,
        () => setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' })),
        overrideTools
      )
    } catch (error) {
      console.error('[Interrupt] Failed to respond to interrupt:', error)
      setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
    }
  }, [sessionState.interrupt, apiSendMessage])

  const sendMessage = useCallback(async (e: React.FormEvent, files?: File[]) => {
    e.preventDefault()
    if (!inputMessage.trim() && (!files || files.length === 0)) return

    const userMessage: Message = {
      id: String(Date.now()),
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

    currentTurnIdRef.current = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const requestStartTime = Date.now()

    setMessages(prev => [...prev, userMessage])
    setUIState(prev => ({
      ...prev,
      isTyping: true,
      agentStatus: 'thinking',
      latencyMetrics: {
        requestStartTime,
        timeToFirstToken: null,
        endToEndLatency: null
      }
    }))
    setSessionState(prev => ({
      ...prev,
      reasoning: null,
      streaming: null,
      toolExecutions: []
    }))
    currentToolExecutionsRef.current = []

    const messageToSend = inputMessage || (files && files.length > 0 ? "Please analyze the uploaded file(s)." : "")
    setInputMessage('')

    await apiSendMessage(
      messageToSend,
      files,
      () => {},
      () => {
        setSessionState(prev => ({
          reasoning: null,
          streaming: null,
          toolExecutions: [],
          browserSession: prev.browserSession,
          browserProgress: undefined,
          interrupt: null
        }))
      }
    )
  }, [inputMessage, apiSendMessage])

  const stopGeneration = useCallback(() => {
    setUIState(prev => ({ ...prev, agentStatus: 'stopping' }))
    sendStopSignal()
  }, [sendStopSignal])

  // ==================== DERIVED STATE ====================
  const groupedMessages = useMemo(() => {
    const grouped: Array<{
      type: 'user' | 'assistant_turn'
      messages: Message[]
      id: string
    }> = []

    let currentAssistantTurn: Message[] = []

    for (const message of messages) {
      if (message.sender === 'user') {
        if (currentAssistantTurn.length > 0) {
          grouped.push({
            type: 'assistant_turn',
            messages: [...currentAssistantTurn],
            id: `turn_${currentAssistantTurn[0].id}`
          })
          currentAssistantTurn = []
        }
        grouped.push({
          type: 'user',
          messages: [message],
          id: `user_${message.id}`
        })
      } else {
        currentAssistantTurn.push(message)
      }
    }

    if (currentAssistantTurn.length > 0) {
      grouped.push({
        type: 'assistant_turn',
        messages: [...currentAssistantTurn],
        id: `turn_${currentAssistantTurn[0].id}`
      })
    }

    return grouped
  }, [messages])

  const toggleProgressPanel = useCallback(() => {
    setUIState(prev => ({ ...prev, showProgressPanel: !prev.showProgressPanel }))
  }, [])

  const handleGatewayToolsChange = useCallback((enabledToolIds: string[]) => {
    setGatewayToolIds(enabledToolIds)
  }, [])

  // ==================== CLEANUP ====================
  useEffect(() => {
    return cleanup
  }, [cleanup])

  // ==================== RETURN ====================
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
    showProgressPanel: uiState.showProgressPanel,
    toggleProgressPanel,
    sendMessage,
    stopGeneration,
    newChat,
    toggleTool,
    refreshTools,
    sessionId,
    loadSession: loadSessionWithPreferences,
    onGatewayToolsChange: handleGatewayToolsChange,
    browserSession: sessionState.browserSession,
    browserProgress: sessionState.browserProgress,
    respondToInterrupt,
    currentInterrupt: sessionState.interrupt,
  }
}
