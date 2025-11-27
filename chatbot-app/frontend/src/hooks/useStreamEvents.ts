import { useCallback, useRef } from 'react'
import { Message, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatSessionState, ChatUIState, ToolProgressState } from '@/types/events'
import { useLatencyTracking } from './useLatencyTracking'
import { fetchAuthSession } from 'aws-amplify/auth'

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
  }, [availableTools, currentToolExecutionsRef, currentTurnIdRef, setSessionState, setMessages, uiState])

  const handleToolResultEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_result') {
      // Update tool execution with result
      const updatedExecutions = currentToolExecutionsRef.current.map(tool =>
        tool.id === data.toolUseId
          ? { ...tool, toolResult: data.result, images: data.images, isComplete: true }
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

        setMessages(prevMsgs => prevMsgs.map(msg =>
          msg.id === messageId
            ? {
                ...msg,
                isStreaming: false,
                images: data.images || [],
                latencyMetrics: {
                  timeToFirstToken: ttftValue,
                  endToEndLatency: e2eValue
                },
                ...(data.usage && { tokenUsage: data.usage })
              }
            : msg
        ))
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
        toolProgress: [],
        browserSession: prev.browserSession  // Preserve browser session
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
      // Only transition to 'thinking' if starting a new turn (idle -> thinking)
      // Once 'responding' starts, stay in 'responding' until complete
      if (prev.agentStatus === 'idle') {
        if (prev.latencyMetrics.requestStartTime) {
          latencyTracking.startTracking(prev.latencyMetrics.requestStartTime)
        }
        return { ...prev, isTyping: true, agentStatus: 'thinking' }
      }
      // Already active - keep current status
      return prev
    })
  }, [setUIState, latencyTracking])


  const handleProgressEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_progress') {
      const progressState: ToolProgressState = {
        context: data.toolId, // Map toolId to context for compatibility
        executor: 'tool-executor',
        sessionId: data.sessionId,
        step: data.step,
        message: data.message,
        progress: data.progress,
        timestamp: data.timestamp,
        metadata: data.metadata || {},
        isActive: data.step !== 'completed' && data.step !== 'error'
      }

      setSessionState(prev => {
        // Find existing progress for this tool
        const existingIndex = prev.toolProgress.findIndex(p => p.context === data.toolId && p.sessionId === data.sessionId)
        
        if (existingIndex >= 0) {
          // Update existing progress
          const updatedProgress = [...prev.toolProgress]
          updatedProgress[existingIndex] = progressState
          return { ...prev, toolProgress: updatedProgress }
        } else {
          // Add new progress
          return { ...prev, toolProgress: [...prev.toolProgress, progressState] }
        }
      })

      // Show progress panel when tool starts or has active progress
      if (data.step === 'connecting' || data.step === 'fetching' || data.step === 'processing') {
        setUIState(prev => ({ ...prev, showProgressPanel: true }))
      }

      // Auto-hide progress panel after completion (with delay)
      if (data.step === 'completed' || data.step === 'error') {
        setTimeout(() => {
          setSessionState(prev => ({
            ...prev,
            toolProgress: prev.toolProgress.filter(p => p.isActive)
          }))
          
          // Hide panel if no active progress
          setUIState(prev => {
            const hasActiveProgress = prev.showProgressPanel && 
              sessionState.toolProgress.some(p => p.isActive)
            return { ...prev, showProgressPanel: hasActiveProgress }
          })
        }, 3000) // Hide after 3 seconds
      }
    }
  }, [setSessionState, setUIState, sessionState.toolProgress])

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
      setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [], browserSession: null })

      // Reset refs on error
      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      latencyTracking.reset()
    }
  }, [uiState, setMessages, setUIState, setSessionState, streamingStartedRef, streamingIdRef, completeProcessedRef, latencyTracking])

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
      case 'tool_result':
        handleToolResultEvent(event)
        break
      case 'tool_progress':
        handleProgressEvent(event)
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
      // spending_analysis_* events removed - now handled by useAnalysisStream
    }
  }, [
    handleReasoningEvent,
    handleResponseEvent,
    handleToolUseEvent,
    handleToolResultEvent,
    handleProgressEvent,
    handleCompleteEvent,
    handleInitEvent,
    handleErrorEvent
  ])

  return { handleStreamEvent }
}
