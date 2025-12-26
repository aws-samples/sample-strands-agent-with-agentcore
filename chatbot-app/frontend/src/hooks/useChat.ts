import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { ReasoningState, ChatSessionState, ChatUIState, InterruptState, AgentStatus } from '@/types/events'
import { detectBackendUrl } from '@/utils/chat'
import { useStreamEvents } from './useStreamEvents'
import { useChatAPI, SessionPreferences } from './useChatAPI'
import { getApiUrl } from '@/config/environment'
import API_CONFIG from '@/config/api'
import { fetchAuthSession } from 'aws-amplify/auth'
import { apiPost } from '@/lib/api-client'


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

export const useChat = (props?: UseChatProps): UseChatReturn => {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000')
  const [availableTools, setAvailableTools] = useState<Tool[]>([])
  const [gatewayToolIds, setGatewayToolIds] = useState<string[]>([])  // Gateway tool IDs from frontend
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
  
  const currentToolExecutionsRef = useRef<ToolExecution[]>([])
  const currentTurnIdRef = useRef<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const staleSessionLoadRef = useRef<string | null>(null) // Track stale session loads to ignore in useEffect
  const startPollingRef = useRef<((sessionId: string) => void) | null>(null)

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
    startPollingRef,
    sessionId,
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
  const { loadTools, toggleTool: apiToggleTool, newChat: apiNewChat, sendMessage: apiSendMessage, cleanup, loadSession: apiLoadSession } = useChatAPI({
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

  // Track current active session in ref for polling checks
  useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  // Default preferences when session has no saved preferences
  const DEFAULT_PREFERENCES: SessionPreferences = {
    lastModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    lastTemperature: 0.7,
    enabledTools: [], // All tools disabled by default
    selectedPromptId: 'general',
  }

  // Polling for ongoing tool executions
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingActiveRef = useRef(false)
  const pollingSessionIdRef = useRef<string | null>(null) // Track which session is being polled

  const startPollingForOngoingTools = useCallback((targetSessionId: string) => {
    // Clear any existing polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }

    console.log(`[useChat] Starting polling for session: ${targetSessionId}`)
    isPollingActiveRef.current = true
    pollingSessionIdRef.current = targetSessionId // Store the session being polled

    const poll = async () => {
      try {
        // Check if we're still polling the same session
        if (pollingSessionIdRef.current !== targetSessionId) {
          console.log(`[useChat] Polling session mismatch, stopping poll (expected: ${pollingSessionIdRef.current}, got: ${targetSessionId})`)
          return
        }

        // CRITICAL: Check if the target session is still the current active session
        // This prevents Session A's polling from interfering with Session B
        if (currentSessionIdRef.current !== targetSessionId) {
          console.log(`[useChat] Target session ${targetSessionId} is no longer active (current: ${currentSessionIdRef.current}), stopping poll`)
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }
          isPollingActiveRef.current = false
          pollingSessionIdRef.current = null
          return
        }

        console.log(`[useChat] Polling: reloading session ${targetSessionId}...`)
        await apiLoadSession(targetSessionId)

        // Double-check after async operation: session might have changed during the load
        if (currentSessionIdRef.current !== targetSessionId) {
          console.log(`[useChat] Session changed during polling load (${targetSessionId} → ${currentSessionIdRef.current}), marking as stale`)
          // Mark this session load as stale so useEffect will ignore its messages
          staleSessionLoadRef.current = targetSessionId
          // Stop polling since we loaded stale data for wrong session
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }
          isPollingActiveRef.current = false
          pollingSessionIdRef.current = null
          return
        }

        // CRITICAL: Check if polling should stop after loading messages
        // This check must be done INSIDE poll() because React state updates may not trigger useEffect
        setMessages(currentMessages => {
          const hasOngoingTools = currentMessages.some(msg =>
            msg.toolExecutions &&
            msg.toolExecutions.some(te => !te.isComplete)
          )

          // Check if there's a completed tool but missing final assistant response
          let hasCompletedToolAwaitingResponse = false
          for (let i = currentMessages.length - 1; i >= 0; i--) {
            const msg = currentMessages[i]
            if (msg.toolExecutions && msg.toolExecutions.some(te => te.isComplete)) {
              const hasFollowupResponse = currentMessages.slice(i + 1).some(
                laterMsg => laterMsg.sender === 'bot' && laterMsg.text && laterMsg.text.trim()
              )
              if (!hasFollowupResponse) {
                hasCompletedToolAwaitingResponse = true
              }
              break
            }
          }

          // Stop polling if no ongoing tools and agent has responded
          if (!hasOngoingTools && !hasCompletedToolAwaitingResponse) {
            console.log('[useChat] Polling: No ongoing tools detected, stopping polling')
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current)
              pollingIntervalRef.current = null
            }
            isPollingActiveRef.current = false
            pollingSessionIdRef.current = null

            // Reset UI state
            setUIState(prev => ({
              ...prev,
              isTyping: false,
              agentStatus: 'idle'
            }))
          }

          return currentMessages  // No change to messages
        })
      } catch (error) {
        console.error('[useChat] Polling error:', error)
      }
    }

    // Don't poll immediately - wait for first interval
    // This prevents overwriting messages during active streaming
    // Poll every 5 seconds
    pollingIntervalRef.current = setInterval(poll, 5000)
  }, [apiLoadSession])

  // Update ref with the actual function
  startPollingRef.current = startPollingForOngoingTools

  // Monitor messages for ongoing tools (separate effect)
  useEffect(() => {
    // Only process if we have a valid sessionId
    if (!sessionId) {
      return
    }

    // CRITICAL 1: Ignore messages from stale session loads marked by polling
    // This prevents Session A's ongoing browser automation from affecting Session B's UI
    // when polling loads Session A's data after user switched to Session B
    if (staleSessionLoadRef.current === sessionId) {
      console.log(`[useChat] Ignoring stale session data for ${sessionId}`)
      staleSessionLoadRef.current = null // Clear the flag
      return
    }

    // CRITICAL 2: Only process if this sessionId matches the current active session
    // This prevents Session B's data from affecting Session C's UI during rapid session switches
    if (currentSessionIdRef.current !== sessionId) {
      console.log(`[useChat] Ignoring messages from inactive session ${sessionId} (current: ${currentSessionIdRef.current})`)
      return
    }

    const hasOngoingTools = messages.some(msg =>
      msg.toolExecutions &&
      msg.toolExecutions.some(te => !te.isComplete)
    )

    // Check for ongoing A2A agents (research_agent or browser_use_agent)
    const hasOngoingResearch = messages.some(msg =>
      msg.toolExecutions &&
      msg.toolExecutions.some(te => !te.isComplete && !te.isCancelled && te.toolName === 'research_agent')
    )

    const hasOngoingBrowserAutomation = messages.some(msg =>
      msg.toolExecutions &&
      msg.toolExecutions.some(te => !te.isComplete && !te.isCancelled && te.toolName === 'browser_use_agent')
    )

    // Check if there's a completed tool but missing final assistant response
    // This happens when tool_result is saved but agent hasn't generated final text response yet
    let hasCompletedToolAwaitingResponse = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]

      // If we find a tool execution that's complete
      if (msg.toolExecutions && msg.toolExecutions.some(te => te.isComplete)) {
        // Check if there's any assistant message with text after this
        const hasFollowupResponse = messages.slice(i + 1).some(
          laterMsg => laterMsg.sender === 'bot' && laterMsg.text && laterMsg.text.trim()
        )

        if (!hasFollowupResponse) {
          hasCompletedToolAwaitingResponse = true
          console.log('[useChat] Found completed tool without followup assistant response')
        }
        break
      }
    }

    // === POLLING MANAGEMENT ===
    // Stop polling if all tools complete AND agent has responded
    if (isPollingActiveRef.current && !hasOngoingTools && !hasCompletedToolAwaitingResponse) {
      console.log('[useChat] All tool executions complete and agent responded, stopping polling')

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }

      isPollingActiveRef.current = false

      // Reset UI state when complete
      setUIState(prev => ({
        ...prev,
        isTyping: false,
        agentStatus: 'idle'
      }))
    }

    // === UI STATE MANAGEMENT ===
    // Update UI status based on agent type
    if (hasOngoingResearch) {
      setUIState(prev => {
        if (prev.agentStatus !== 'researching') {
          console.log('[useChat] Setting status to researching')
          return {
            ...prev,
            isTyping: true,
            agentStatus: 'researching'
          }
        }
        return prev
      })
    } else if (hasOngoingBrowserAutomation) {
      setUIState(prev => {
        if (prev.agentStatus !== 'browser_automation') {
          console.log('[useChat] Setting status to browser_automation')
          return {
            ...prev,
            isTyping: true,
            agentStatus: 'browser_automation'
          }
        }
        return prev
      })
    }
  }, [messages, sessionId, setUIState])

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      isPollingActiveRef.current = false
      pollingSessionIdRef.current = null // Clear the polling session ID
      console.log('[useChat] Polling stopped')
    }
  }, [])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  // Wrapper for loadSession that restores session preferences (model, tools)
  const loadSessionWithPreferences = useCallback(async (newSessionId: string) => {
    // CRITICAL: Immediately update the current session ref to prevent race conditions
    // This ensures any in-flight polling operations will detect the session change
    currentSessionIdRef.current = newSessionId

    // Clear any stale session flags from previous loads
    staleSessionLoadRef.current = null

    // Stop any existing polling from previous session
    stopPolling()

    // Reset UI and session state when loading a different session
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

    // Verify the session hasn't changed during the async load operation
    if (currentSessionIdRef.current !== newSessionId) {
      console.log(`[useChat] Session changed during load (${newSessionId} → ${currentSessionIdRef.current}), aborting setup`)
      return
    }

    // Check if there are ongoing tool executions after loading
    setTimeout(() => {
      setMessages(currentMessages => {
        const hasOngoingTools = currentMessages.some(msg =>
          msg.toolExecutions &&
          msg.toolExecutions.some(te => !te.isComplete)
        )

        if (hasOngoingTools) {
          console.log('[useChat] Detected ongoing tool executions, starting polling')
          startPollingForOngoingTools(newSessionId)
        }

        return currentMessages
      })
    }, 100)

    // Merge saved preferences with defaults (field-by-field fallback)
    // This handles cases where old sessions have partial or missing preferences
    const effectivePreferences: SessionPreferences = {
      lastModel: preferences?.lastModel || DEFAULT_PREFERENCES.lastModel,
      lastTemperature: preferences?.lastTemperature ?? DEFAULT_PREFERENCES.lastTemperature,
      enabledTools: preferences?.enabledTools || DEFAULT_PREFERENCES.enabledTools,
      selectedPromptId: preferences?.selectedPromptId || DEFAULT_PREFERENCES.selectedPromptId,
      customPromptText: preferences?.customPromptText,
    }
    const isUsingDefaults = !preferences

    console.log(`[useChat] ${isUsingDefaults ? 'Using default' : 'Restoring session'} preferences:`, effectivePreferences)

    // 1. Restore tool states based on enabledTools from session
    // If enabledTools is empty array or undefined, disable all tools
    setAvailableTools(prevTools => prevTools.map(tool => {
      const enabledTools = effectivePreferences.enabledTools || []
      const shouldBeEnabled = enabledTools.includes(tool.id)
      return { ...tool, enabled: shouldBeEnabled }
    }))
    console.log(`[useChat] Tool states updated: ${effectivePreferences.enabledTools?.length || 0} enabled`)

    // 2. Restore model configuration by updating user preferences
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

    // 3. Restore system prompt
    try {
      await apiPost(`model/prompts/${effectivePreferences.selectedPromptId || 'general'}/activate`, undefined, {
        headers: newSessionId ? { 'X-Session-ID': newSessionId } : {},
      })
      console.log(`[useChat] Prompt activated: ${effectivePreferences.selectedPromptId || 'general'}`)
    } catch (error) {
      console.warn('[useChat] Failed to activate prompt:', error)
    }
  }, [apiLoadSession, setAvailableTools, setUIState, setSessionState, stopPolling, startPollingForOngoingTools])

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
      loadSessionWithPreferences(lastSessionId).catch(error => {
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

    // CRITICAL: Immediately invalidate current session to prevent old session's polling
    // from affecting the new session during the async newChat operation
    const tempSessionId = `temp_${Date.now()}`
    currentSessionIdRef.current = tempSessionId

    // Stop any existing polling from old session
    stopPolling()

    // Clear stale session flags
    staleSessionLoadRef.current = null

    const success = await apiNewChat()
    if (success) {
      setSessionState({ reasoning: null, streaming: null, toolExecutions: [], browserSession: null, interrupt: null })
      setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
      // Clear messages to start fresh
      setMessages([])
      // Clear browser session for old chat session
      if (oldSessionId) {
        sessionStorage.removeItem(`browser-session-${oldSessionId}`)
      }
    }
  }, [apiNewChat, setMessages, sessionId, stopPolling])

  const respondToInterrupt = useCallback(async (interruptId: string, response: string) => {
    if (!sessionState.interrupt) return

    // Clear interrupt state
    setSessionState(prev => ({ ...prev, interrupt: null }))

    // Determine if this is research agent or browser use agent interrupt
    const isResearchInterrupt = sessionState.interrupt.interrupts.some(
      int => int.reason?.tool_name === 'research_agent'
    )
    const isBrowserUseInterrupt = sessionState.interrupt.interrupts.some(
      int => int.reason?.tool_name === 'browser_use_agent'
    )

    // Set appropriate status: 'researching' for research agent, 'browser_automation' for browser use, 'thinking' for others
    let agentStatus: 'thinking' | 'researching' | 'browser_automation' = 'thinking'
    if (isResearchInterrupt) {
      agentStatus = 'researching'
    } else if (isBrowserUseInterrupt) {
      agentStatus = 'browser_automation'
    }

    setUIState(prev => ({
      ...prev,
      isTyping: true,
      agentStatus
    }))

    // Send interrupt response to backend (similar to sendMessage but with interruptResponse)
    // For Research Agent or Browser Use Agent, override enabled tools to only include that agent
    const overrideTools = isResearchInterrupt
      ? ['agentcore_research-agent']
      : isBrowserUseInterrupt
      ? ['agentcore_browser-use-agent']
      : undefined

    try {
      await apiSendMessage(
        JSON.stringify([{
          interruptResponse: {
            interruptId,
            response
          }
        }]),
        undefined, // no files
        undefined, // onSuccess
        (error) => {
          console.error('[Interrupt] Error sending interrupt response:', error)
          setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
        },
        overrideTools // Override enabled tools for Research/Browser agents
      )
    } catch (error) {
      console.error('[Interrupt] Failed to respond to interrupt:', error)
      setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
    }
  }, [sessionState.interrupt, apiSendMessage, setSessionState, setUIState])

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
      isTyping: true,  // Set to true when sending message to prevent premature polling
      agentStatus: 'thinking',
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
      toolExecutions: []
    }))

    // Reset ref as well
    currentToolExecutionsRef.current = []

    const messageToSend = inputMessage || (files && files.length > 0 ? "Please analyze the uploaded file(s)." : "")
    setInputMessage('')

    await apiSendMessage(
      messageToSend,
      files,
      () => {
        // Success callback - handled by streaming events
      },
      (error) => {
        // Error callback - preserve browserSession to keep Live View button available
        setSessionState(prev => ({
          reasoning: null,
          streaming: null,
          toolExecutions: [],
          browserSession: prev.browserSession,  // Preserve browser session on error
          browserProgress: undefined,  // Clear browser progress on error
          interrupt: null
        }))
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
    currentInterrupt: sessionState.interrupt
  }
}
