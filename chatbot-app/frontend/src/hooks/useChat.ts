import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { ReasoningState, ChatSessionState, ChatUIState, InterruptState, AgentStatus, PendingOAuthState } from '@/types/events'
import { detectBackendUrl } from '@/utils/chat'
import { useStreamEvents } from './useStreamEvents'
import { useChatAPI, SessionPreferences } from './useChatAPI'
import { usePolling, hasOngoingA2ATools, A2A_TOOLS_REQUIRING_POLLING } from './usePolling'
import { getApiUrl } from '@/config/environment'
import { fetchAuthSession } from 'aws-amplify/auth'
import { apiGet, apiPost } from '@/lib/api-client'

import { WorkspaceDocument } from './useStreamEvents'
import { ExtractedDataInfo } from './useCanvasHandlers'

interface UseChatProps {
  onSessionCreated?: () => void
  onArtifactUpdated?: () => void  // Callback when artifact is updated via update_artifact tool
  onWordDocumentsCreated?: (documents: WorkspaceDocument[]) => void  // Callback when Word documents are created
  onExcelDocumentsCreated?: (documents: WorkspaceDocument[]) => void  // Callback when Excel documents are created
  onPptDocumentsCreated?: (documents: WorkspaceDocument[]) => void  // Callback when PowerPoint documents are created
  onDiagramCreated?: (s3Key: string, filename: string) => void  // Callback when diagram is generated
  onBrowserSessionDetected?: (browserSessionId: string, browserId: string) => void  // Callback when browser session is first detected
  onExtractedDataCreated?: (data: ExtractedDataInfo) => void  // Callback when browser_extract creates artifact
  onExcalidrawCreated?: (data: { elements: any[]; appState: any; title: string }, toolUseId: string) => void  // Callback when excalidraw diagram is created
  onSessionLoaded?: () => void  // Callback when session load completes (artifacts ready in sessionStorage)
}

interface UseChatReturn {
  messages: Message[]
  groupedMessages: Array<{
    type: 'user' | 'assistant_turn'
    messages: Message[]
    id: string
  }>
  isConnected: boolean
  isTyping: boolean
  agentStatus: AgentStatus
  availableTools: Tool[]
  currentToolExecutions: ToolExecution[]
  currentReasoning: ReasoningState | null
  showProgressPanel: boolean
  toggleProgressPanel: () => void
  sendMessage: (text: string, files?: File[], additionalTools?: string[], systemPrompt?: string, selectedArtifactId?: string | null) => Promise<void>
  stopGeneration: () => void
  newChat: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  setExclusiveTools: (toolIds: string[]) => void
  refreshTools: () => Promise<void>
  sessionId: string | null
  isLoadingMessages: boolean
  loadSession: (sessionId: string) => Promise<void>
  onGatewayToolsChange: (enabledToolIds: string[]) => void
  browserSession: { sessionId: string | null; browserId: string | null } | null
  browserProgress?: Array<{ stepNumber: number; content: string }>
  researchProgress?: { stepNumber: number; content: string }
  respondToInterrupt: (interruptId: string, response: string) => Promise<void>
  currentInterrupt: InterruptState | null
  // Per-session model state
  currentModelId: string
  currentTemperature: number
  updateModelConfig: (modelId: string, temperature?: number) => void
  // Swarm mode (Multi-Agent)
  swarmEnabled: boolean
  toggleSwarm: (enabled: boolean) => void
  skillsEnabled: boolean
  toggleSkills: (enabled: boolean) => void
  swarmProgress?: {
    isActive: boolean
    currentNode: string
    currentNodeDescription: string
    nodeHistory: string[]
    status: 'idle' | 'running' | 'completed' | 'failed'
  }
  // Voice mode
  addVoiceToolExecution: (toolExecution: ToolExecution) => void
  updateVoiceMessage: (role: 'user' | 'assistant', text: string, isFinal: boolean) => void
  setVoiceStatus: (status: AgentStatus) => void
  finalizeVoiceMessage: () => void
  // Artifact message
  addArtifactMessage: (artifact: { id: string; type: string; title: string; wordCount?: number }) => void
  // OAuth state
  pendingOAuth: PendingOAuthState | null | undefined
}

// Default preferences when session has no saved preferences
const DEFAULT_PREFERENCES: SessionPreferences = {
  lastModel: 'us.anthropic.claude-sonnet-4-6',
  enabledTools: [],
  selectedPromptId: 'general',
}

export const useChat = (props?: UseChatProps): UseChatReturn => {
  // ==================== STATE ====================
  const [messages, setMessages] = useState<Message[]>([])
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000')
  const [availableTools, setAvailableTools] = useState<Tool[]>([])
  const [gatewayToolIds, setGatewayToolIds] = useState<string[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [swarmEnabled, setSwarmEnabled] = useState(false)
  const [skillsEnabled, setSkillsEnabled] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  // Per-session model state (not written to global profile on session switch)
  const [currentModelId, setCurrentModelId] = useState(DEFAULT_PREFERENCES.lastModel!)
  const [currentTemperature, setCurrentTemperature] = useState(0.5)

  // Ref to hold session-specific enabled tools for re-application after loadTools
  const sessionEnabledToolsRef = useRef<string[] | null>(null)

  // Ref for onSessionLoaded callback to avoid stale closure in useCallback
  const onSessionLoadedRef = useRef(props?.onSessionLoaded)
  onSessionLoadedRef.current = props?.onSessionLoaded

  const [sessionState, setSessionState] = useState<ChatSessionState>({
    reasoning: null,
    streaming: null,
    toolExecutions: [],
    browserSession: null,
    interrupt: null,
    pendingOAuth: null
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
  const messagesRef = useRef<Message[]>([])

  // Keep refs in sync with state
  useEffect(() => {
    currentToolExecutionsRef.current = sessionState.toolExecutions
  }, [sessionState.toolExecutions])

  useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

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
  const stopPollingRef = useRef<(() => void) | null>(null)

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
    stopPollingRef,
    sessionId,
    availableTools,
    onArtifactUpdated: props?.onArtifactUpdated,
    onWordDocumentsCreated: props?.onWordDocumentsCreated,
    onExcelDocumentsCreated: props?.onExcelDocumentsCreated,
    onPptDocumentsCreated: props?.onPptDocumentsCreated,
    onDiagramCreated: props?.onDiagramCreated,
    onBrowserSessionDetected: props?.onBrowserSessionDetected,
    onExtractedDataCreated: props?.onExtractedDataCreated,
    onExcalidrawCreated: props?.onExcalidrawCreated
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
    onSessionCreated: handleSessionCreated,
    currentModelId,
    currentTemperature
  })

  // Initialize polling with apiLoadSession (now available)
  const { startPolling, stopPolling, checkAndStartPollingForA2ATools } = usePolling({
    sessionId,
    loadSession: apiLoadSession
  })

  // Update polling refs so useStreamEvents can use them
  useEffect(() => {
    startPollingRef.current = startPolling
    stopPollingRef.current = stopPolling
  }, [startPolling, stopPolling])

  // ==================== A2A AGENT UI STATE MANAGEMENT ====================
  // Update UI status based on ongoing A2A agents (research/browser)
  // This is the ONLY place that sets researching/browser_automation status from messages
  // PERFORMANCE: Only check last 5 messages for ongoing tools (recent activity)
  useEffect(() => {
    if (!sessionId || currentSessionIdRef.current !== sessionId) return

    // PERFORMANCE: Only check recent messages (last 5) for ongoing A2A agents
    // Ongoing agents are always in the most recent messages
    let hasOngoingResearch = false
    let hasOngoingBrowser = false

    const startIdx = Math.max(0, messages.length - 5)
    for (let i = messages.length - 1; i >= startIdx; i--) {
      const toolExecutions = messages[i].toolExecutions
      if (!toolExecutions) continue

      for (const te of toolExecutions) {
        if (te.isComplete || te.isCancelled) continue
        if (te.toolName === 'research_agent') hasOngoingResearch = true
        else if (te.toolName === 'browser_use_agent') hasOngoingBrowser = true
      }
      // Early exit if both found
      if (hasOngoingResearch && hasOngoingBrowser) break
    }

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
    } else {
      // No ongoing A2A tools - transition to idle if currently stuck in A2A status.
      // This handles the case where SSE stream dropped (disconnect, session switch)
      // but the A2A agent completed in the background. Without this, agentStatus
      // would stay 'researching'/'browser_automation' forever since only stream
      // event handlers (complete/error) used to set idle.
      setUIState(prev => {
        if (prev.agentStatus === 'researching' || prev.agentStatus === 'browser_automation') {
          console.log('[useChat] A2A tools completed, transitioning to idle')
          return { ...prev, isTyping: false, agentStatus: 'idle' }
        }
        return prev
      })
      // Stop polling since A2A tools are no longer ongoing
      stopPolling()
    }
  }, [messages, sessionId, stopPolling])

  // ==================== SESSION LOADING ====================
  const loadSessionWithPreferences = useCallback(async (newSessionId: string) => {
    // Immediately update session ref to prevent race conditions
    currentSessionIdRef.current = newSessionId

    // Stop any existing polling
    stopPolling()

    // Set loading state for UI feedback
    setIsLoadingMessages(true)

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
      browserProgress: undefined,
      researchProgress: undefined,
      interrupt: null,
      pendingOAuth: null
    })

    try {
      const preferences = await apiLoadSession(newSessionId)

    // Verify session hasn't changed during async load
    if (currentSessionIdRef.current !== newSessionId) {
      console.log(`[useChat] Session changed during load, aborting setup`)
      return
    }

    // Check for ongoing A2A tools and start polling if needed
    // Use setTimeout to ensure messages state is updated, read from ref to avoid triggering re-render
    setTimeout(() => {
      checkAndStartPollingForA2ATools(messagesRef.current, newSessionId)
    }, 100)

    // Merge saved preferences with defaults
    const effectivePreferences: SessionPreferences = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
      lastModel: preferences?.lastModel || DEFAULT_PREFERENCES.lastModel,
    }

    console.log(`[useChat] ${preferences ? 'Restoring session' : 'Using default'} preferences:`, effectivePreferences)

    // Restore tool states (including nested tools in dynamic groups)
    const enabledTools = effectivePreferences.enabledTools || []
    setAvailableTools(prevTools => prevTools.map(tool => {
      const updated: any = { ...tool, enabled: enabledTools.includes(tool.id) }
      if ((tool as any).isDynamic && (tool as any).tools) {
        updated.tools = (tool as any).tools.map((nt: any) => ({
          ...nt,
          enabled: enabledTools.includes(nt.id)
        }))
      }
      return updated
    }))
    // Save enabled tools ref so loadTools re-application can restore them
    sessionEnabledToolsRef.current = enabledTools
    console.log(`[useChat] Tool states updated: ${enabledTools.length} enabled`)

    // Restore model configuration with validation against available models
    let restoredModel = effectivePreferences.lastModel!
    try {
      const modelsResponse = await apiGet<{ models: { id: string }[] }>('model/available-models')
      const validModelIds = modelsResponse.models?.map(m => m.id) || []
      if (validModelIds.length > 0 && !validModelIds.includes(restoredModel)) {
        console.warn(`[useChat] Saved model ${restoredModel} not in available models, falling back to default`)
        restoredModel = DEFAULT_PREFERENCES.lastModel!
      }
    } catch {
      // If fetch fails, use saved model as-is
    }
    setCurrentModelId(restoredModel)
    console.log(`[useChat] Model state updated: ${restoredModel}`)

    // Restore swarm mode preference from sessionStorage
    const savedSwarmEnabled = sessionStorage.getItem(`swarm-enabled-${newSessionId}`)
    const swarmRestored = savedSwarmEnabled === 'true'
    setSwarmEnabled(swarmRestored)
    console.log(`[useChat] Swarm mode restored: ${swarmRestored}`)

    // Restore skills mode from session preferences (DynamoDB), fallback to sessionStorage, default true
    const skillsRestored = effectivePreferences.skillsEnabled ??
      (sessionStorage.getItem(`skills-enabled-${newSessionId}`) !== 'false')
    setSkillsEnabled(skillsRestored)
    console.log(`[useChat] Skills mode restored: ${skillsRestored}`)

    // Notify that session loading is complete (artifacts are in sessionStorage)
    onSessionLoadedRef.current?.()
    } finally {
      setIsLoadingMessages(false)
    }
  }, [apiLoadSession, setAvailableTools, setUIState, setSessionState, stopPolling, checkAndStartPollingForA2ATools])

  // ==================== INITIALIZATION EFFECTS ====================
  // Load tools when backend is ready (enabled states are preserved via merge in loadTools)
  useEffect(() => {
    if (uiState.isConnected) {
      const timeoutId = setTimeout(() => {
        loadTools()
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [uiState.isConnected, loadTools])

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
          // 404 is expected for new sessions - session metadata is created on first message
          setSessionState(prev => ({ ...prev, browserSession: null }))
          return
        }

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.session?.metadata?.browserSession) {
            const browserSession = data.session.metadata.browserSession
            console.warn('[useChat] Restored browser session from DynamoDB')
            setSessionState(prev => ({ ...prev, browserSession }))
            sessionStorage.setItem(`browser-session-${sessionId}`, JSON.stringify(browserSession))
          } else {
            setSessionState(prev => ({ ...prev, browserSession: null }))
          }
        }
      } catch (e) {
        console.warn('[useChat] Could not load browser session:', e)
      }
    }

    loadBrowserSession()
  }, [sessionId])

  // ==================== OAUTH COMPLETION LISTENER ====================
  // Listen for postMessage from OAuth popup window
  useEffect(() => {
    const handleOAuthMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return

      // Handle MCP elicitation-based OAuth completion (new protocol)
      if (event.data?.type === 'oauth_elicitation_complete') {
        console.log('[useChat] OAuth elicitation completion message received:', event.data)

        // Signal backend that elicitation is complete (unblocks the waiting MCP tool)
        try {
          await fetch('/api/stream/elicitation-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: event.data.sessionId || sessionId,
              elicitationId: sessionState.pendingOAuth?.elicitationId,
            }),
          })
        } catch (error) {
          console.error('[useChat] Failed to signal elicitation complete:', error)
        }

        // Clear pending OAuth state
        setSessionState(prev => ({ ...prev, pendingOAuth: null }))
        return
      }

      // Handle legacy OAuth completion (pre-elicitation protocol)
      if (event.data?.type !== 'oauth_complete') return

      console.log('[useChat] OAuth completion message received:', event.data)

      const pendingOAuth = sessionState.pendingOAuth
      if (!pendingOAuth) {
        console.log('[useChat] No pending OAuth to resume')
        return
      }

      // Clear pending OAuth state
      setSessionState(prev => ({ ...prev, pendingOAuth: null }))

      if (event.data.success) {
        console.log(`[useChat] OAuth completed successfully for ${pendingOAuth.serviceName}, retrying...`)

        // Add a retry message to trigger the agent to try again
        const retryMessage = `The ${pendingOAuth.serviceName} authorization has been completed. Please continue with the previous request.`

        // Set UI state to show we're retrying
        setUIState(prev => ({
          ...prev,
          isTyping: true,
          agentStatus: 'thinking'
        }))

        // Send retry message automatically
        try {
          await apiSendMessage(
            retryMessage,
            undefined,
            () => {},
            () => {
              setSessionState(prev => ({
                reasoning: null,
                streaming: null,
                toolExecutions: [],
                browserSession: prev.browserSession,
                browserProgress: undefined,
                researchProgress: undefined,
                interrupt: null,
                pendingOAuth: null
              }))
            },
            undefined, // overrideEnabledTools
            skillsEnabled ? "skill" : swarmEnabled ? "swarm" : undefined // preserve request type
          )
        } catch (error) {
          console.error('[useChat] Failed to send retry message:', error)
          setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
        }
      }
    }

    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [sessionState.pendingOAuth, apiSendMessage, sessionId, skillsEnabled, swarmEnabled])

  // ==================== ACTIONS ====================
  const toggleTool = useCallback(async (toolId: string) => {
    await apiToggleTool(toolId)
  }, [apiToggleTool])

  // Set only specific tools as enabled; disable everything else in one state update
  const setExclusiveTools = useCallback((toolIds: string[]) => {
    const idSet = new Set(toolIds)
    setAvailableTools(prev => prev.map(tool => {
      const isDynamic = (tool as any).isDynamic === true
      const nestedTools = (tool as any).tools || []

      if (isDynamic && nestedTools.length > 0) {
        // For dynamic groups, enable/disable nested tools
        const updatedNested = nestedTools.map((nt: any) => ({
          ...nt,
          enabled: idSet.has(tool.id)
        }))
        return { ...tool, enabled: idSet.has(tool.id), tools: updatedNested }
      }

      return { ...tool, enabled: idSet.has(tool.id) }
    }))
  }, [setAvailableTools])

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
        browserProgress: undefined,
        researchProgress: undefined,
        interrupt: null,
        pendingOAuth: null
      })
      setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
      setMessages([])
      // Reset to defaults: skills enabled, all tools disabled, swarm off
      setSkillsEnabled(true)
      setSwarmEnabled(false)
      setAvailableTools(prevTools => prevTools.map(tool => {
        const updated: any = { ...tool, enabled: false }
        if ((tool as any).isDynamic && (tool as any).tools) {
          updated.tools = (tool as any).tools.map((nt: any) => ({ ...nt, enabled: false }))
        }
        return updated
      }))
      sessionEnabledToolsRef.current = []
      if (oldSessionId) {
        sessionStorage.removeItem(`browser-session-${oldSessionId}`)
      }
    }
  }, [apiNewChat, sessionId, stopPolling, setAvailableTools])

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
        overrideTools,
        skillsEnabled ? "skill" : swarmEnabled ? "swarm" : undefined // preserve request type
      )
    } catch (error) {
      console.error('[Interrupt] Failed to respond to interrupt:', error)
      setUIState(prev => ({ ...prev, isTyping: false, agentStatus: 'idle' }))
    }
  }, [sessionState.interrupt, apiSendMessage, skillsEnabled, swarmEnabled])

  const sendMessage = useCallback(async (text: string, files?: File[], additionalTools?: string[], systemPrompt?: string, selectedArtifactId?: string | null) => {
    if (!text.trim() && (!files || files.length === 0)) return

    const userMessage: Message = {
      id: String(Date.now()),
      text,
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
      toolExecutions: [],
      researchProgress: undefined
    }))
    currentToolExecutionsRef.current = []

    const messageToSend = text.trim() || (files && files.length > 0 ? "Please analyze the uploaded file(s)." : "")

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
          researchProgress: undefined,
          interrupt: null,
          pendingOAuth: null
        }))
      },
      undefined, // overrideEnabledTools
      skillsEnabled ? "skill" : swarmEnabled ? "swarm" : undefined, // Pass request type to backend
      additionalTools, // Pass additional tools (e.g., artifact editor)
      systemPrompt, // Pass system prompt (e.g., artifact context)
      selectedArtifactId // Pass selected artifact ID for tool context
    )
  }, [apiSendMessage, swarmEnabled, skillsEnabled])

  const stopGeneration = useCallback(() => {
    setUIState(prev => ({ ...prev, agentStatus: 'stopping' }))
    // Send stop signal to backend (sets flag in DB/memory)
    // Do NOT abort fetch - let backend handle graceful shutdown
    // so that saved response matches what user sees
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
            messages: currentAssistantTurn,
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
        messages: currentAssistantTurn,
        id: `turn_${currentAssistantTurn[0].id}`
      })
    }

    return grouped
  }, [messages])

  // Update per-session model config (React state + global default via API)
  const updateModelConfig = useCallback((modelId: string, temperature?: number) => {
    setCurrentModelId(modelId)
    if (temperature !== undefined) {
      setCurrentTemperature(temperature)
    }
    // Also persist as global default for new chats
    apiPost('model/config/update', {
      model_id: modelId,
      ...(temperature !== undefined && { temperature }),
    }, {
      headers: sessionId ? { 'X-Session-ID': sessionId } : {},
    }).catch(error => {
      console.warn('[useChat] Failed to update global model config:', error)
    })
  }, [sessionId])

  const toggleProgressPanel = useCallback(() => {
    setUIState(prev => ({ ...prev, showProgressPanel: !prev.showProgressPanel }))
  }, [])

  const handleGatewayToolsChange = useCallback((enabledToolIds: string[]) => {
    setGatewayToolIds(enabledToolIds)
  }, [])

  const toggleSwarm = useCallback((enabled: boolean) => {
    setSwarmEnabled(enabled)
    if (enabled) setSkillsEnabled(false) // Mutual exclusion
    // Persist swarm mode preference to sessionStorage
    const currentSessionId = sessionStorage.getItem('chat-session-id')
    if (currentSessionId) {
      sessionStorage.setItem(`swarm-enabled-${currentSessionId}`, String(enabled))
    }
    console.log(`[useChat] Swarm ${enabled ? 'enabled' : 'disabled'}`)
  }, [])

  const toggleSkills = useCallback((enabled: boolean) => {
    setSkillsEnabled(enabled)
    if (enabled) setSwarmEnabled(false) // Mutual exclusion
    // Persist skills mode preference to sessionStorage
    const currentSessionId = sessionStorage.getItem('chat-session-id')
    if (currentSessionId) {
      sessionStorage.setItem(`skills-enabled-${currentSessionId}`, String(enabled))
    }
    console.log(`[useChat] Skills ${enabled ? 'enabled' : 'disabled'}`)
  }, [])

  // Add voice tool execution (mirrors text mode's handleToolUseEvent pattern)
  // Tool executions are added as separate isToolMessage messages
  const addVoiceToolExecution = useCallback((toolExecution: ToolExecution) => {
    console.log(`[useChat] addVoiceToolExecution: ${toolExecution.toolName}, id=${toolExecution.id}`)

    setMessages(prev => {
      // First, finalize any current assistant streaming message (like text mode does)
      // Find by properties instead of refs for React state consistency
      let updated = prev.map(msg => {
        if (msg.isVoiceMessage && msg.isStreaming && msg.sender === 'bot') {
          console.log(`[useChat] Finalizing assistant streaming message before tool: ${msg.id}`)
          return { ...msg, isStreaming: false }
        }
        return msg
      })

      // Check if there's an existing tool message we should update
      const existingToolMsgIdx = updated.findIndex(msg =>
        msg.isToolMessage &&
        msg.isVoiceMessage &&
        msg.toolExecutions?.some(te => te.id === toolExecution.id)
      )

      if (existingToolMsgIdx >= 0) {
        // Update existing tool execution
        return updated.map((msg, idx) => {
          if (idx === existingToolMsgIdx && msg.toolExecutions) {
            return {
              ...msg,
              toolExecutions: msg.toolExecutions.map(te =>
                te.id === toolExecution.id ? toolExecution : te
              ),
            }
          }
          return msg
        })
      }

      // Create new tool message (like text mode's isToolMessage pattern)
      return [...updated, {
        id: `voice_tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: '',
        sender: 'bot' as const,
        timestamp: new Date().toISOString(),
        isVoiceMessage: true,
        isToolMessage: true,
        toolExecutions: [toolExecution],
      }]
    })
  }, [])

  // Track pre-voice mode states for restoration after voice ends
  const preVoiceModeRef = useRef<{ skills: boolean; swarm: boolean } | null>(null)

  // Set voice status (called by useVoiceChat via callback)
  const setVoiceStatus = useCallback((status: AgentStatus) => {
    const wasVoice = uiState.agentStatus.startsWith('voice_')
    const isVoice = status.startsWith('voice_')

    // Voice activated: save current mode and disable skills/swarm
    if (!wasVoice && isVoice) {
      preVoiceModeRef.current = { skills: skillsEnabled, swarm: swarmEnabled }
      setSkillsEnabled(false)
      setSwarmEnabled(false)
      console.log('[useChat] Voice activated — disabled skills/swarm')
    }

    // Voice deactivated: restore previous mode
    if (wasVoice && !isVoice && preVoiceModeRef.current) {
      setSkillsEnabled(preVoiceModeRef.current.skills)
      setSwarmEnabled(preVoiceModeRef.current.swarm)
      console.log('[useChat] Voice deactivated — restored skills/swarm')
      preVoiceModeRef.current = null
    }

    setUIState(prev => ({ ...prev, agentStatus: status }))
  }, [uiState.agentStatus, skillsEnabled, swarmEnabled])

  // Add artifact message (called when composer workflow creates an artifact)
  const addArtifactMessage = useCallback((artifact: { id: string; type: string; title: string; wordCount?: number }) => {
    const newMessage: Message = {
      id: `artifact_${Date.now()}`,
      text: '',  // No text, just the artifact reference
      sender: 'bot',
      timestamp: new Date().toISOString(),
      artifactReference: {
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        wordCount: artifact.wordCount
      }
    }
    setMessages(prev => [...prev, newMessage])
  }, [])

  // Finalize current voice message (called when bidi_response_complete, tool_use, or interruption)
  // This marks ALL streaming voice messages as complete (both user and assistant)
  // This is safe because:
  // - bidi_response_complete: assistant finished speaking
  // - tool_use: assistant pausing for tool execution
  // - bidi_interruption: user interrupted, assistant should stop
  // In all cases, any pending streaming message should be finalized.
  const finalizeVoiceMessage = useCallback(() => {
    console.log('[useChat] finalizeVoiceMessage called')

    setMessages(prev => {
      // Find ALL streaming voice messages and finalize them
      const hasStreamingMessages = prev.some(msg =>
        msg.isVoiceMessage && msg.isStreaming === true
      )

      if (!hasStreamingMessages) {
        console.log('[useChat] No streaming voice messages to finalize')
        return prev
      }

      return prev.map(msg => {
        if (msg.isVoiceMessage && msg.isStreaming === true) {
          const finalId = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          console.log(`[useChat] Finalizing ${msg.sender} message: ${msg.id} -> ${finalId}`)
          return { ...msg, id: finalId, isStreaming: false }
        }
        return msg
      })
    })
  }, [])

  // Update voice message with turn-based accumulation
  //
  // Key insight: Nova Sonic sends multiple FINAL transcripts for a single utterance.
  // We must NOT finalize on each is_final=true, but accumulate until:
  // 1. Role changes (user → assistant or vice versa)
  // 2. Explicit finalize via bidi_response_complete, tool_use, or interruption
  //
  // Message lifecycle:
  // 1. First delta for a role → Create new message with isStreaming=true
  // 2. Subsequent deltas (same role) → APPEND delta to same message (ignore is_final)
  // 3. Role changes → Finalize previous role's message, create new for new role
  // 4. Explicit finalize events → Call finalizeVoiceMessage() separately
  //
  // IMPORTANT: is_final from Nova Sonic marks end of a "segment", not end of "turn".
  // A turn can have multiple segments. Only finalize on role change or explicit events.
  const updateVoiceMessage = useCallback((role: 'user' | 'assistant', deltaText: string, _isFinal: boolean) => {
    const sender = role === 'user' ? 'user' : 'bot'
    const otherSender = role === 'user' ? 'bot' : 'user'

    console.log(`[useChat] updateVoiceMessage: role=${role}, delta="${deltaText.substring(0, 50)}..."`)

    setMessages(prev => {
      // Step 1: Check if there's a streaming message from the OTHER role
      // If so, we need to finalize it first (role change occurred)
      const otherStreamingIdx = prev.findIndex(msg =>
        msg.isVoiceMessage &&
        msg.isStreaming === true &&
        msg.sender === otherSender
      )

      let updatedMessages = prev

      if (otherStreamingIdx >= 0) {
        // Finalize the other role's streaming message (role change)
        const otherMsg = prev[otherStreamingIdx]
        const finalId = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        console.log(`[useChat] Role changed: finalizing ${otherSender} message: ${otherMsg.id} -> ${finalId}`)

        updatedMessages = prev.map((msg, idx) => {
          if (idx === otherStreamingIdx) {
            return { ...msg, id: finalId, isStreaming: false }
          }
          return msg
        })
      }

      // Step 2: Find existing streaming message for THIS role
      const streamingMsgIdx = updatedMessages.findIndex(msg =>
        msg.isVoiceMessage &&
        msg.isStreaming === true &&
        msg.sender === sender
      )

      if (streamingMsgIdx >= 0) {
        // Append delta to existing streaming message (same role)
        const existingMsg = updatedMessages[streamingMsgIdx]
        const newText = (existingMsg.text || '') + deltaText

        console.log(`[useChat] Appending to streaming ${sender} message: id=${existingMsg.id}, newLen=${newText.length}`)

        return updatedMessages.map((msg, idx) => {
          if (idx === streamingMsgIdx) {
            return { ...msg, text: newText }
          }
          return msg
        })
      } else {
        // No streaming message for this role - create new one
        const newId = `voice_streaming_${role}_${Date.now()}`

        console.log(`[useChat] Creating NEW voice message for ${sender}: ${newId}, delta="${deltaText.substring(0, 30)}..."`)

        return [...updatedMessages, {
          id: newId,
          text: deltaText,
          sender,
          timestamp: new Date().toISOString(),
          isVoiceMessage: true,
          isStreaming: true,  // Always start as streaming, finalize explicitly
        }]
      }
    })
  }, [])

  // ==================== CLEANUP ====================
  useEffect(() => {
    return cleanup
  }, [cleanup])

  // ==================== RETURN ====================
  return {
    messages,
    groupedMessages,
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
    setExclusiveTools,
    refreshTools,
    sessionId,
    isLoadingMessages,
    loadSession: loadSessionWithPreferences,
    onGatewayToolsChange: handleGatewayToolsChange,
    browserSession: sessionState.browserSession,
    browserProgress: sessionState.browserProgress,
    researchProgress: sessionState.researchProgress,
    respondToInterrupt,
    currentInterrupt: sessionState.interrupt,
    // Per-session model state
    currentModelId,
    currentTemperature,
    updateModelConfig,
    // Swarm mode (Multi-Agent)
    swarmEnabled,
    toggleSwarm,
    skillsEnabled,
    toggleSkills,
    swarmProgress: sessionState.swarmProgress,
    // Voice mode
    addVoiceToolExecution,
    updateVoiceMessage,
    setVoiceStatus,
    finalizeVoiceMessage,
    // Artifact message
    addArtifactMessage,
    // OAuth state
    pendingOAuth: sessionState.pendingOAuth,
  }
}
