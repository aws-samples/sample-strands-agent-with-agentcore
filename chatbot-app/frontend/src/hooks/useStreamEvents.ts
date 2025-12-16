import { useCallback, useRef } from 'react'
import { Message, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatSessionState, ChatUIState } from '@/types/events'
import { useLatencyTracking } from './useLatencyTracking'
import { fetchAuthSession } from 'aws-amplify/auth'
import { updateLastActivity } from '@/config/session'

interface UseStreamEventsProps {
  sessionState: ChatSessionState
  setSessionState: React.Dispatch<React.SetStateAction<ChatSessionState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  uiState: ChatUIState
  currentToolExecutionsRef: React.MutableRefObject<ToolExecution[]>
  currentTurnIdRef: React.MutableRefObject<string | null>
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
}

export const useStreamEvents = ({
  sessionState,
  setSessionState,
  setMessages,
  setUIState,
  uiState,
  currentToolExecutionsRef,
  currentTurnIdRef,
  availableTools = []
}: UseStreamEventsProps) => {
  // Refs to track streaming state synchronously (avoid React batching issues)
  const streamingStartedRef = useRef(false)
  const streamingIdRef = useRef<number | null>(null)
  const completeProcessedRef = useRef(false)

  // Latency tracking hook (encapsulates all latency-related refs and logic)
  const latencyTracking = useLatencyTracking()

  const handleReasoningEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'reasoning') {
      setSessionState(prev => ({
        ...prev,
        reasoning: { text: data.text, isActive: true }
      }))
    }
  }, [setSessionState])

  const handleResponseEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'response') {
      // Finalize reasoning step if active
      if (sessionState.reasoning?.isActive) {
        setSessionState(prev => ({
          ...prev,
          reasoning: prev.reasoning ? { ...prev.reasoning, isActive: false } : null
        }))
      }

      // Check if this is the first response chunk
      if (!streamingStartedRef.current) {
        // Create new streaming message
        streamingStartedRef.current = true
        const newId = Date.now() + Math.random()
        streamingIdRef.current = newId

        setMessages(prevMsgs => [...prevMsgs, {
          id: newId,
          text: data.text,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString(),
          isStreaming: true,
          images: []
        }])

        setSessionState(prev => ({
          ...prev,
          streaming: { text: data.text, id: newId }
        }))

        // Record TTFT and transition to 'responding' (only on thinking -> responding)
        setUIState(prevUI => {
          if (prevUI.agentStatus === 'thinking') {
            const ttft = latencyTracking.recordTTFT()
            return {
              ...prevUI,
              agentStatus: 'responding',
              latencyMetrics: {
                ...prevUI.latencyMetrics,
                timeToFirstToken: ttft ?? null
              }
            }
          } else {
            // Already 'responding' (post-tool response) - stay in 'responding'
            return { ...prevUI, agentStatus: 'responding' }
          }
        })
      } else {
        // Subsequent chunks - append to existing message
        const streamingId = streamingIdRef.current
        if (streamingId) {
          setMessages(prevMsgs => prevMsgs.map(msg =>
            msg.id === streamingId
              ? { ...msg, text: msg.text + data.text }
              : msg
          ))

          setSessionState(prev => ({
            ...prev,
            streaming: prev.streaming ? { ...prev.streaming, text: prev.streaming.text + data.text } : null
          }))
        }
      }
    }
  }, [sessionState, setSessionState, setMessages, setUIState, streamingStartedRef, streamingIdRef, latencyTracking])

  const handleToolUseEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_use') {
      // Tool execution started - update agent status
      const isResearchAgent = data.name === 'research_agent'
      const isBrowserUseAgent = data.name === 'browser_use_agent'

      let agentStatus: 'responding' | 'researching' | 'browser_automation' = 'responding'
      if (isResearchAgent) {
        agentStatus = 'researching'
      } else if (isBrowserUseAgent) {
        agentStatus = 'browser_automation'
      }

      setUIState(prev => ({
        ...prev,
        isTyping: true,
        agentStatus
      }))

      // Finalize current streaming message before adding tool
      // This separates pre-tool response from post-tool response
      if (streamingStartedRef.current && streamingIdRef.current) {
        // Save TTFT to the first message before finalizing
        const ttft = uiState.latencyMetrics.timeToFirstToken
        setMessages(prevMsgs => prevMsgs.map(msg => {
          if (msg.id === streamingIdRef.current) {
            return {
              ...msg,
              isStreaming: false,
              ...(ttft && !msg.latencyMetrics && { latencyMetrics: { timeToFirstToken: ttft } })
            }
          }
          return msg
        }))

        // Reset streaming refs so next response creates a new message
        streamingStartedRef.current = false
        streamingIdRef.current = null
      }

      // Normalize empty input to empty object for UI consistency
      const normalizedInput = (data.input as any) === "" || data.input === null || data.input === undefined ? {} : data.input

      // Check if tool execution already exists
      const existingToolIndex = currentToolExecutionsRef.current.findIndex(tool => tool.id === data.toolUseId)

      if (existingToolIndex >= 0) {
        // Update existing tool execution
        const updatedExecutions = [...currentToolExecutionsRef.current]
        updatedExecutions[existingToolIndex] = {
          ...updatedExecutions[existingToolIndex],
          toolInput: normalizedInput
        }

        currentToolExecutionsRef.current = updatedExecutions
        setSessionState(prev => ({
          ...prev,
          toolExecutions: updatedExecutions
        }))

        setMessages(prevMessages => prevMessages.map(msg => {
          if (msg.isToolMessage && msg.toolExecutions) {
            const updatedToolExecutions = msg.toolExecutions.map(tool =>
              tool.id === data.toolUseId
                ? { ...tool, toolInput: normalizedInput }
                : tool
            )
            return { ...msg, toolExecutions: updatedToolExecutions }
          }
          return msg
        }))
      } else {
        // Create new tool execution
        const newToolExecution: ToolExecution = {
          id: data.toolUseId,
          toolName: data.name,
          toolInput: normalizedInput,
          reasoning: [],
          isComplete: false,
          isExpanded: true
        }

        const updatedExecutions = [...currentToolExecutionsRef.current, newToolExecution]
        currentToolExecutionsRef.current = updatedExecutions

        setSessionState(prev => ({
          ...prev,
          toolExecutions: updatedExecutions
        }))

        // Create new tool message
        const toolMessageId = Date.now() + Math.random()
        setMessages(prevMessages => [...prevMessages, {
          id: toolMessageId,
          text: '',
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString(),
          toolExecutions: [newToolExecution],
          isToolMessage: true,
          turnId: currentTurnIdRef.current || undefined
        }])
      }
    }
  }, [availableTools, currentToolExecutionsRef, currentTurnIdRef, setSessionState, setMessages, setUIState, uiState])

  const handleToolResultEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_result') {
      // Update tool execution with result
      const isCancelled = data.status === 'error'
      const updatedExecutions = currentToolExecutionsRef.current.map(tool =>
        tool.id === data.toolUseId
          ? { ...tool, toolResult: data.result, images: data.images, isComplete: true, isCancelled }
          : tool
      )

      currentToolExecutionsRef.current = updatedExecutions

      // Extract browser session info from metadata (for Live View)
      const browserSessionUpdate: any = {}
      if (data.metadata?.browserSessionId) {
        console.log('[Live View] Browser session detected:', {
          sessionId: data.metadata.browserSessionId,
          browserId: data.metadata.browserId,
          liveViewUrl: data.metadata.liveViewUrl ? 'present' : 'missing'
        })

        // Store browser session info (URL will be fetched on-demand when View Browser is clicked)
        const browserSession = {
          sessionId: data.metadata.browserSessionId,
          browserId: data.metadata.browserId || null
        }

        // Save browserSession for this session
        browserSessionUpdate.browserSession = browserSession

        // Save to DynamoDB session metadata
        const currentSessionId = sessionStorage.getItem('chat-session-id')
        if (currentSessionId) {
          // Save to sessionStorage as cache
          sessionStorage.setItem(`browser-session-${currentSessionId}`, JSON.stringify(browserSession))

          // Save to DynamoDB (async, don't block UI)
          // Use IIFE to handle async auth within sync callback
          ;(async () => {
            const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
            try {
              const session = await fetchAuthSession()
              const token = session.tokens?.idToken?.toString()
              if (token) {
                authHeaders['Authorization'] = `Bearer ${token}`
              }
            } catch (error) {
              console.log('[useStreamEvents] No auth session available')
            }

            fetch('/api/session/update-browser-session', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                sessionId: currentSessionId,
                browserSession
              })
            }).catch(err => {
              console.warn('[Live View] Failed to save browserSession to DynamoDB:', err)
            })

            console.log('[Live View] Saved browserSession for session:', currentSessionId)
          })()
        }
      } else {
        console.log('[Live View] No browser session in metadata:', data.metadata)
      }

      // Update state
      setSessionState(prev => {
        const newState = {
          ...prev,
          toolExecutions: updatedExecutions,
          ...browserSessionUpdate
        }
        if (browserSessionUpdate.browserSession) {
          console.log('[Live View] State updated with browser session:', newState.browserSession)
        }
        return newState
      })

      // Update tool message
      setMessages(prev => prev.map(msg => {
        if (msg.isToolMessage && msg.toolExecutions) {
          const updatedToolExecutions = msg.toolExecutions.map(tool =>
            tool.id === data.toolUseId
              ? { ...tool, toolResult: data.result, images: data.images, isComplete: true }
              : tool
          )
          return { ...msg, toolExecutions: updatedToolExecutions }
        }
        return msg
      }))
    }
  }, [currentToolExecutionsRef, sessionState, setSessionState, setMessages])

  const handleCompleteEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'complete') {
      // Prevent duplicate processing
      if (completeProcessedRef.current) {
        return
      }
      completeProcessedRef.current = true

      const messageId = streamingIdRef.current

      if (messageId) {
        // Update last activity timestamp (AI response completed = activity)
        updateLastActivity()

        // Record E2E latency and save metadata
        const currentSessionId = sessionStorage.getItem('chat-session-id')
        const metrics = currentSessionId
          ? latencyTracking.recordE2E({ sessionId: currentSessionId, messageId, tokenUsage: data.usage })
          : latencyTracking.getMetrics()

        // Extract values (recordE2E and getMetrics have different return formats)
        const ttftValue = 'ttft' in metrics ? metrics.ttft : metrics.timeToFirstToken
        const e2eValue = 'e2e' in metrics ? metrics.e2e : metrics.endToEndLatency

        setUIState(prev => ({
          ...prev,
          isTyping: false,
          showProgressPanel: false,
          agentStatus: 'idle',
          latencyMetrics: {
            ...prev.latencyMetrics,
            endToEndLatency: e2eValue ?? null
          }
        }))

        setMessages(prevMsgs => {
          // Find the last assistant message (could be text or tool message)
          let lastAssistantIndex = -1
          for (let i = prevMsgs.length - 1; i >= 0; i--) {
            if (prevMsgs[i].sender === 'bot') {
              lastAssistantIndex = i
              break
            }
          }

          return prevMsgs.map((msg, index) =>
          // Update either the streaming message or the last assistant message (for tools)
          msg.id === messageId || (index === lastAssistantIndex && messageId)
            ? {
                ...msg,
                isStreaming: false,
                images: data.images || msg.images || [],
                latencyMetrics: {
                  timeToFirstToken: ttftValue,
                  endToEndLatency: e2eValue
                },
                ...(data.usage && { tokenUsage: data.usage })
              }
            : msg
          )
        })
      } else {
        // No streaming message, just update UI state
        setUIState(prev => {
          const requestStartTime = prev.latencyMetrics.requestStartTime
          const e2eLatency = requestStartTime ? Date.now() - requestStartTime : null

          return {
            ...prev,
            isTyping: false,
            showProgressPanel: false,
            agentStatus: 'idle',
            latencyMetrics: {
              ...prev.latencyMetrics,
              endToEndLatency: e2eLatency
            }
          }
        })
      }

      // Reset session state (keep browserSession to maintain Live View button)
      setSessionState(prev => ({
        reasoning: null,
        streaming: null,
        toolExecutions: [],
        browserSession: prev.browserSession,  // Preserve browser session
        browserProgress: undefined,  // Clear browser progress
        interrupt: null
      }))

      // Reset refs for next message
      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      latencyTracking.reset()
    }
  }, [setSessionState, setMessages, setUIState, streamingStartedRef, streamingIdRef, completeProcessedRef, latencyTracking])

  const handleInitEvent = useCallback(() => {
    setUIState(prev => {
      // Don't change status if already in an active state (not idle)
      // This includes 'thinking', 'responding', and 'researching'
      if (prev.agentStatus !== 'idle') {
        return prev
      }

      // Only transition to 'thinking' if starting a new turn (idle -> thinking)
      if (prev.latencyMetrics.requestStartTime) {
        latencyTracking.startTracking(prev.latencyMetrics.requestStartTime)
      }
      return { ...prev, isTyping: true, agentStatus: 'thinking' }
    })
  }, [setUIState, latencyTracking])

  const handleErrorEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'error') {
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: data.message,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString()
      }])

      // Calculate End-to-End Latency (even on error)
      const requestStartTime = uiState.latencyMetrics.requestStartTime
      if (requestStartTime) {
        const e2eLatency = Date.now() - requestStartTime
        const ttft = uiState.latencyMetrics.timeToFirstToken || 0
        console.log(`[Latency] End-to-End Latency (Error): ${e2eLatency}ms (TTFT: ${ttft}ms)`)
      }

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
      // Preserve browserSession even on error - Live View should remain available
      setSessionState(prev => ({
        reasoning: null,
        streaming: null,
        toolExecutions: [],
        browserSession: prev.browserSession,  // Preserve browser session on error
        browserProgress: undefined,  // Clear browser progress on error
        interrupt: null
      }))

      // Reset refs on error
      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      latencyTracking.reset()
    }
  }, [uiState, setMessages, setUIState, setSessionState, streamingStartedRef, streamingIdRef, completeProcessedRef, latencyTracking])

  const handleInterruptEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'interrupt') {
      console.log('[Interrupt] Received interrupt event:', data)

      setSessionState(prev => ({
        ...prev,
        interrupt: {
          interrupts: data.interrupts
        }
      }))

      // Transition to idle status (waiting for user input)
      setUIState(prev => ({
        ...prev,
        isTyping: false,
        agentStatus: 'idle'
      }))
    }
  }, [setSessionState, setUIState])

  const handleBrowserProgressEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'browser_progress') {
      console.log('[Browser Progress] Received step:', event.stepNumber)

      // Append browser step to sessionState
      setSessionState(prev => ({
        ...prev,
        browserProgress: [
          ...(prev.browserProgress || []),
          {
            stepNumber: event.stepNumber,
            content: event.content
          }
        ]
      }))
    }
  }, [setSessionState])

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'reasoning':
        handleReasoningEvent(event)
        break
      case 'response':
        handleResponseEvent(event)
        break
      case 'tool_use':
        handleToolUseEvent(event)
        break
      case 'progress':
        // Handle progress events from streaming tools
        console.log('[Tool Progress]', event)
        break
      case 'tool_result':
        handleToolResultEvent(event)
        break
      case 'complete':
        handleCompleteEvent(event)
        break
      case 'init':
      case 'thinking':
        handleInitEvent()
        break
      case 'error':
        handleErrorEvent(event)
        break
      case 'interrupt':
        handleInterruptEvent(event)
        break
      case 'browser_progress':
        handleBrowserProgressEvent(event)
        break
      case 'metadata':
        // Handle metadata updates (e.g., browser session during tool execution)
        if (event.metadata?.browserSessionId) {
          console.log('[Live View] Received metadata event:', {
            browserSessionId: event.metadata.browserSessionId,
            browserId: event.metadata.browserId || 'not provided'
          })

          const browserSession = {
            sessionId: event.metadata.browserSessionId,
            browserId: event.metadata.browserId || null
          }

          // Update session state immediately
          setSessionState(prev => ({
            ...prev,
            browserSession
          }))

          // Save to sessionStorage
          const currentSessionId = sessionStorage.getItem('chat-session-id')
          if (currentSessionId) {
            sessionStorage.setItem(`browser-session-${currentSessionId}`, JSON.stringify(browserSession))
            console.log('[Live View] Saved browserSession to sessionStorage:', currentSessionId)
          }

          console.log('[Live View] ✅ Browser session updated - Live View now available!', browserSession)
        }
        break
    }
  }, [
    handleReasoningEvent,
    handleResponseEvent,
    handleToolUseEvent,
    handleToolResultEvent,
    handleCompleteEvent,
    handleInitEvent,
    handleErrorEvent,
    handleInterruptEvent,
    handleBrowserProgressEvent,
    setSessionState
  ])

  return { handleStreamEvent }
}
