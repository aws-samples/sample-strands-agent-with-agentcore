import { useCallback, useRef, startTransition } from 'react'
import { Message, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatSessionState, ChatUIState, WorkspaceFile } from '@/types/events'
import { useMetadataTracking } from './useMetadataTracking'
import { useTextBuffer } from './useTextBuffer'
import { A2A_TOOLS_REQUIRING_POLLING, isA2ATool, getAgentStatusForTool } from './usePolling'
import { fetchAuthSession } from 'aws-amplify/auth'
import { updateLastActivity } from '@/config/session'
import { TOOL_TO_DOC_TYPE, DOC_TYPE_TO_TOOL_TYPE, DocumentType } from '@/config/document-tools'

interface UseStreamEventsProps {
  sessionState: ChatSessionState
  setSessionState: React.Dispatch<React.SetStateAction<ChatSessionState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  uiState: ChatUIState
  currentToolExecutionsRef: React.MutableRefObject<ToolExecution[]>
  currentTurnIdRef: React.MutableRefObject<string | null>
  startPollingRef: React.MutableRefObject<((sessionId: string) => void) | null>
  sessionId: string | null
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
  startPollingRef,
  sessionId,
  availableTools = []
}: UseStreamEventsProps) => {
  // Refs to track streaming state synchronously (avoid React batching issues)
  const streamingStartedRef = useRef(false)
  const streamingIdRef = useRef<string | null>(null)
  const completeProcessedRef = useRef(false)

  // Autopilot mode state: tracks single turn for entire mission
  // When active, all events are part of one assistant turn until mission_complete
  const autopilotModeRef = useRef<{
    isActive: boolean
    turnMessageId: string | null
  }>({ isActive: false, turnMessageId: null })

  // Latency tracking hook (encapsulates all latency-related refs and logic)
  const metadataTracking = useMetadataTracking()

  // Text buffer for smooth streaming (reduces re-renders by batching updates)
  // Note: onFlush callback is passed to startFlushing() when streaming starts,
  // not at initialization, to avoid stale closure issues with streamingIdRef
  const textBuffer = useTextBuffer({ flushInterval: 50 })

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
        const newId = String(Date.now())
        streamingIdRef.current = newId

        // Create message with empty text - buffer will populate it
        setMessages(prevMsgs => [...prevMsgs, {
          id: newId,
          text: '', // Start empty, buffer will fill
          sender: 'bot',
          timestamp: new Date().toISOString(),
          isStreaming: true,
          images: []
        }])

        setSessionState(prev => ({
          ...prev,
          streaming: { text: '', id: Number(newId) }  // Start empty
        }))

        // Start buffering with flush callback that captures current streamingIdRef
        // This callback is created fresh here, so streamingIdRef.current is valid
        textBuffer.startFlushing((bufferedText) => {
          const streamingId = streamingIdRef.current
          if (!streamingId) return

          // Update message with buffered text
          setMessages(prevMsgs => prevMsgs.map(msg =>
            msg.id === streamingId
              ? { ...msg, text: bufferedText }
              : msg
          ))

          // Update session state
          setSessionState(prev => ({
            ...prev,
            streaming: prev.streaming ? { ...prev.streaming, text: bufferedText } : null
          }))
        })

        // Add first chunk to buffer
        textBuffer.appendChunk(data.text)

        setUIState(prevUI => {
          // Don't change status if stopping or in A2A agent mode
          if (prevUI.agentStatus === 'stopping' ||
              prevUI.agentStatus === 'researching' ||
              prevUI.agentStatus === 'browser_automation') {
            return prevUI
          }
          if (prevUI.agentStatus === 'thinking') {
            const ttft = metadataTracking.recordTTFT()
            return {
              ...prevUI,
              agentStatus: 'responding',
              latencyMetrics: { ...prevUI.latencyMetrics, timeToFirstToken: ttft ?? null }
            }
          }
          return { ...prevUI, agentStatus: 'responding' }
        })
      } else {
        // Append subsequent chunks to buffer (not directly to state)
        textBuffer.appendChunk(data.text)
      }
    }
  }, [sessionState, setSessionState, setMessages, setUIState, streamingStartedRef, streamingIdRef, metadataTracking, textBuffer])

  const handleToolUseEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_use') {
      // Tool execution started - update agent status using shared utility
      const agentStatus = getAgentStatusForTool(data.name)

      setUIState(prev => ({
        ...prev,
        isTyping: true,
        agentStatus
      }))

      // Start polling for tool execution progress updates
      // Only for long-running A2A agents that save progress to backend and need polling
      // Regular tools don't need polling - SSE stream handles their updates directly
      const needsPolling = isA2ATool(data.name)
      if (needsPolling && sessionId && startPollingRef.current) {
        startPollingRef.current(sessionId)
      }

      // Flush buffer before tool execution to ensure all text is rendered
      textBuffer.reset()

      // Finalize current streaming message before adding tool
      if (streamingStartedRef.current && streamingIdRef.current) {
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

        // Reset refs so next response creates a new message (maintains correct order)
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

        // Use startTransition to batch state updates and prevent flickering
        startTransition(() => {
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
        })
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

        // Update session state
        setSessionState(prev => ({
          ...prev,
          toolExecutions: updatedExecutions
        }))

        // Create new tool message immediately (not in startTransition)
        // Tool container should appear right away with "Loading parameters..." state
        const toolMessageId = String(Date.now())
        setMessages(prevMessages => [...prevMessages, {
          id: toolMessageId,
          text: '',
          sender: 'bot',
          timestamp: new Date().toISOString(),
          toolExecutions: [newToolExecution],
          isToolMessage: true,
          turnId: currentTurnIdRef.current || undefined
        }])
      }
    }
  }, [availableTools, currentToolExecutionsRef, currentTurnIdRef, setSessionState, setMessages, setUIState, uiState, textBuffer])

  const handleToolResultEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_result') {
      // Find the tool name from current executions
      const toolExecution = currentToolExecutionsRef.current.find(tool => tool.id === data.toolUseId)
      const toolName = toolExecution?.toolName

      // If A2A tool completed, transition from researching/browser_automation to thinking
      // This allows subsequent response events to properly transition to 'responding'
      if (toolName && isA2ATool(toolName)) {
        setUIState(prev => {
          if (prev.agentStatus === 'researching' || prev.agentStatus === 'browser_automation') {
            return { ...prev, agentStatus: 'thinking' }
          }
          return prev
        })
      }

      // Update tool execution with result
      const isCancelled = data.status === 'error'
      const updatedExecutions = currentToolExecutionsRef.current.map(tool =>
        tool.id === data.toolUseId
          ? { ...tool, toolResult: data.result, images: data.images, isComplete: true, isCancelled }
          : tool
      )

      currentToolExecutionsRef.current = updatedExecutions

      // Extract browser session info from metadata (for Live View)
      // Only set on first browser tool use to prevent unnecessary DCV reconnections
      const browserSessionUpdate: any = {}
      if (!sessionState.browserSession && data.metadata?.browserSessionId) {
        const browserSession = {
          sessionId: data.metadata.browserSessionId,
          browserId: data.metadata.browserId || null
        }

        browserSessionUpdate.browserSession = browserSession

        // Save to sessionStorage and DynamoDB (only on first set)
        const currentSessionId = sessionStorage.getItem('chat-session-id')
        if (currentSessionId) {
          sessionStorage.setItem(`browser-session-${currentSessionId}`, JSON.stringify(browserSession))

          ;(async () => {
            const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
            try {
              const session = await fetchAuthSession()
              const token = session.tokens?.idToken?.toString()
              if (token) {
                authHeaders['Authorization'] = `Bearer ${token}`
              }
            } catch (error) {
              // No auth session available - continue without auth header
            }

            fetch('/api/session/update-browser-session', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                sessionId: currentSessionId,
                browserSession
              })
            }).catch(() => {
              // Failed to save browserSession to DynamoDB - non-critical
            })
          })()
        }
      }

      // Update state immediately to prevent race conditions with subsequent response events
      setSessionState(prev => ({
        ...prev,
        toolExecutions: updatedExecutions,
        ...browserSessionUpdate
      }))

      setMessages(prev => prev.map(msg => {
        if (msg.isToolMessage && msg.toolExecutions) {
          const updatedToolExecutions = msg.toolExecutions.map(tool =>
            tool.id === data.toolUseId
              ? { ...tool, toolResult: data.result, images: data.images, isComplete: true }
              : tool
          )
          return {
            ...msg,
            toolExecutions: updatedToolExecutions
          }
        }
        return msg
      }))
    }
  }, [currentToolExecutionsRef, sessionState, setSessionState, setMessages, setUIState])

  const handleCompleteEvent = useCallback(async (data: StreamEvent) => {
    if (data.type === 'complete') {
      const isStopEvent = data.message === 'Stream stopped by user'

      if (completeProcessedRef.current) return
      completeProcessedRef.current = true

      // Flush any remaining buffered text before completing
      textBuffer.reset()

      const messageId = streamingIdRef.current

      // Handle stop event
      if (isStopEvent) {
        startTransition(() => {
          setUIState(prev => ({
            ...prev,
            isTyping: false,
            showProgressPanel: false,
            agentStatus: 'idle'
          }))

          setMessages(prevMsgs => prevMsgs.map(msg => {
            if (msg.isStreaming) {
              return { ...msg, isStreaming: false }
            }
            if (msg.isToolMessage && msg.toolExecutions) {
              const updatedToolExecutions = msg.toolExecutions.map(tool =>
                !tool.isComplete ? { ...tool, isComplete: true, isCancelled: true } : tool
              )
              return { ...msg, toolExecutions: updatedToolExecutions }
            }
            return msg
          }))

          setSessionState(prev => ({
            reasoning: null,
            streaming: null,
            toolExecutions: prev.toolExecutions.map(te =>
              !te.isComplete ? { ...te, isComplete: true, isCancelled: true } : te
            ),
            browserSession: prev.browserSession,
            browserProgress: undefined,
            researchProgress: undefined,
            interrupt: null
          }))
        })

        streamingStartedRef.current = false
        streamingIdRef.current = null
        completeProcessedRef.current = false
        metadataTracking.reset()
        return
      }

      // Normal complete flow
      if (messageId) {
        updateLastActivity()

        const currentSessionId = sessionStorage.getItem('chat-session-id')

        // Detect used document tools and fetch workspace files from S3
        let workspaceDocuments: Array<{ filename: string; tool_type: string }> = []

        // Check tool executions for document tools
        const usedDocTypes = new Set<DocumentType>()
        for (const toolExec of currentToolExecutionsRef.current) {
          const docType = TOOL_TO_DOC_TYPE[toolExec.toolName]
          if (docType) {
            usedDocTypes.add(docType)
          }
        }

        // Fetch workspace files for each used document type
        if (usedDocTypes.size > 0 && currentSessionId) {
          try {
            // Get auth headers for workspace API calls
            const workspaceHeaders: Record<string, string> = {
              'X-Session-ID': currentSessionId
            }
            try {
              const session = await fetchAuthSession()
              const token = session.tokens?.idToken?.toString()
              if (token) {
                workspaceHeaders['Authorization'] = `Bearer ${token}`
              }
            } catch {
              // No auth session available - continue without auth header
            }

            const fetchPromises = Array.from(usedDocTypes).map(async (docType) => {
              const response = await fetch(`/api/workspace/files?docType=${docType}`, {
                headers: workspaceHeaders
              })
              if (response.ok) {
                const data = await response.json()
                if (data.files && Array.isArray(data.files)) {
                  return data.files.map((file: any) => ({
                    filename: file.filename,
                    tool_type: DOC_TYPE_TO_TOOL_TYPE[docType] || file.tool_type
                  }))
                }
              }
              return []
            })

            const results = await Promise.all(fetchPromises)
            workspaceDocuments = results.flat()
          } catch (error) {
            // Failed to fetch workspace files - non-critical, will use backend-provided documents
          }
        }

        // Use workspace documents if fetched, otherwise fall back to backend-provided documents
        const finalDocuments = workspaceDocuments.length > 0
          ? workspaceDocuments
          : (data.documents || [])

        const metrics = currentSessionId
          ? metadataTracking.recordE2E({
              sessionId: currentSessionId,
              messageId,
              tokenUsage: data.usage,
              documents: finalDocuments
            })
          : metadataTracking.getMetrics()

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
          let lastAssistantIndex = -1
          for (let i = prevMsgs.length - 1; i >= 0; i--) {
            if (prevMsgs[i].sender === 'bot') {
              lastAssistantIndex = i
              break
            }
          }

          return prevMsgs.map((msg, index) =>
            msg.id === messageId || (index === lastAssistantIndex && !messageId)
              ? {
                  ...msg,
                  isStreaming: false,
                  images: data.images || msg.images || [],
                  documents: finalDocuments,
                  latencyMetrics: { timeToFirstToken: ttftValue, endToEndLatency: e2eValue },
                  ...(data.usage && { tokenUsage: data.usage })
                }
              : msg
          )
        })
      } else {
        setUIState(prev => {
          const requestStartTime = prev.latencyMetrics.requestStartTime
          const e2eLatency = requestStartTime ? Date.now() - requestStartTime : null
          return {
            ...prev,
            isTyping: false,
            showProgressPanel: false,
            agentStatus: 'idle',
            latencyMetrics: { ...prev.latencyMetrics, endToEndLatency: e2eLatency }
          }
        })
      }

      setSessionState(prev => ({
        reasoning: null,
        streaming: null,
        toolExecutions: [],
        browserSession: prev.browserSession,
        browserProgress: undefined,
        researchProgress: undefined,
        interrupt: null
      }))

      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      metadataTracking.reset()
    }
  }, [setSessionState, setMessages, setUIState, streamingStartedRef, streamingIdRef, completeProcessedRef, metadataTracking, currentToolExecutionsRef, textBuffer])

  const handleInitEvent = useCallback(() => {
    setUIState(prev => {
      if (prev.latencyMetrics.requestStartTime) {
        metadataTracking.startTracking(prev.latencyMetrics.requestStartTime)
      }
      if (prev.agentStatus !== 'idle') {
        return prev
      }

      // Only transition to 'thinking' if starting a new turn (idle -> thinking)
      return { ...prev, isTyping: true, agentStatus: 'thinking' }
    })
  }, [setUIState, metadataTracking])

  const handleErrorEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'error') {
      // Reset buffer on error
      textBuffer.reset()

      setMessages(prev => [...prev, {
        id: String(Date.now()),
        text: data.message,
        sender: 'bot',
        timestamp: new Date().toISOString()
      }])

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
        researchProgress: undefined,  // Clear research progress on error
        interrupt: null,
        autopilotProgress: undefined  // Clear autopilot progress on error
      }))

      // Reset refs on error
      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      metadataTracking.reset()

      // Reset autopilot mode state on error
      if (autopilotModeRef.current.isActive) {
        console.log('[Autopilot] Reset due to error')
        autopilotModeRef.current = { isActive: false, turnMessageId: null }
      }
    }
  }, [uiState, setMessages, setUIState, setSessionState, streamingStartedRef, streamingIdRef, completeProcessedRef, metadataTracking, textBuffer])

  const handleInterruptEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'interrupt') {
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

  const handleResearchProgressEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'research_progress') {
      // Update research progress in sessionState (replace previous status)
      setSessionState(prev => ({
        ...prev,
        researchProgress: {
          stepNumber: event.stepNumber,
          content: event.content
        }
      }))
    }
  }, [setSessionState])

  // Mission Control events (new Application-Level Orchestration)
  const handleMissionProgressEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'mission_progress') {
      // Initialize autopilot mode on first mission_progress event
      // All subsequent events until mission_complete are part of this single turn
      if (!autopilotModeRef.current.isActive) {
        autopilotModeRef.current.isActive = true
        // The turn message ID will be set when the first response creates a message
        // Or we can create a placeholder message now
        console.log('[Autopilot] Mission started - all steps will be in single turn')
      }

      // For step 2+, finalize previous streaming message before adding new badge
      if (event.step > 1) {
        // Flush any remaining buffered text
        textBuffer.reset()

        // Finalize current streaming message
        if (streamingStartedRef.current && streamingIdRef.current) {
          setMessages(prevMsgs => prevMsgs.map(msg =>
            msg.id === streamingIdRef.current
              ? { ...msg, isStreaming: false }
              : msg
          ))
        }

        // Reset streaming refs so next response creates a new message
        streamingStartedRef.current = false
        streamingIdRef.current = null
      }

      // Add directive message for consistent UI with session restore
      // This creates the same visual as [DIRECTIVE:N] markers in restored sessions
      const directiveMessageId = `directive-${event.step}-${Date.now()}`
      setMessages(prev => [...prev, {
        id: directiveMessageId,
        text: event.directive_prompt,
        sender: 'user',
        timestamp: new Date().toISOString(),
        isDirective: true,
        directiveStep: event.step,
        autopilotType: 'directive'
      }])

      // Update autopilot progress in sessionState using mission event data
      setSessionState(prev => ({
        ...prev,
        autopilotProgress: {
          missionId: 'current-mission',
          state: 'executing',
          step: event.step,
          currentTask: event.directive_prompt,
          activeTools: event.active_tools
        }
      }))

      // Update agent status to autopilot if not already
      setUIState(prev => {
        if (prev.agentStatus !== 'autopilot' && prev.agentStatus !== 'stopping') {
          return { ...prev, isTyping: true, agentStatus: 'autopilot' }
        }
        return prev
      })
    }
  }, [setSessionState, setUIState, setMessages, textBuffer])

  const handleMissionCompleteEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'mission_complete') {
      const totalSteps = event.total_steps || 0
      const isDirect = totalSteps === 0
      console.log('[Autopilot] Mission complete:', totalSteps, 'steps', isDirect ? '(direct)' : '(summary)')

      // Flush any remaining buffered text and finalize current streaming message
      textBuffer.reset()

      // Finalize current streaming message before adding badge
      if (streamingStartedRef.current && streamingIdRef.current) {
        setMessages(prevMsgs => prevMsgs.map(msg =>
          msg.id === streamingIdRef.current
            ? { ...msg, isStreaming: false }
            : msg
        ))
      }

      // Reset streaming refs so next response creates a new message
      streamingStartedRef.current = false
      streamingIdRef.current = null

      // Add badge message for consistent UI with session restore
      // total_steps=0 means direct response (no tools), otherwise it's a summary
      const messageId = `${isDirect ? 'direct' : 'summary'}-${Date.now()}`
      setMessages(prev => [...prev, {
        id: messageId,
        text: isDirect ? 'Responding directly...' : 'Generating final response...',
        sender: 'user',
        timestamp: new Date().toISOString(),
        isDirective: true,
        autopilotType: isDirect ? 'direct' : 'summary'
      }])

      // Reset autopilot mode state
      autopilotModeRef.current = { isActive: false, turnMessageId: null }

      // Clear autopilot progress on completion
      setSessionState(prev => ({
        ...prev,
        autopilotProgress: undefined
      }))
    }
  }, [setSessionState, setMessages, textBuffer])

  // Legacy autopilot events (keep for compatibility)
  const handleAutopilotProgressEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'autopilot_progress') {
      // Update autopilot progress in sessionState
      setSessionState(prev => ({
        ...prev,
        autopilotProgress: {
          missionId: event.missionId,
          state: event.state,
          step: event.step,
          currentTask: event.currentTask,
          activeTools: event.activeTools
        }
      }))

      // Update agent status to autopilot if not already
      setUIState(prev => {
        if (prev.agentStatus !== 'autopilot' && prev.agentStatus !== 'stopping') {
          return { ...prev, isTyping: true, agentStatus: 'autopilot' }
        }
        return prev
      })
    }
  }, [setSessionState, setUIState])

  const handleAutopilotCompleteEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'autopilot_complete') {
      // Clear autopilot progress on completion
      setSessionState(prev => ({
        ...prev,
        autopilotProgress: undefined
      }))
    }
  }, [setSessionState])

  const handleAutopilotErrorEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'autopilot_error') {
      console.error('[Autopilot] Error:', event.error)
      // Keep progress for display but could update state to show error
      if (!event.recoverable) {
        setSessionState(prev => ({
          ...prev,
          autopilotProgress: undefined
        }))
      }
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
        // Handle progress events from streaming tools (no-op for now)
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
      case 'research_progress':
        handleResearchProgressEvent(event)
        break
      case 'mission_progress':
        handleMissionProgressEvent(event)
        break
      case 'mission_complete':
        handleMissionCompleteEvent(event)
        break
      case 'autopilot_progress':
        handleAutopilotProgressEvent(event)
        break
      case 'autopilot_complete':
        handleAutopilotCompleteEvent(event)
        break
      case 'autopilot_error':
        handleAutopilotErrorEvent(event)
        break
      case 'metadata':
        // Handle metadata updates (e.g., browser session during tool execution)
        // Only set on first metadata event to prevent unnecessary DCV reconnections
        if (event.metadata?.browserSessionId) {
          const metadata = event.metadata
          setSessionState(prev => {
            if (prev.browserSession) {
              return prev
            }

            const browserSession = {
              sessionId: metadata.browserSessionId,
              browserId: metadata.browserId || null
            }

            // Save to sessionStorage (only on first set)
            const currentSessionId = sessionStorage.getItem('chat-session-id')
            if (currentSessionId) {
              sessionStorage.setItem(`browser-session-${currentSessionId}`, JSON.stringify(browserSession))
            }

            return {
              ...prev,
              browserSession
            } as ChatSessionState
          })
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
    handleResearchProgressEvent,
    handleMissionProgressEvent,
    handleMissionCompleteEvent,
    handleAutopilotProgressEvent,
    handleAutopilotCompleteEvent,
    handleAutopilotErrorEvent,
    setSessionState
  ])

  // Reset streaming state (called when user stops generation)
  const resetStreamingState = useCallback(() => {
    // Flush any remaining buffered text before resetting
    textBuffer.reset()

    streamingStartedRef.current = false
    streamingIdRef.current = null
    completeProcessedRef.current = false
    metadataTracking.reset()

    // Reset autopilot mode state if active
    if (autopilotModeRef.current.isActive) {
      console.log('[Autopilot] Reset during streaming stop')
      autopilotModeRef.current = { isActive: false, turnMessageId: null }
    }

    // Mark current streaming message as stopped (not streaming)
    setMessages(prev => prev.map(msg =>
      msg.isStreaming ? { ...msg, isStreaming: false } : msg
    ))

    setSessionState(prev => ({
      ...prev,
      reasoning: null,
      streaming: null,
      autopilotProgress: undefined // Clear autopilot progress on reset
    }))
  }, [setMessages, setSessionState, metadataTracking, textBuffer])

  return { handleStreamEvent, resetStreamingState }
}
