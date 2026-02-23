import { useCallback, useRef, startTransition, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { Message, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatSessionState, ChatUIState, WorkspaceFile, SWARM_AGENT_DISPLAY_NAMES, SwarmAgentStep } from '@/types/events'
import { useMetadataTracking } from './useMetadataTracking'
import { useTextBuffer } from './useTextBuffer'
import { A2A_TOOLS_REQUIRING_POLLING, isA2ATool, getAgentStatusForTool } from './usePolling'
import { fetchAuthSession } from 'aws-amplify/auth'
import { updateLastActivity } from '@/config/session'
import { TOOL_TO_DOC_TYPE, DOC_TYPE_TO_TOOL_TYPE, TOOL_TYPE_TO_DOC_TYPE, DocumentType } from '@/config/document-tools'
import { ExtractedDataInfo } from './useCanvasHandlers'

// Word document info from workspace API
export interface WorkspaceDocument {
  filename: string
  size_kb: string
  last_modified: string
  s3_key: string
  tool_type: string
}

interface UseStreamEventsProps {
  sessionState: ChatSessionState
  setSessionState: React.Dispatch<React.SetStateAction<ChatSessionState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  uiState: ChatUIState
  currentToolExecutionsRef: React.MutableRefObject<ToolExecution[]>
  currentTurnIdRef: React.MutableRefObject<string | null>
  startPollingRef: React.MutableRefObject<((sessionId: string) => void) | null>
  stopPollingRef: React.MutableRefObject<(() => void) | null>
  sessionId: string | null
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
  onArtifactUpdated?: () => void  // Callback when artifact is updated via update_artifact tool
  onWordDocumentsCreated?: (documents: WorkspaceDocument[]) => void  // Callback when Word documents are created
  onExcelDocumentsCreated?: (documents: WorkspaceDocument[]) => void  // Callback when Excel documents are created
  onPptDocumentsCreated?: (documents: WorkspaceDocument[]) => void  // Callback when PowerPoint documents are created
  onDiagramCreated?: (s3Key: string, filename: string) => void  // Callback when diagram is generated
  onBrowserSessionDetected?: (browserSessionId: string, browserId: string) => void  // Callback when browser session is first detected
  onExtractedDataCreated?: (data: ExtractedDataInfo) => void  // Callback when browser_extract creates artifact
  onExcalidrawCreated?: (data: { elements: any[]; appState: any; title: string }, toolUseId: string) => void  // Callback when excalidraw diagram is created
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
  stopPollingRef,
  sessionId,
  availableTools = [],
  onArtifactUpdated,
  onWordDocumentsCreated,
  onExcelDocumentsCreated,
  onPptDocumentsCreated,
  onDiagramCreated,
  onBrowserSessionDetected,
  onExtractedDataCreated,
  onExcalidrawCreated
}: UseStreamEventsProps) => {
  // Refs to track streaming state synchronously (avoid React batching issues)
  const streamingStartedRef = useRef(false)
  const streamingIdRef = useRef<string | null>(null)
  const completeProcessedRef = useRef(false)

  // Swarm mode state
  const swarmModeRef = useRef<{
    isActive: boolean
    nodeHistory: string[]
    agentSteps: SwarmAgentStep[]
  }>({ isActive: false, nodeHistory: [], agentSteps: [] })

  // Latency tracking hook (encapsulates all latency-related refs and logic)
  const metadataTracking = useMetadataTracking()

  // Text buffer for smooth streaming (reduces re-renders by batching updates)
  // Note: onFlush callback is passed to startFlushing() when streaming starts,
  // not at initialization, to avoid stale closure issues with streamingIdRef
  const textBuffer = useTextBuffer({ flushInterval: 50 })

  const handleReasoningEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'reasoning') {
      // Swarm mode: capture reasoning for "Show agents"
      if (swarmModeRef.current.isActive) {
        if (swarmModeRef.current.agentSteps.length > 0) {
          const stepIndex = swarmModeRef.current.agentSteps.length - 1
          const currentStep = swarmModeRef.current.agentSteps[stepIndex]
          const updatedStep = {
            ...currentStep,
            reasoningText: (currentStep.reasoningText || '') + data.text
          }
          swarmModeRef.current.agentSteps[stepIndex] = updatedStep
          setSessionState(prev => ({
            ...prev,
            swarmProgress: prev.swarmProgress ? {
              ...prev.swarmProgress,
              agentSteps: [...swarmModeRef.current.agentSteps]
            } : prev.swarmProgress
          }))
        }
        return
      }
      // Normal mode
      setSessionState(prev => ({
        ...prev,
        reasoning: { text: data.text, isActive: true }
      }))
    }
  }, [setSessionState])

  const handleResponseEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'response') {
      // Swarm mode handling
      if (swarmModeRef.current.isActive) {
        const currentNode = swarmModeRef.current.nodeHistory[swarmModeRef.current.nodeHistory.length - 1]

        // Non-responder: capture in agentSteps for "Show agents" expanded view
        if (currentNode !== 'responder') {
          if (swarmModeRef.current.agentSteps.length > 0) {
            const stepIndex = swarmModeRef.current.agentSteps.length - 1
            const currentStep = swarmModeRef.current.agentSteps[stepIndex]
            const updatedStep = {
              ...currentStep,
              responseText: (currentStep.responseText || '') + data.text
            }
            swarmModeRef.current.agentSteps[stepIndex] = updatedStep
            setSessionState(prev => ({
              ...prev,
              swarmProgress: prev.swarmProgress ? {
                ...prev.swarmProgress,
                agentSteps: [...swarmModeRef.current.agentSteps]
              } : prev.swarmProgress
            }))
          }
          return // Non-responder: only update SwarmProgress, no chat message
        }
        // Responder: fall through to normal streaming logic (creates chat messages)
        // Don't capture in agentSteps - responder content is rendered via messages
      }

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
      // Track tool in swarm mode for expanded view
      if (swarmModeRef.current.isActive && swarmModeRef.current.agentSteps.length > 0) {
        const stepIndex = swarmModeRef.current.agentSteps.length - 1
        const currentStep = swarmModeRef.current.agentSteps[stepIndex]
        // Create new step object with updated toolCalls
        const updatedStep = {
          ...currentStep,
          toolCalls: [...(currentStep.toolCalls || []), { toolName: data.name, status: 'running' as const }]
        }
        swarmModeRef.current.agentSteps[stepIndex] = updatedStep

        setSessionState(prev => ({
          ...prev,
          swarmProgress: prev.swarmProgress ? {
            ...prev.swarmProgress,
            currentAction: `Using ${data.name}...`,
            agentSteps: [...swarmModeRef.current.agentSteps]
          } : prev.swarmProgress
        }))

        // For responder's tools (like create_visualization), continue processing
        // to create tool message for rendering. Other agents return early.
        const currentNode = swarmModeRef.current.nodeHistory[swarmModeRef.current.nodeHistory.length - 1]
        if (currentNode !== 'responder') {
          return
        }
      }

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
      const isCancelled = data.status === 'error'

      // Track tool completion in swarm mode for expanded view
      if (swarmModeRef.current.isActive && swarmModeRef.current.agentSteps.length > 0) {
        const stepIndex = swarmModeRef.current.agentSteps.length - 1
        const currentStep = swarmModeRef.current.agentSteps[stepIndex]
        if (currentStep.toolCalls) {
          // Create new toolCalls array with updated status
          const updatedToolCalls = currentStep.toolCalls.map(t =>
            t.status === 'running' ? { ...t, status: isCancelled ? 'failed' as const : 'completed' as const } : t
          )
          const updatedStep = { ...currentStep, toolCalls: updatedToolCalls }
          swarmModeRef.current.agentSteps[stepIndex] = updatedStep
        }

        const currentNode = swarmModeRef.current.nodeHistory[swarmModeRef.current.nodeHistory.length - 1]
        const displayName = SWARM_AGENT_DISPLAY_NAMES[currentNode] || currentNode

        // For responder's tools, keep SwarmProgress but it will auto-collapse
        // The tool message will render the chart directly in chat
        if (currentNode === 'responder') {
          setSessionState(prev => ({
            ...prev,
            swarmProgress: prev.swarmProgress ? {
              ...prev.swarmProgress,
              currentAction: `${displayName} working...`,
              agentSteps: [...swarmModeRef.current.agentSteps]
            } : prev.swarmProgress
          }))
        } else {
          setSessionState(prev => ({
            ...prev,
            swarmProgress: prev.swarmProgress ? {
              ...prev.swarmProgress,
              currentAction: `${displayName} working...`,
              agentSteps: [...swarmModeRef.current.agentSteps]
            } : prev.swarmProgress
          }))
          return  // Other agents return early
        }
      }

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

      // If update_artifact tool completed successfully, notify parent to refresh artifacts
      if (toolName === 'update_artifact' && !isCancelled && onArtifactUpdated) {
        console.log('[useStreamEvents] update_artifact completed, triggering artifact refresh')
        onArtifactUpdated()
      }

      // If browser_extract tool completed successfully with artifact, open Canvas
      if (toolName === 'browser_extract' && !isCancelled && data.metadata?.artifactId && onExtractedDataCreated) {
        console.log('[useStreamEvents] browser_extract completed, creating artifact:', data.metadata.artifactId)
        // Parse extracted data from tool result
        const extractedDataMatch = data.result?.match(/\*\*Extracted Data\*\*:\s*```json\n([\s\S]*?)```/)
        const extractedContent = extractedDataMatch ? extractedDataMatch[1].trim() : '{}'
        const descriptionMatch = data.result?.match(/\*\*Description\*\*:\s*(.+)/)
        const title = descriptionMatch ? descriptionMatch[1].substring(0, 50) : 'Extracted Data'

        onExtractedDataCreated({
          artifactId: data.metadata.artifactId,
          title,
          content: extractedContent,
          sourceUrl: data.metadata.source_url || '',
          sourceTitle: data.metadata.source_title || ''
        })
      }

      // Update tool execution with result
      // Filter out images if hideImageInChat metadata is set
      const shouldHideImages = data.metadata?.hideImageInChat === true
      const toolImages = shouldHideImages ? [] : data.images

      const updatedExecutions = currentToolExecutionsRef.current.map(tool =>
        tool.id === data.toolUseId
          ? { ...tool, toolResult: data.result, metadata: data.metadata, images: toolImages, isComplete: true, isCancelled }
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

        // Notify parent about browser session detection (for Canvas integration)
        if (onBrowserSessionDetected) {
          onBrowserSessionDetected(browserSession.sessionId, browserSession.browserId || '')
        }

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
          })().catch(() => {
            // Non-critical: browser session save failed
          })
        }
      }

      // Update state - A2A tools use high-priority updates so the artifact
      // creation chain (messages → researchData → useEffect) fires immediately.
      // Regular tools use startTransition to avoid blocking the UI.
      const isA2AResult = toolName && isA2ATool(toolName)

      const applyUpdates = () => {
        setSessionState(prev => ({
          ...prev,
          toolExecutions: updatedExecutions,
          ...browserSessionUpdate
        }))

        setMessages(prev => prev.map(msg => {
          if (msg.isToolMessage && msg.toolExecutions) {
            const updatedToolExecutions = msg.toolExecutions.map(tool =>
              tool.id === data.toolUseId
                ? { ...tool, toolResult: data.result, metadata: data.metadata, images: toolImages, isComplete: true }
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

      if (isA2AResult) {
        applyUpdates()
      } else {
        startTransition(applyUpdates)
      }
    }
  }, [currentToolExecutionsRef, sessionState, setSessionState, setMessages, setUIState])

  const handleCompleteEvent = useCallback(async (data: StreamEvent) => {
    if (data.type === 'complete') {
      const isStopEvent = data.message === 'Stream stopped by user'

      if (completeProcessedRef.current) return
      completeProcessedRef.current = true

      // Stop polling on stream completion - A2A tools are done
      if (stopPollingRef.current) {
        stopPollingRef.current()
      }

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
            interrupt: null,
            pendingOAuth: prev.pendingOAuth  // Preserve pending OAuth on stop
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

        // Resolve document type — for skill_executor, unwrap the inner tool_name
        const resolveDocType = (toolExec: { toolName: string; toolInput?: any; metadata?: any }): DocumentType | undefined => {
          const docType = TOOL_TO_DOC_TYPE[toolExec.toolName]
          if (docType) return docType
          // skill_executor wraps the actual tool — check toolInput.tool_name
          if (toolExec.toolName === 'skill_executor' && toolExec.toolInput?.tool_name) {
            return TOOL_TO_DOC_TYPE[toolExec.toolInput.tool_name]
          }
          // Fallback: check metadata.tool_type (e.g. "powerpoint_presentation")
          if (toolExec.metadata?.tool_type) {
            return TOOL_TYPE_TO_DOC_TYPE[toolExec.metadata.tool_type]
          }
          return undefined
        }

        // Check tool executions for document tools
        const usedDocTypes = new Set<DocumentType>()
        for (const toolExec of currentToolExecutionsRef.current) {
          const docType = resolveDocType(toolExec)
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

            // Extract output filenames from tool result metadata
            const wordOutputFilenames = new Set<string>()
            const excelOutputFilenames = new Set<string>()
            const pptOutputFilenames = new Set<string>()

            for (const toolExec of currentToolExecutionsRef.current) {
              const filename = toolExec.metadata?.filename
              if (!filename || !toolExec.isComplete || toolExec.isCancelled) continue

              const docType = resolveDocType(toolExec)
              if (docType === 'word') wordOutputFilenames.add(filename)
              else if (docType === 'excel') excelOutputFilenames.add(filename)
              else if (docType === 'powerpoint') pptOutputFilenames.add(filename)
            }

            let wordDocumentsForArtifact: WorkspaceDocument[] = []
            let excelDocumentsForArtifact: WorkspaceDocument[] = []
            let pptDocumentsForArtifact: WorkspaceDocument[] = []

            const fetchPromises = Array.from(usedDocTypes).map(async (docType) => {
              const response = await fetch(`/api/workspace/files?docType=${docType}`, {
                headers: workspaceHeaders
              })
              if (response.ok) {
                const data = await response.json()
                if (data.files && Array.isArray(data.files)) {
                  const files = data.files.map((file: any) => ({
                    filename: file.filename,
                    size_kb: file.size_kb,
                    last_modified: file.last_modified,
                    s3_key: file.s3_key,
                    tool_type: DOC_TYPE_TO_TOOL_TYPE[docType] || file.tool_type
                  }))

                  // Collect only newly created/modified Word documents for artifact creation
                  if (docType === 'word' && wordOutputFilenames.size > 0) {
                    wordDocumentsForArtifact = files.filter((f: WorkspaceDocument) =>
                      wordOutputFilenames.has(f.filename)
                    )
                  }

                  // Collect only newly created/modified Excel documents for artifact creation
                  if (docType === 'excel' && excelOutputFilenames.size > 0) {
                    excelDocumentsForArtifact = files.filter((f: WorkspaceDocument) =>
                      excelOutputFilenames.has(f.filename)
                    )
                  }

                  // Collect only newly created/modified PowerPoint documents for artifact creation
                  if (docType === 'powerpoint' && pptOutputFilenames.size > 0) {
                    pptDocumentsForArtifact = files.filter((f: WorkspaceDocument) =>
                      pptOutputFilenames.has(f.filename)
                    )
                  }

                  return files
                }
              }
              return []
            })

            const results = await Promise.all(fetchPromises)
            workspaceDocuments = results.flat()

            // Trigger Word document artifact creation callback (only for output files)
            if (wordDocumentsForArtifact.length > 0 && onWordDocumentsCreated) {
              onWordDocumentsCreated(wordDocumentsForArtifact)
            }

            // Trigger Excel document artifact creation callback (only for output files)
            if (excelDocumentsForArtifact.length > 0 && onExcelDocumentsCreated) {
              onExcelDocumentsCreated(excelDocumentsForArtifact)
            }

            // Trigger PowerPoint document artifact creation callback (only for output files)
            if (pptDocumentsForArtifact.length > 0 && onPptDocumentsCreated) {
              onPptDocumentsCreated(pptDocumentsForArtifact)
            }
          } catch (error) {
            // Failed to fetch workspace files - non-critical, will use backend-provided documents
          }
        }

        // Trigger Excalidraw diagram artifact creation (JSON content direct from tool result)
        if (onExcalidrawCreated) {
          for (const toolExec of currentToolExecutionsRef.current) {
            if (!toolExec.isComplete || toolExec.isCancelled || !toolExec.toolResult) continue
            // Check direct tool name OR skill_executor wrapping
            const isExcalidrawTool = toolExec.toolName === 'create_excalidraw_diagram' ||
              (toolExec.toolName === 'skill_executor' && toolExec.toolInput?.tool_name === 'create_excalidraw_diagram')
            if (isExcalidrawTool) {
              try {
                let result = JSON.parse(toolExec.toolResult)
                // skill_executor wraps result in an extra layer
                if (toolExec.toolName === 'skill_executor' && result.result) {
                  result = typeof result.result === 'string' ? JSON.parse(result.result) : result.result
                }
                if (result.success && result.excalidraw_data) {
                  onExcalidrawCreated(result.excalidraw_data, toolExec.id)
                }
              } catch {
                // Invalid JSON, skip
              }
            }
          }
        }

        // Trigger diagram artifact creation (uses s3_key from metadata directly, no workspace API needed)
        if (onDiagramCreated) {
          for (const toolExec of currentToolExecutionsRef.current) {
            if (!toolExec.isComplete || toolExec.isCancelled) continue
            const docType = resolveDocType(toolExec)
            if (docType === 'diagram' && toolExec.metadata?.s3_key && toolExec.metadata?.filename) {
              onDiagramCreated(toolExec.metadata.s3_key, toolExec.metadata.filename)
            }
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
        interrupt: null,
        swarmProgress: prev.swarmProgress,  // Preserve swarm progress for expanded view
        pendingOAuth: prev.pendingOAuth  // Preserve pending OAuth until completion callback
      }))

      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      metadataTracking.reset()
    }
  }, [setSessionState, setMessages, setUIState, streamingStartedRef, streamingIdRef, completeProcessedRef, metadataTracking, currentToolExecutionsRef, textBuffer, stopPollingRef])

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
      // Stop polling on error
      if (stopPollingRef.current) {
        stopPollingRef.current()
      }

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
        swarmProgress: undefined,  // Clear swarm progress on error
        pendingOAuth: prev.pendingOAuth  // Preserve pending OAuth on error
      }))

      // Reset refs on error
      streamingStartedRef.current = false
      streamingIdRef.current = null
      completeProcessedRef.current = false
      metadataTracking.reset()

      // Reset swarm mode state on error
      if (swarmModeRef.current.isActive) {
        console.log('[Swarm] Reset due to error')
        swarmModeRef.current = { isActive: false, nodeHistory: [], agentSteps: [] }
      }
    }
  }, [uiState, setMessages, setUIState, setSessionState, streamingStartedRef, streamingIdRef, completeProcessedRef, metadataTracking, textBuffer, stopPollingRef])

  const handleInterruptEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'interrupt') {
      if (stopPollingRef.current) {
        stopPollingRef.current()
      }

      setSessionState(prev => ({
        ...prev,
        interrupt: {
          interrupts: data.interrupts
        }
      }))

      // For A2A tool interrupts (research plan approval), keep current agentStatus
      // to avoid flickering from rapid researching → idle → researching transitions.
      // The Canvas will handle user interaction (plan approval) while chat stays in current state.
      const isA2AInterrupt = data.interrupts?.some(
        (int: any) => int.reason?.tool_name === 'research_agent' || int.reason?.tool_name === 'browser_use_agent'
      )

      setUIState(prev => ({
        ...prev,
        isTyping: false,
        ...(isA2AInterrupt ? {} : { agentStatus: 'idle' })
      }))
    }
  }, [setSessionState, setUIState, stopPollingRef])

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

  // OAuth Elicitation event handler (MCP elicit_url protocol)
  const handleOAuthElicitationEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'oauth_elicitation') {
      const serviceName = data.message?.match(/^(\w+)\s+authorization/i)?.[1] || 'Service'

      console.log(`[OAuth Elicitation] Authorization required for ${serviceName}:`, data.authUrl)

      setSessionState(prev => ({
        ...prev,
        pendingOAuth: {
          authUrl: data.authUrl,
          serviceName,
          popupOpened: false,
          elicitationId: data.elicitationId,
        }
      }))

      // Auto-open OAuth popup
      const popup = window.open(
        data.authUrl,
        'oauth_popup',
        'width=500,height=700,scrollbars=yes,resizable=yes'
      )

      if (popup) {
        popup.focus()
        setSessionState(prev => ({
          ...prev,
          pendingOAuth: prev.pendingOAuth ? {
            ...prev.pendingOAuth,
            popupOpened: true
          } : null
        }))
      }
    }
  }, [setSessionState])

  // Swarm Mode event handlers
  const isCodeAgentExec = (t: ToolExecution) =>
    t.toolName === 'code_agent' ||
    t.toolName === 'agentcore_code-agent' ||
    (t.toolName === 'skill_executor' && t.toolInput?.tool_name === 'code_agent')

  const handleCodeStepEvent = useCallback((event: StreamEvent) => {
    if (event.type !== 'code_step') return
    const activeExec = currentToolExecutionsRef.current.find(
      t => isCodeAgentExec(t) && !t.isComplete
    )
    if (!activeExec) return

    const updatedExecutions = currentToolExecutionsRef.current.map(t =>
      t.id === activeExec.id
        ? { ...t, codeSteps: [...(t.codeSteps || []), event.content as string] }
        : t
    )
    currentToolExecutionsRef.current = updatedExecutions
    setSessionState(prev => ({ ...prev, toolExecutions: updatedExecutions }))
    setMessages(prev => prev.map(msg =>
      msg.isToolMessage && msg.toolExecutions
        ? { ...msg, toolExecutions: msg.toolExecutions.map(t =>
            t.id === activeExec.id
              ? { ...t, codeSteps: [...(t.codeSteps || []), event.content as string] }
              : t
          )}
        : msg
    ))
  }, [currentToolExecutionsRef, setSessionState, setMessages])

  const handleCodeTodoUpdateEvent = useCallback((event: StreamEvent) => {
    if (event.type !== 'code_todo_update') return
    const activeExec = currentToolExecutionsRef.current.find(
      t => isCodeAgentExec(t) && !t.isComplete
    )
    if (!activeExec) return

    const todos = event.todos || []
    const updatedExecutions = currentToolExecutionsRef.current.map(t =>
      t.id === activeExec.id ? { ...t, codeTodos: todos } : t
    )
    currentToolExecutionsRef.current = updatedExecutions
    setSessionState(prev => ({ ...prev, toolExecutions: updatedExecutions }))
    setMessages(prev => prev.map(msg =>
      msg.isToolMessage && msg.toolExecutions
        ? { ...msg, toolExecutions: msg.toolExecutions.map(t =>
            t.id === activeExec.id ? { ...t, codeTodos: todos } : t
          )}
        : msg
    ))
  }, [currentToolExecutionsRef, setSessionState, setMessages])

  const handleCodeResultMetaEvent = useCallback((event: StreamEvent) => {
    if (event.type !== 'code_result_meta') return
    const codeExec = currentToolExecutionsRef.current.find(t => isCodeAgentExec(t))
    if (!codeExec) return

    const meta = {
      files_changed: event.files_changed || [],
      todos: event.todos || [],
      steps: event.steps || 0,
    }
    const updatedExecutions = currentToolExecutionsRef.current.map(t =>
      t.id === codeExec.id ? { ...t, codeResultMeta: meta } : t
    )
    currentToolExecutionsRef.current = updatedExecutions
    setSessionState(prev => ({ ...prev, toolExecutions: updatedExecutions }))
    setMessages(prev => prev.map(msg =>
      msg.isToolMessage && msg.toolExecutions
        ? { ...msg, toolExecutions: msg.toolExecutions.map(t =>
            t.id === codeExec.id ? { ...t, codeResultMeta: meta } : t
          )}
        : msg
    ))
  }, [currentToolExecutionsRef, setSessionState, setMessages])

  const handleSwarmNodeStartEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'swarm_node_start') {
      const { node_id, node_description } = event
      const displayName = SWARM_AGENT_DISPLAY_NAMES[node_id] || node_id

      // Mark previous agent as completed (create new object)
      if (swarmModeRef.current.agentSteps.length > 0) {
        const lastIndex = swarmModeRef.current.agentSteps.length - 1
        const lastStep = swarmModeRef.current.agentSteps[lastIndex]
        if (lastStep.status === 'running') {
          swarmModeRef.current.agentSteps[lastIndex] = {
            ...lastStep,
            status: 'completed',
            endTime: Date.now()
          }
        }
      }

      // Add new agent step
      const newStep = {
        nodeId: node_id,
        displayName,
        description: node_description,
        startTime: Date.now(),
        toolCalls: [],
        status: 'running' as const
      }

      // Initialize swarm mode on first node start
      if (!swarmModeRef.current.isActive) {
        swarmModeRef.current.isActive = true
        swarmModeRef.current.nodeHistory = [node_id]
        swarmModeRef.current.agentSteps = [newStep]
        console.log('[Swarm] Started - first node:', node_id)
      } else {
        swarmModeRef.current.nodeHistory = [...swarmModeRef.current.nodeHistory, node_id]
        swarmModeRef.current.agentSteps = [...swarmModeRef.current.agentSteps, newStep]
        console.log('[Swarm] Node started:', node_id)
      }

      // For nodes after first node, reset streaming state
      // (intermediate agents don't create chat messages - text goes to agentStep.responseText)
      if (swarmModeRef.current.nodeHistory.length > 1) {
        textBuffer.reset()
        streamingStartedRef.current = false
        streamingIdRef.current = null
      }

      // Don't add node badge messages - only show progress in SwarmProgress component

      // Update swarm progress in session state
      // Use flushSync only for first node to show SwarmProgress immediately
      // For subsequent nodes (especially responder), avoid flushSync to prevent re-render flash
      const updateSwarmProgress = () => {
        setSessionState(prev => ({
          ...prev,
          swarmProgress: {
            isActive: true,
            currentNode: node_id,
            currentNodeDescription: node_description || '',
            nodeHistory: [...swarmModeRef.current.nodeHistory],
            status: 'running',
            currentAction: `${displayName} working...`,
            agentSteps: [...swarmModeRef.current.agentSteps]
          }
        }))
      }

      if (swarmModeRef.current.nodeHistory.length === 1) {
        // First node - use flushSync for immediate UI feedback
        flushSync(updateSwarmProgress)
      } else {
        // Subsequent nodes - normal state update to avoid re-render flash
        updateSwarmProgress()
      }

      // Debug: log all agent steps
      console.log('[Swarm] Current agentSteps:', JSON.stringify(swarmModeRef.current.agentSteps.map(s => ({
        nodeId: s.nodeId,
        status: s.status,
        hasResponseText: !!s.responseText,
        hasHandoffMessage: !!s.handoffMessage,
        hasHandoffContext: !!s.handoffContext
      }))))

      // Update agent status to swarm
      setUIState(prev => {
        if (prev.agentStatus !== 'swarm' && prev.agentStatus !== 'stopping') {
          return { ...prev, isTyping: true, agentStatus: 'swarm' }
        }
        return prev
      })
    }
  }, [setSessionState, setUIState, setMessages, textBuffer])

  const handleSwarmNodeStopEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'swarm_node_stop') {
      const { node_id, status } = event
      console.log('[Swarm] Node stopped:', node_id, 'status:', status)

      // Find and update the agent step with the correct status
      if (swarmModeRef.current.agentSteps.length > 0) {
        const stepIndex = swarmModeRef.current.agentSteps.findIndex(
          step => step.nodeId === node_id && step.status === 'running'
        )
        if (stepIndex >= 0) {
          const currentStep = swarmModeRef.current.agentSteps[stepIndex]
          const finalStatus = status === 'completed' ? 'completed' : 'failed'
          swarmModeRef.current.agentSteps[stepIndex] = {
            ...currentStep,
            status: finalStatus,
            endTime: Date.now()
          }

          // Update session state
          setSessionState(prev => ({
            ...prev,
            swarmProgress: prev.swarmProgress ? {
              ...prev.swarmProgress,
              agentSteps: [...swarmModeRef.current.agentSteps]
            } : prev.swarmProgress
          }))
        }
      }
    }
  }, [setSessionState])

  const handleSwarmHandoffEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'swarm_handoff') {
      console.log('[Swarm] Handoff:', event.from_node, '->', event.to_node, 'message:', event.message)

      const toDisplayName = SWARM_AGENT_DISPLAY_NAMES[event.to_node] || event.to_node

      // Flush buffer before handoff
      textBuffer.reset()

      // Finalize current streaming message
      if (streamingStartedRef.current && streamingIdRef.current) {
        setMessages(prevMsgs => prevMsgs.map(msg =>
          msg.id === streamingIdRef.current
            ? { ...msg, isStreaming: false }
            : msg
        ))
      }

      // Save handoff message and context to the from_node's step
      if (swarmModeRef.current.agentSteps.length > 0 && event.from_node) {
        // Find the step for the agent that is handing off
        const stepIndex = swarmModeRef.current.agentSteps.findIndex(
          step => step.nodeId === event.from_node
        )
        if (stepIndex >= 0) {
          const currentStep = swarmModeRef.current.agentSteps[stepIndex]
          swarmModeRef.current.agentSteps[stepIndex] = {
            ...currentStep,
            ...(event.message && { handoffMessage: event.message }),
            ...(event.context && { handoffContext: event.context })
          }

          // Log context for debugging
          console.log('[Swarm] Handoff context saved to', event.from_node, ':', event.context)
        } else {
          console.warn('[Swarm] Could not find step for from_node:', event.from_node)
        }
      }

      // Update swarm progress to show handoff (no flushSync - avoid full re-render)
      setSessionState(prev => ({
        ...prev,
        swarmProgress: prev.swarmProgress ? {
          ...prev.swarmProgress,
          currentAction: `Handing off to ${toDisplayName}...`,
          agentSteps: [...swarmModeRef.current.agentSteps]
        } : prev.swarmProgress
      }))

      // Reset streaming refs for next agent
      streamingStartedRef.current = false
      streamingIdRef.current = null
    }
  }, [setMessages, setSessionState, textBuffer])

  const handleSwarmCompleteEvent = useCallback((event: StreamEvent) => {
    if (event.type === 'swarm_complete') {
      console.log('[Swarm] Complete:', event.total_nodes, 'nodes, status:', event.status)

      // Mark final agent as completed (create new object)
      if (swarmModeRef.current.agentSteps.length > 0) {
        const lastIndex = swarmModeRef.current.agentSteps.length - 1
        const lastStep = swarmModeRef.current.agentSteps[lastIndex]
        if (lastStep.status === 'running') {
          swarmModeRef.current.agentSteps[lastIndex] = {
            ...lastStep,
            status: 'completed',
            endTime: Date.now()
          }
        }
      }

      // Flush any remaining text
      textBuffer.reset()

      // Build swarmContext for the message (agents used, excluding coordinator/responder)
      const agentsUsed = (event.node_history || []).filter(
        (n: string) => n !== 'coordinator' && n !== 'responder'
      )
      const swarmContext = agentsUsed.length > 0
        ? { agentsUsed, sharedContext: event.shared_context }
        : undefined

      // Check if final response came from a non-responder agent (coordinator or specialist)
      // In this case, we need to create a new message since responder didn't stream anything
      const isNonResponderFinal = event.final_node_id && event.final_node_id !== 'responder'

      // Reset streaming refs
      streamingStartedRef.current = false
      streamingIdRef.current = null

      // Handle message creation/update
      setMessages(prevMsgs => {
        // If a non-responder agent completed the swarm, create a new message from final_response
        if (isNonResponderFinal && event.final_response) {
          console.log('[Swarm] Creating message from non-responder final:', event.final_node_id)
          return [...prevMsgs, {
            id: String(Date.now()),
            text: event.final_response,
            sender: 'bot' as const,
            timestamp: new Date().toISOString(),
            isStreaming: false,
            images: [],
            swarmContext
          }]
        }

        // Responder case: find and update the last bot message (from current turn)
        const lastBotIdx = prevMsgs.map(m => m.sender).lastIndexOf('bot')
        if (lastBotIdx === -1) {
          // No bot message exists - create fallback if there's a final_response
          if (event.final_response) {
            console.log('[Swarm] Creating fallback message (no bot message found)')
            return [...prevMsgs, {
              id: String(Date.now()),
              text: event.final_response,
              sender: 'bot' as const,
              timestamp: new Date().toISOString(),
              isStreaming: false,
              images: [],
              swarmContext
            }]
          }
          return prevMsgs
        }

        // Update the last bot message: finalize streaming and add swarmContext
        return prevMsgs.map((msg, idx) => {
          if (idx === lastBotIdx) {
            return {
              ...msg,
              isStreaming: false,
              swarmContext
            }
          }
          return msg
        })
      })

      // Save final agent steps before reset
      const finalAgentSteps = [...swarmModeRef.current.agentSteps]
      const finalNodeHistory = [...(event.node_history || swarmModeRef.current.nodeHistory)]

      // Reset swarm mode
      swarmModeRef.current = { isActive: false, nodeHistory: [], agentSteps: [] }

      // Set swarm progress to completed (keeps component visible but collapsed)
      setSessionState(prev => ({
        ...prev,
        swarmProgress: {
          isActive: false,
          currentNode: '',
          currentNodeDescription: '',
          nodeHistory: finalNodeHistory,
          status: event.status === 'completed' ? 'completed' : 'failed',
          currentAction: undefined,
          agentSteps: finalAgentSteps
        }
      }))
    }
  }, [setSessionState, setMessages, textBuffer])

  // Handler for 'text' events (used by Swarm mode for intermediate agents)
  const handleTextEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'text') {
      // Text events are ONLY from non-responder agents in swarm mode
      // Update SwarmProgress only, never create chat messages
      if (swarmModeRef.current.isActive && swarmModeRef.current.agentSteps.length > 0) {
        const stepIndex = swarmModeRef.current.agentSteps.length - 1
        const currentStep = swarmModeRef.current.agentSteps[stepIndex]
        const updatedStep = {
          ...currentStep,
          responseText: (currentStep.responseText || '') + data.content
        }
        swarmModeRef.current.agentSteps[stepIndex] = updatedStep
          setSessionState(prev => ({
            ...prev,
            swarmProgress: prev.swarmProgress ? {
              ...prev.swarmProgress,
              agentSteps: [...swarmModeRef.current.agentSteps]
            } : prev.swarmProgress
          }))
      }
      // If not in swarm mode or no agentSteps, ignore text events
      // (they shouldn't occur outside swarm mode anyway)
    }
  }, [setSessionState])

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    try {
      switch (event.type) {
        case 'reasoning':
          handleReasoningEvent(event)
          break
        case 'response':
          handleResponseEvent(event)
          break
        case 'text':
          handleTextEvent(event)
          break
        case 'tool_use':
          handleToolUseEvent(event)
          break
        case 'code_step':
          handleCodeStepEvent(event)
          break
        case 'code_todo_update':
          handleCodeTodoUpdateEvent(event)
          break
        case 'code_result_meta':
          handleCodeResultMetaEvent(event)
          break
        case 'progress':
          // Handle progress events from streaming tools (no-op for now)
          break
        case 'tool_result':
          handleToolResultEvent(event)
          break
        case 'complete':
          // handleCompleteEvent is async - catch rejections to prevent app crash
          handleCompleteEvent(event).catch(err => {
            console.error('[useStreamEvents] Error in complete event handler:', err)
          })
          break
        case 'init':
        case 'thinking':
          handleInitEvent()
          break
        case 'error':
          handleErrorEvent(event)
          break
        case 'warning':
          // Show warning as a bot message without stopping the stream
          setMessages(prev => [...prev, {
            id: `warning_${Date.now()}`,
            text: `⚠️ ${event.message}`,
            sender: 'bot',
            timestamp: new Date().toISOString()
          }])
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
        case 'oauth_elicitation':
          handleOAuthElicitationEvent(event)
          break
        case 'swarm_node_start':
          handleSwarmNodeStartEvent(event)
          break
        case 'swarm_node_stop':
          handleSwarmNodeStopEvent(event)
          break
        case 'swarm_handoff':
          handleSwarmHandoffEvent(event)
          break
        case 'swarm_complete':
          handleSwarmCompleteEvent(event)
          break
        case 'start':
          // Stream start marker - handled by init event
          handleInitEvent()
          break
        case 'end':
          // Stream end marker - no special handling needed
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

              // Notify parent about browser session detection (for Canvas integration)
              if (onBrowserSessionDetected && browserSession.sessionId) {
                onBrowserSessionDetected(browserSession.sessionId, browserSession.browserId || '')
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
    } catch (error) {
      console.error('[useStreamEvents] Error processing stream event:', error, 'Event type:', event?.type)
    }
  }, [
    handleReasoningEvent,
    handleResponseEvent,
    handleTextEvent,
    handleToolUseEvent,
    handleToolResultEvent,
    handleCompleteEvent,
    handleInitEvent,
    handleErrorEvent,
    handleInterruptEvent,
    handleBrowserProgressEvent,
    handleResearchProgressEvent,
    handleOAuthElicitationEvent,
    handleCodeStepEvent,
    handleCodeTodoUpdateEvent,
    handleCodeResultMetaEvent,
    handleSwarmNodeStartEvent,
    handleSwarmNodeStopEvent,
    handleSwarmHandoffEvent,
    handleSwarmCompleteEvent,
    setSessionState,
    onBrowserSessionDetected
  ])

  // Reset streaming state (called when user stops generation)
  const resetStreamingState = useCallback(() => {
    // Flush any remaining buffered text before resetting
    textBuffer.reset()

    streamingStartedRef.current = false
    streamingIdRef.current = null
    completeProcessedRef.current = false
    metadataTracking.reset()

    // Reset swarm mode state if active
    if (swarmModeRef.current.isActive) {
      console.log('[Swarm] Reset during streaming stop')
      swarmModeRef.current = { isActive: false, nodeHistory: [], agentSteps: [] }
    }

    // Mark current streaming message as stopped (not streaming)
    setMessages(prev => prev.map(msg =>
      msg.isStreaming ? { ...msg, isStreaming: false } : msg
    ))

    setSessionState(prev => ({
      ...prev,
      reasoning: null,
      streaming: null,
      swarmProgress: undefined // Clear swarm progress on reset
    }))
  }, [setMessages, setSessionState, metadataTracking, textBuffer])

  return { handleStreamEvent, resetStreamingState }
}
