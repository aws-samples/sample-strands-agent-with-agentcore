"use client"

import React from "react"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useChat } from "@/hooks/useChat"
import { useIframeAuth, postAuthStatusToParent } from "@/hooks/useIframeAuth"
import { useArtifacts } from "@/hooks/useArtifacts"
import { ArtifactType } from "@/types/artifact"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { AssistantTurn } from "@/components/chat/AssistantTurn"
import { Greeting } from "@/components/Greeting"
import { ChatSidebar } from "@/components/ChatSidebar"
import { ToolsDropdown } from "@/components/ToolsDropdown"
import { SuggestedQuestions } from "@/components/SuggestedQuestions"
import { BrowserLiveViewButton } from "@/components/BrowserLiveViewButton"
import { ResearchModal } from "@/components/ResearchModal"
import { BrowserResultModal } from "@/components/BrowserResultModal"
import { InterruptApprovalModal } from "@/components/InterruptApprovalModal"
import { SwarmProgress } from "@/components/SwarmProgress"
import { Canvas } from "@/components/Canvas"
import { VoiceAnimation } from "@/components/VoiceAnimation"
import { ComposeWizard, ComposeConfig } from "@/components/ComposeWizard"
import { useComposer } from "@/hooks/useComposer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Upload, Send, FileText, ImageIcon, Square, Loader2, ArrowDown, Mic, FlaskConical, Sparkles } from "lucide-react"
import { AIIcon } from "@/components/ui/AIIcon"
import { ModelConfigDialog } from "@/components/ModelConfigDialog"
import { apiGet } from "@/lib/api-client"
import { useTheme } from "next-themes"
import { useVoiceIntegration } from "@/hooks/useVoiceIntegration"

interface ChatInterfaceProps {
  mode: 'standalone' | 'embedded'
}

// Custom debounce hook
function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout>()

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args)
    }, delay)
  }, [callback, delay]) as T
}

// Custom throttle hook
function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRunRef = useRef(0)
  const timeoutRef = useRef<NodeJS.Timeout>()

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now()
    const timeSinceLastRun = now - lastRunRef.current

    if (timeSinceLastRun >= delay) {
      callback(...args)
      lastRunRef.current = now
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args)
        lastRunRef.current = Date.now()
      }, delay - timeSinceLastRun)
    }
  }, [callback, delay]) as T
}

export function ChatInterface({ mode }: ChatInterfaceProps) {
  const isEmbedded = mode === 'embedded'
  const sidebarContext = useSidebar()
  const { setOpen, setOpenMobile, open } = sidebarContext
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)

  // Prevent hydration mismatch by only rendering theme-dependent UI after mount
  useEffect(() => {
    setMounted(true)
  }, [])

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.innerWidth < 768) // Tailwind md breakpoint
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Scroll control state
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const isAutoScrollingRef = useRef(false)

  // Ref for artifact refresh callback (to avoid circular dependency)
  const refreshArtifactsRef = useRef<(() => void) | null>(null)

  const {
    groupedMessages,
    inputMessage,
    setInputMessage,
    isConnected,
    isTyping,
    agentStatus,
    availableTools,
    currentReasoning,
    sendMessage,
    stopGeneration,
    newChat,
    toggleTool,
    refreshTools,
    sessionId,
    loadSession,
    onGatewayToolsChange,
    browserSession,
    browserProgress,
    researchProgress,
    respondToInterrupt,
    currentInterrupt,
    swarmEnabled,
    toggleSwarm: toggleSwarmHook,
    swarmProgress,
    addVoiceToolExecution,
    updateVoiceMessage,
    setVoiceStatus,
    finalizeVoiceMessage,
    addArtifactMessage,
  } = useChat({
    onArtifactUpdated: () => {
      // Call the ref function (set after useArtifacts initializes)
      if (refreshArtifactsRef.current) {
        refreshArtifactsRef.current()
      }
    }
  })

  // Calculate tool counts considering nested tools in dynamic groups (excluding Research Agent)
  const { enabledCount, totalCount } = useMemo(() => {
    let enabled = 0
    let total = 0

    availableTools.forEach(tool => {
      // Exclude Research Agent from count
      if (tool.id === 'agentcore_research-agent') {
        return
      }

      const isDynamic = (tool as any).isDynamic === true
      const nestedTools = (tool as any).tools || []

      if (isDynamic && nestedTools.length > 0) {
        // For dynamic tools, count nested tools
        total += nestedTools.length
        enabled += nestedTools.filter((nt: any) => nt.enabled).length
      } else {
        // For regular tools, count the tool itself
        total += 1
        if (tool.enabled) {
          enabled += 1
        }
      }
    })

    return { enabledCount: enabled, totalCount: total }
  }, [availableTools])

  // Stable sessionId reference to prevent unnecessary re-renders
  const stableSessionId = useMemo(() => sessionId || undefined, [sessionId])

  // iframe auth (only for embedded mode)
  const iframeAuth = isEmbedded ? useIframeAuth() : { isInIframe: false, isAuthenticated: false, user: null, isLoading: false, error: null }

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [suggestionKey, setSuggestionKey] = useState<string>("initial")
  const [currentModelName, setCurrentModelName] = useState<string>("")
  const [isResearchEnabled, setIsResearchEnabled] = useState<boolean>(false)
  const [isResearchModalOpen, setIsResearchModalOpen] = useState<boolean>(false)
  const [activeResearchId, setActiveResearchId] = useState<string | null>(null)
  // Track each research execution independently
  const [researchData, setResearchData] = useState<Map<string, {
    query: string
    result: string
    status: 'idle' | 'searching' | 'analyzing' | 'generating' | 'complete' | 'error' | 'declined'
    agentName: string
  }>>(new Map())
  // Browser modal state (separate from research)
  const [isBrowserModalOpen, setIsBrowserModalOpen] = useState<boolean>(false)
  const [activeBrowserId, setActiveBrowserId] = useState<string | null>(null)
  // Track each browser execution independently
  const [browserData, setBrowserData] = useState<Map<string, {
    query: string
    result: string
    status: 'idle' | 'running' | 'complete' | 'error'
    agentName: string
  }>>(new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  // Compose wizard state
  const [isComposeWizardOpen, setIsComposeWizardOpen] = useState(false)
  const [inputRect, setInputRect] = useState<DOMRect | null>(null)

  // Artifact management
  const {
    artifacts,
    selectedArtifactId,
    isCanvasOpen,
    toggleCanvas: toggleCanvasBase,
    openArtifact: openArtifactBase,
    closeCanvas: closeCanvasBase,
    setSelectedArtifactId,
    addArtifact,
    removeArtifact,
    refreshArtifacts,
    justUpdated: artifactJustUpdated,
  } = useArtifacts(groupedMessages, sessionId)

  // Update ref after useArtifacts initializes (to avoid circular dependency with useChat)
  useEffect(() => {
    refreshArtifactsRef.current = refreshArtifacts
  }, [refreshArtifacts])

  // Composer artifact ID tracking
  const [composeArtifactId, setComposeArtifactId] = useState<string | null>(null)

  // Artifact editing state
  const [editingArtifact, setEditingArtifact] = useState<{
    id: string
    title: string
    content: string
  } | null>(null)

  // Composer management
  const composer = useComposer({
    sessionId,
    onDocumentComplete: async (doc) => {
      // Remove temporary compose artifact from UI
      if (composeArtifactId) {
        removeArtifact(composeArtifactId)
      }
      setComposeArtifactId(null)
      // Artifact is added via onArtifactCreated callback (real-time from backend)
    },
    onArtifactCreated: (artifact) => {
      // Artifact saved to backend - add to local state immediately
      console.log('[ChatInterface] Artifact created from backend:', artifact.id)
      addArtifact({
        id: artifact.id,
        type: artifact.type as ArtifactType,
        title: artifact.title,
        content: artifact.content,
        description: artifact.metadata?.description || `${artifact.metadata?.word_count || 0} words`,
        timestamp: artifact.created_at || new Date().toISOString(),
        sessionId: sessionId || '',
      })

      // Add artifact message to chat (real-time update)
      addArtifactMessage({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        wordCount: artifact.metadata?.word_count
      })

      // Also save to sessionStorage for persistence across reloads
      if (sessionId) {
        const artifactsKey = `artifacts-${sessionId}`
        const stored = sessionStorage.getItem(artifactsKey)
        const artifacts = stored ? JSON.parse(stored) : []
        artifacts.push(artifact)
        sessionStorage.setItem(artifactsKey, JSON.stringify(artifacts))
      }

      // Auto-open the new artifact
      openArtifactBase(artifact.id)
    },
  })

  // Wrapped startCompose to create artifact immediately
  const startCompose = useCallback(async (message: string) => {
    // Create compose artifact
    const artifactId = `compose-${Date.now()}`
    setComposeArtifactId(artifactId)

    addArtifact({
      id: artifactId,
      type: 'compose',
      title: 'Composing Document...',
      content: {}, // Content is provided via composeState prop in Canvas
      description: 'Document composition in progress',
      toolName: 'composer',
      timestamp: new Date().toISOString(),
      sessionId: sessionId || '',
    })

    // Open canvas
    openArtifactBase(artifactId)

    // Start composition - backend will load conversation history and model config automatically
    await composer.startCompose(message)
  }, [sessionId, composer, addArtifact, openArtifactBase])

  // Handle edit in chat - explicit mode via button

  // Auto-enable editing mode when canvas is open with a document
  useEffect(() => {
    if (isCanvasOpen && selectedArtifactId) {
      const artifact = artifacts.find(a => a.id === selectedArtifactId)
      if (artifact && artifact.type === 'document' && typeof artifact.content === 'string') {
        setEditingArtifact({
          id: artifact.id,
          title: artifact.title,
          content: artifact.content
        })
      }
    } else {
      setEditingArtifact(null)
    }
  }, [isCanvasOpen, selectedArtifactId, artifacts])

  // Wrapper functions to ensure mutual exclusivity between left sidebar and canvas
  const toggleCanvas = useCallback(() => {
    if (!isCanvasOpen) {
      // Opening canvas - close left sidebar
      setOpen(false)
      setOpenMobile(false)
    }
    toggleCanvasBase()
  }, [isCanvasOpen, toggleCanvasBase, setOpen, setOpenMobile])

  const openArtifact = useCallback((id: string) => {
    // Opening canvas - close left sidebar
    setOpen(false)
    setOpenMobile(false)
    openArtifactBase(id)
  }, [openArtifactBase, setOpen, setOpenMobile])

  const closeCanvas = useCallback(() => {
    // Clear editing state when closing panel
    setEditingArtifact(null)
    closeCanvasBase()
  }, [closeCanvasBase])

  // Close canvas when left sidebar opens
  useEffect(() => {
    if (open && isCanvasOpen) {
      closeCanvas()
    }
  }, [open, isCanvasOpen, closeCanvas])

  // Close canvas on mobile view
  useEffect(() => {
    if (isMobileView && isCanvasOpen) {
      closeCanvas()
    }
  }, [isMobileView, isCanvasOpen, closeCanvas])

  // Listen for open-artifact events from ChatMessage artifact cards
  useEffect(() => {
    const handleOpenArtifact = (event: CustomEvent<{ artifactId: string }>) => {
      openArtifact(event.detail.artifactId)
    }
    const handleOpenArtifactByTitle = (event: CustomEvent<{ title: string }>) => {
      // Find artifact by title
      const artifact = artifacts.find(a => a.title === event.detail.title)
      if (artifact) {
        openArtifact(artifact.id)
      }
    }
    window.addEventListener('open-artifact', handleOpenArtifact as EventListener)
    window.addEventListener('open-artifact-by-title', handleOpenArtifactByTitle as EventListener)
    return () => {
      window.removeEventListener('open-artifact', handleOpenArtifact as EventListener)
      window.removeEventListener('open-artifact-by-title', handleOpenArtifactByTitle as EventListener)
    }
  }, [openArtifact, artifacts])


  // Get enabled tool IDs for voice chat (including nested tools from dynamic groups)
  const enabledToolIds = useMemo(() => {
    const ids: string[] = []
    availableTools.forEach(tool => {
      // Check if this is a grouped tool with nested tools (isDynamic)
      if ((tool as any).isDynamic && (tool as any).tools) {
        // Add enabled nested tools
        const nestedTools = (tool as any).tools || []
        nestedTools.forEach((nestedTool: any) => {
          if (nestedTool.enabled) {
            ids.push(nestedTool.id)
          }
        })
      } else if (tool.enabled) {
        // Add regular enabled tools
        ids.push(tool.id)
      }
    })
    return ids
  }, [availableTools])

  // Callback to refresh session list when voice creates a new session
  const refreshSessionList = useCallback(() => {
    if (typeof (window as any).__refreshSessionList === 'function') {
      (window as any).__refreshSessionList()
    }
  }, [])

  // Voice integration hook
  const {
    isVoiceSupported,
    isVoiceActive,
    voiceToolExecution,
    voiceError,
    connectVoice,
    disconnectVoice,
    forceDisconnectVoice,
  } = useVoiceIntegration({
    sessionId,
    enabledToolIds,
    agentStatus,
    addVoiceToolExecution,
    updateVoiceMessage,
    setVoiceStatus,
    finalizeVoiceMessage,
    onSessionCreated: refreshSessionList,
  })


  // Sync Research Agent state with availableTools
  useEffect(() => {
    const researchTool = availableTools.find(tool => tool.id === 'agentcore_research-agent')
    if (researchTool) {
      setIsResearchEnabled(researchTool.enabled)
    }
  }, [availableTools])

  // Toggle Research Agent
  const toggleResearchAgent = useCallback(async () => {
    const researchTool = availableTools.find(tool => tool.id === 'agentcore_research-agent')
    if (researchTool) {
      const willBeEnabled = !researchTool.enabled

      // If enabling research, disable all other tools and swarm
      if (willBeEnabled) {
        // Disable swarm
        toggleSwarmHook(false)

        // Disable all tools except research agent
        const enabledTools = availableTools.filter(tool =>
          tool.id !== 'agentcore_research-agent' && tool.enabled
        )

        for (const tool of enabledTools) {
          const isDynamic = (tool as any).isDynamic === true
          const nestedTools = (tool as any).tools || []

          if (isDynamic && nestedTools.length > 0) {
            // Disable all nested tools
            for (const nestedTool of nestedTools) {
              if (nestedTool.enabled) {
                await toggleTool(nestedTool.id)
              }
            }
          } else {
            await toggleTool(tool.id)
          }
        }
      }

      // Toggle research agent
      await toggleTool(researchTool.id)
      setIsResearchEnabled(willBeEnabled)
    }
  }, [availableTools, toggleTool, toggleSwarmHook])

  // Toggle Swarm (using hook from useChat)
  const toggleSwarm = useCallback((enabled?: boolean) => {
    const newValue = enabled !== undefined ? enabled : !swarmEnabled
    toggleSwarmHook(newValue)
  }, [toggleSwarmHook, swarmEnabled])

  // Monitor messages for research_agent and browser_use_agent tool executions separately
  // PERFORMANCE: Use useMemo to compute data, then sync to state only if changed
  const { computedResearchData, computedBrowserData } = useMemo(() => {
    const newResearchData = new Map<string, {
      query: string
      result: string
      status: 'idle' | 'searching' | 'analyzing' | 'generating' | 'complete' | 'error' | 'declined'
      agentName: string
    }>()
    const newBrowserData = new Map<string, {
      query: string
      result: string
      status: 'idle' | 'running' | 'complete' | 'error'
      agentName: string
    }>()

    // Process ALL research/browser executions to avoid missing historical data
    // (User may click on old research results to view modal)
    for (const group of groupedMessages) {
      if (group.type === 'assistant_turn') {
        for (const message of group.messages) {
          const toolExecutions = message.toolExecutions
          if (!toolExecutions || toolExecutions.length === 0) continue

          // PERFORMANCE: Filter once instead of twice
          for (const execution of toolExecutions) {
            if (execution.toolName === 'research_agent') {
              const executionId = execution.id
              const query = execution.toolInput?.plan || "Research Task"

              if (!execution.isComplete) {
                newResearchData.set(executionId, {
                  query: query,
                  result: execution.streamingResponse || '',
                  status: execution.streamingResponse ? 'generating' : 'searching',
                  agentName: 'Research Agent'
                })
              } else if (execution.toolResult) {
                const resultText = execution.toolResult.toLowerCase()
                const isError = execution.isCancelled || resultText.includes('error:') || resultText.includes('failed:')
                const isDeclined = resultText === 'user declined to proceed with research' ||
                                  resultText === 'user declined to proceed with browser automation'

                let status: 'complete' | 'error' | 'declined' = 'complete'
                if (isError) status = 'error'
                else if (isDeclined) status = 'declined'

                newResearchData.set(executionId, {
                  query: query,
                  result: execution.toolResult,
                  status: status,
                  agentName: 'Research Agent'
                })
              }
            } else if (execution.toolName === 'browser_use_agent') {
              const executionId = execution.id
              const query = execution.toolInput?.task || "Browser Task"

              if (!execution.isComplete) {
                newBrowserData.set(executionId, {
                  query: query,
                  result: execution.streamingResponse || '',
                  status: 'running',
                  agentName: 'Browser Use Agent'
                })
              } else if (execution.toolResult) {
                const resultText = execution.toolResult.toLowerCase()
                const isError = execution.isCancelled || resultText.includes('error:') || resultText.includes('failed:') || resultText.includes('browser automation failed')

                newBrowserData.set(executionId, {
                  query: query,
                  result: execution.toolResult,
                  status: isError ? 'error' : 'complete',
                  agentName: 'Browser Use Agent'
                })
              }
            }
          }
        }
      }
    }

    return {
      computedResearchData: newResearchData,
      computedBrowserData: newBrowserData
    }
  }, [groupedMessages])

  // Sync computed data to state only when it actually changes
  useEffect(() => {
    if (computedResearchData.size !== researchData.size ||
        Array.from(computedResearchData.entries()).some(([id, data]) => {
          const existing = researchData.get(id)
          return !existing || existing.result !== data.result || existing.status !== data.status
        })) {
      setResearchData(computedResearchData)
    }
  }, [computedResearchData, researchData])

  useEffect(() => {
    if (computedBrowserData.size !== browserData.size ||
        Array.from(computedBrowserData.entries()).some(([id, data]) => {
          const existing = browserData.get(id)
          return !existing || existing.result !== data.result || existing.status !== data.status
        })) {
      setBrowserData(computedBrowserData)
    }
  }, [computedBrowserData, browserData])

  // Handle research container click
  const handleResearchClick = useCallback((executionId: string) => {
    setActiveResearchId(executionId)
    setIsResearchModalOpen(true)
  }, [])

  // Handle browser container click
  const handleBrowserClick = useCallback((executionId: string) => {
    setActiveBrowserId(executionId)
    setIsBrowserModalOpen(true)
  }, [])

  // Export conversation to text file
  const exportConversation = useCallback(() => {
    if (groupedMessages.length === 0) return

    const lines: string[] = []
    const now = new Date()
    const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

    lines.push(`=== Chat Export ===`)
    lines.push(`Date: ${dateStr} ${timeStr}`)
    lines.push(`Session: ${sessionId || 'N/A'}`)
    lines.push(`${'='.repeat(40)}`)
    lines.push('')

    for (const group of groupedMessages) {
      for (const message of group.messages) {
        const sender = message.sender === 'user' ? '👤 User' : '🤖 Assistant'
        const time = new Date(message.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

        lines.push(`[${time}] ${sender}:`)

        // Add message text
        if (message.text && message.text.trim()) {
          lines.push(message.text.trim())
        }

        // Add tool executions summary
        if (message.toolExecutions && message.toolExecutions.length > 0) {
          for (const tool of message.toolExecutions) {
            lines.push(`  📦 Tool: ${tool.toolName}`)
            if (tool.toolResult) {
              const resultPreview = tool.toolResult.length > 200
                ? tool.toolResult.substring(0, 200) + '...'
                : tool.toolResult
              lines.push(`  └─ Result: ${resultPreview}`)
            }
          }
        }

        // Add uploaded files info
        if (message.uploadedFiles && message.uploadedFiles.length > 0) {
          lines.push(`  📎 Files: ${message.uploadedFiles.map(f => f.name).join(', ')}`)
        }

        lines.push('')
      }
    }

    lines.push(`${'='.repeat(40)}`)
    lines.push(`Total messages: ${groupedMessages.reduce((acc, g) => acc + g.messages.length, 0)}`)

    const content = lines.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-export-${now.toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [groupedMessages, sessionId])

  // Load current model name
  const loadCurrentModel = useCallback(async () => {
    try {
      const [configData, modelsData] = await Promise.all([
        apiGet<{ success: boolean; config: any }>('model/config', {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }),
        apiGet<{ models: { id: string; name: string }[] }>('model/available-models', {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }),
      ])

      if (configData.success && configData.config && modelsData.models) {
        const currentModel = modelsData.models.find(
          (m: { id: string; name: string }) => m.id === configData.config.model_id
        )
        setCurrentModelName(currentModel?.name || 'Unknown Model')
      }
    } catch (error) {
      console.error('Failed to load current model:', error)
      setCurrentModelName('Model')
    }
  }, [sessionId])

  useEffect(() => {
    loadCurrentModel()
  }, [loadCurrentModel])

  // Post authentication status to parent window (embedded mode only)
  useEffect(() => {
    if (isEmbedded && !iframeAuth.isLoading) {
      postAuthStatusToParent(iframeAuth.isAuthenticated, iframeAuth.user)
    }
  }, [isEmbedded, iframeAuth.isAuthenticated, iframeAuth.user, iframeAuth.isLoading])

  // Development helper - expose auth verification in console (embedded mode only)
  useEffect(() => {
    if (isEmbedded && typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      (window as any).runAuthVerification = async () => {
        const { quickAuthVerification } = await import('@/utils/auth-verification')
        return quickAuthVerification()
      }
      console.log('Development mode: Run window.runAuthVerification() to test authentication')
    }
  }, [isEmbedded])

  const regenerateSuggestions = useCallback(() => {
    setSuggestionKey(`suggestion-${Date.now()}`)
  }, [])

  const handleNewChat = useCallback(async () => {
    // Force disconnect voice chat before creating new session
    forceDisconnectVoice()
    await newChat()
    regenerateSuggestions()
  }, [newChat, regenerateSuggestions, forceDisconnectVoice])

  // Wrapper for loadSession that disconnects voice first
  const handleLoadSession = useCallback(async (newSessionId: string) => {
    // Force disconnect voice chat before switching sessions
    forceDisconnectVoice()
    await loadSession(newSessionId)
  }, [loadSession, forceDisconnectVoice])

  const handleToggleTool = useCallback(
    async (toolId: string) => {
      await toggleTool(toolId)
      regenerateSuggestions()
    },
    [toggleTool, regenerateSuggestions],
  )

  // Compose wizard handlers
  const handleComposeComplete = useCallback(async (config: ComposeConfig) => {
    setIsComposeWizardOpen(false)

    // Close sidebars
    if (open) {
      setOpen(false)
    }
    setOpenMobile(false)

    // Send structured data as JSON to backend (no LLM parsing needed)
    const documentTypeMap: Record<string, string> = {
      'blog': 'blog post',
      'report': 'technical report',
      'essay': 'essay',
      'proposal': 'proposal',
      'article': 'article',
      'custom': 'document'
    }

    const composeRequest = {
      document_type: documentTypeMap[config.documentType] || config.documentType,
      topic: config.topic,
      length_guidance: config.length,
      extracted_points: [] // Empty for now, backend will extract from conversation
    }

    // Send as JSON string (backend will detect and parse directly)
    const composeMessage = JSON.stringify(composeRequest)

    // Clear input
    setInputMessage('')

    // Start compose workflow using hook
    await startCompose(composeMessage)
  }, [startCompose, open, setOpen, setOpenMobile, setInputMessage])

  // Detect /compose command
  useEffect(() => {
    if (inputMessage.trim() === '/compose') {
      // Get textarea rect for wizard positioning
      if (textareaRef.current) {
        const rect = textareaRef.current.getBoundingClientRect()
        setInputRect(rect)
        setIsComposeWizardOpen(true)
      }
    } else {
      setIsComposeWizardOpen(false)
    }
  }, [inputMessage])

  const handleSendMessage = async (e: React.FormEvent, files: File[]) => {
    if (open) {
      setOpen(false)
    }
    setOpenMobile(false)

    // Auto-enable artifact editor tool when document artifact is selected
    let additionalTools: string[] | undefined = undefined
    let artifactContext: string | undefined = undefined

    if (selectedArtifactId) {
      const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId)
      if (selectedArtifact && selectedArtifact.type === 'document') {
        additionalTools = ['update_artifact']

        // Build system prompt with artifact context
        const contentPreview = selectedArtifact.content.length > 1000
          ? selectedArtifact.content.substring(0, 1000) + '...'
          : selectedArtifact.content

        artifactContext = `# ARTIFACT CONTEXT

The user currently has a document artifact open:
- **Title**: ${selectedArtifact.title}
- **Type**: ${selectedArtifact.type}
- **Current Content Preview**:
\`\`\`
${contentPreview}
\`\`\`

If the user asks to modify this document, use the update_artifact tool to find and replace specific text.`
      }
    }

    await sendMessage(e, files, additionalTools, artifactContext, selectedArtifactId)
  }

  // Interrupt approval handlers
  const handleApproveInterrupt = useCallback(() => {
    if (currentInterrupt && currentInterrupt.interrupts.length > 0) {
      const interrupt = currentInterrupt.interrupts[0]
      respondToInterrupt(interrupt.id, "yes")
    }
  }, [currentInterrupt, respondToInterrupt])

  const handleRejectInterrupt = useCallback(() => {
    if (currentInterrupt && currentInterrupt.interrupts.length > 0) {
      const interrupt = currentInterrupt.interrupts[0]
      respondToInterrupt(interrupt.id, "no")
    }
  }, [currentInterrupt, respondToInterrupt])

  // Scroll to bottom using scrollTop (container-based scrolling)
  const scrollToBottomImmediate = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // Skip if user has scrolled up
    if (isUserScrolledUp) return

    // Mark as programmatic scroll to avoid triggering user scroll detection
    isAutoScrollingRef.current = true
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    })

    // Reset flag after scroll animation
    setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 100)
  }, [isUserScrolledUp])

  const scrollToBottom = useThrottle(scrollToBottomImmediate, 100)

  // Force scroll to bottom (for button click)
  const forceScrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    setIsUserScrolledUp(false)
    isAutoScrollingRef.current = true
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    })
    setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 100)
  }, [])

  // Handle scroll event to detect user scroll-up
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // Ignore programmatic scrolls
    if (isAutoScrollingRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // User is scrolled up if more than 100px from bottom
    const scrolledUp = distanceFromBottom > 100
    setIsUserScrolledUp(scrolledUp)
  }, [])

  // Auto-scroll on new messages and swarm progress updates
  useEffect(() => {
    scrollToBottom()
  }, [groupedMessages, isTyping, swarmProgress, scrollToBottom])

  // Reset scroll state when starting new chat
  useEffect(() => {
    if (groupedMessages.length === 0) {
      setIsUserScrolledUp(false)
    }
  }, [groupedMessages.length])

  // Pre-calculate if there's a swarm final response group
  // Used to determine where to render SwarmProgress (before AssistantTurn vs after loop)
  const hasSwarmFinalResponseGroup = useMemo(() => {
    const hasActiveSwarmProgress = swarmProgress && (swarmProgress.isActive || swarmProgress.status === 'completed' || swarmProgress.status === 'failed');
    const lastGroup = groupedMessages[groupedMessages.length - 1];
    return hasActiveSwarmProgress && lastGroup?.type === 'assistant_turn';
  }, [swarmProgress, groupedMessages])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    // Append new files to existing ones instead of replacing
    setSelectedFiles((prev) => [...prev, ...files])
    // Clear the input so the same file can be selected again if needed
    event.target.value = ""
  }

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Don't handle Enter/Escape when compose wizard is open (handled by wizard)
    if (isComposeWizardOpen && (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      // Don't submit if user is composing Korean/Chinese/Japanese
      if (isComposingRef.current) {
        return
      }

      // Detect touch-capable devices (mobile/tablet)
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

      // On touch devices (iPad, mobile), allow Enter to create new line
      // On desktop, Enter sends message (Shift+Enter for new line)
      if (isTouchDevice) {
        // Allow default behavior (new line) on touch devices
        return
      }

      e.preventDefault()
      // Don't submit if voice mode is active or compose workflow in progress
      if (agentStatus === 'idle' && !composer.isComposing && (inputMessage.trim() || selectedFiles.length > 0)) {
        const syntheticEvent = {
          preventDefault: () => {},
        } as React.FormEvent
        handleSendMessage(syntheticEvent, selectedFiles)
        setSelectedFiles([])
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          // Create a new file with a proper name (clipboard images have no name)
          const extension = item.type.split('/')[1] || 'png'
          const namedFile = new File([file], `clipboard-image-${Date.now()}.${extension}`, {
            type: file.type
          })
          imageFiles.push(namedFile)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault() // Prevent default paste behavior for images
      setSelectedFiles(prev => [...prev, ...imageFiles])
    }
  }

  const adjustTextareaHeightImmediate = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const scrollHeight = textarea.scrollHeight
      const maxHeight = 128 // max-h-32 = 8rem = 128px
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`
    }
  }, [])

  const adjustTextareaHeight = useDebounce(adjustTextareaHeightImmediate, 100)

  const handleQuestionSubmit = useCallback(async (question: string) => {
    setInputMessage(question)
    const syntheticEvent = {
      preventDefault: () => {},
      target: { elements: { message: { value: question } } },
    } as any
    await handleSendMessage(syntheticEvent, [])
  }, [setInputMessage, handleSendMessage])

  useEffect(() => {
    adjustTextareaHeight()
  }, [inputMessage, adjustTextareaHeight])

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) {
      return <ImageIcon className="w-3 h-3" />
    } else if (file.type === "application/pdf") {
      return <FileText className="w-3 h-3" />
    }
    return <FileText className="w-3 h-3" />
  }

  return (
    <>
      {/* Chat Sidebar */}
      <ChatSidebar
        sessionId={sessionId}
        onNewChat={handleNewChat}
        loadSession={handleLoadSession}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Main Chat Area - unified layout for both modes */}
      <SidebarInset
        className={`h-screen flex flex-col overflow-hidden ${groupedMessages.length === 0 ? 'justify-center items-center' : ''} transition-all duration-300 ease-in-out relative`}
        style={{ marginRight: isCanvasOpen && !isMobileView ? '950px' : '0' }}
      >
        {/* Sidebar trigger - Always visible in top-left */}
        {groupedMessages.length === 0 && (
          <div className={`absolute top-4 left-4 z-20`}>
            <SidebarTrigger />
          </div>
        )}

        {/* Theme toggle & Artifact button - Always visible in top-right */}
        {/* Artifact button - Always visible in top-right */}
        {groupedMessages.length === 0 && mounted && !isMobileView && (
          <div className={`absolute top-4 right-4 z-20`}>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleCanvas}
                    className={`h-9 w-9 p-0 hover:bg-muted/60 relative ${isCanvasOpen ? 'bg-muted' : ''}`}
                    title="Canvas"
                  >
                    <Sparkles className="h-5 w-5" />
                    {artifacts.length > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                        {artifacts.length}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {artifacts.length > 0
                      ? `View Canvas (${artifacts.length})`
                      : 'No artifacts yet'
                    }
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Top Controls - Show when chat started */}
        {groupedMessages.length > 0 && (
          <div className={`sticky top-0 z-10 flex items-center justify-between ${isEmbedded ? 'p-2' : 'p-4'} bg-background/70 backdrop-blur-md border-b border-border/30 shadow-sm`}>
            <div className="flex items-center gap-3">
              <SidebarTrigger />

              {/* Show iframe status if in embedded mode */}
              {isEmbedded && iframeAuth.isInIframe && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-caption font-medium text-muted-foreground">Embedded</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Tool count indicator (embedded mode only) */}
              {isEmbedded && totalCount > 0 && (
                <div className="text-caption text-muted-foreground">
                  {enabledCount}/{totalCount} tools
                </div>
              )}

              {/* Browser Live View Button */}
              <BrowserLiveViewButton sessionId={sessionId} browserSession={browserSession} />

              {/* Canvas Toggle - Hidden on mobile */}
              {!isMobileView && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleCanvas}
                        className={`h-8 w-8 p-0 hover:bg-muted/60 relative ${isCanvasOpen ? 'bg-muted' : ''}`}
                        title="Canvas"
                      >
                        <Sparkles className="h-4 w-4" />
                        {artifacts.length > 0 && (
                          <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                            {artifacts.length}
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {artifacts.length > 0
                          ? `View Canvas (${artifacts.length})`
                          : 'No artifacts yet'
                        }
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        )}

        {/* Messages Area - unified container scroll for both modes */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className={`flex flex-col min-w-0 gap-6 ${groupedMessages.length > 0 ? 'flex-1' : ''} overflow-y-auto relative min-h-0 ${groupedMessages.length > 0 ? 'pt-4' : ''}`}
        >
          {groupedMessages.map((group, index) => {
            const isLastGroup = index === groupedMessages.length - 1;
            const hasSwarmProgress = swarmProgress && (swarmProgress.isActive || swarmProgress.status === 'completed' || swarmProgress.status === 'failed');
            const isSwarmFinalResponse = hasSwarmProgress && isLastGroup && group.type === 'assistant_turn';

            // Check for swarmContext in history (for loaded sessions)
            // Show history swarm for all previous messages, only hide for current active swarm group
            const historySwarmContext = group.type === 'assistant_turn'
              ? group.messages.find(m => m.swarmContext)?.swarmContext
              : undefined;
            // Show history SwarmProgress if:
            // 1. Message has swarmContext, AND
            // 2. Either no active swarm progress OR this is not the last group (previous messages)
            const hasHistorySwarm = !!historySwarmContext && (!hasSwarmProgress || !isLastGroup);

            return (
              <React.Fragment key={group.id}>
                <div className={`mx-auto w-full max-w-4xl px-4 min-w-0`}>
                  {group.type === "user" ? (
                    group.messages.map((message) => (
                      <ChatMessage key={message.id} message={message} sessionId={stableSessionId} />
                    ))
                  ) : (
                    <>
                      {/* History Swarm Progress - show collapsed agent list with shared context */}
                      {hasHistorySwarm && (
                        <div className="flex justify-start mb-4">
                          <div className="flex items-start space-x-4 max-w-4xl w-full min-w-0">
                            <AIIcon size={36} isAnimating={false} className="mt-1" />
                            <div className="flex-1 pt-0.5 min-w-0">
                              <SwarmProgress
                                historyMode={true}
                                historyAgents={historySwarmContext.agentsUsed}
                                historySharedContext={historySwarmContext.sharedContext}
                                sessionId={stableSessionId}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Active Swarm Progress - render before responder's messages */}
                      {isSwarmFinalResponse && (
                        <SwarmProgress progress={swarmProgress} sessionId={stableSessionId} />
                      )}
                      <AssistantTurn
                        messages={group.messages}
                        currentReasoning={currentReasoning}
                        availableTools={availableTools}
                        sessionId={stableSessionId}
                        onResearchClick={handleResearchClick}
                        onBrowserClick={handleBrowserClick}
                        researchProgress={researchProgress}
                        hideAvatar={isSwarmFinalResponse || hasHistorySwarm}
                      />
                    </>
                  )}
                </div>
              </React.Fragment>
            );
          })}

          {/* SwarmProgress - shown here when active but NOT yet rendered in the loop (before AssistantTurn) */}
          {/* This covers: coordinator/specialist working, OR responder started but no messages yet */}
          {swarmProgress && swarmProgress.isActive && !hasSwarmFinalResponseGroup && (
            <div className={`mx-auto w-full max-w-4xl px-4 min-w-0`}>
              <SwarmProgress progress={swarmProgress} sessionId={stableSessionId} />
            </div>
          )}

          {/* Thinking Animation - Show only when agent is thinking (not in swarm mode) */}
          {agentStatus === 'thinking' && !swarmProgress?.isActive && (
            <div className={`mx-auto w-full max-w-4xl px-4 min-w-0 animate-fade-in`}>
              <AIIcon size={40} isAnimating={true} />
            </div>
          )}

          {/* Scroll target */}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* Scroll to bottom button - show when user scrolled up */}
        {isUserScrolledUp && groupedMessages.length > 0 && (
          <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-10">
            <Button
              onClick={forceScrollToBottom}
              size="sm"
              className="rounded-full shadow-lg bg-primary/90 hover:bg-primary text-primary-foreground px-4 py-2 flex items-center gap-2"
            >
              <ArrowDown className="w-4 h-4" />
              <span className="text-label">Scroll to bottom</span>
            </Button>
          </div>
        )}

        {/* Suggested Questions - Show only for embedded mode or when explicitly enabled */}
        {isEmbedded && groupedMessages.length === 0 && availableTools.length > 0 && (
          <div className={`mx-auto w-full max-w-4xl px-4 pb-2`}>
            <SuggestedQuestions
              key={suggestionKey}
              onQuestionSelect={(question) => setInputMessage(question)}
              onQuestionSubmit={handleQuestionSubmit}
              enabledTools={availableTools.filter((tool) => tool.enabled && tool.id !== 'agentcore_research-agent').map((tool) => tool.id)}
            />
          </div>
        )}

        {/* File Upload Area - Above Input */}
        {selectedFiles.length > 0 && (
          <div className={`mx-auto px-4 w-full md:max-w-4xl mb-2`}>
            <div className="flex flex-wrap gap-2">
              {selectedFiles.map((file, index) => (
                <Badge key={index} variant="secondary" className="flex items-center gap-1 max-w-[200px]">
                  {getFileIcon(file)}
                  <span className="truncate text-caption">
                    {file.name.length > 20 ? `${file.name.substring(0, 20)}...` : file.name}
                  </span>
                  <button
                    onClick={() => removeFile(index)}
                    className="ml-1 text-slate-500 hover:text-slate-700 text-label"
                    type="button"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className={`mx-auto px-4 pb-4 md:pb-6 w-full md:max-w-4xl ${isEmbedded ? 'flex-shrink-0' : ''}`}>
          {/* Show title when chat not started */}
          {groupedMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center mb-16 animate-fade-in">
              <Greeting />
            </div>
          )}

          {/* Gemini-style Chat Panel */}
          <div className="bg-muted/40 dark:bg-zinc-900 rounded-2xl p-3 shadow-sm border border-border/50">
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (isVoiceActive) return
                await handleSendMessage(e, selectedFiles)
                setSelectedFiles([])
              }}
            >
              <Input
                type="file"
                accept="image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              {/* Input row with Voice/Send buttons */}
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onCompositionStart={() => {
                    isComposingRef.current = true
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false
                  }}
                  placeholder={
                    composer.showOutlineConfirm
                      ? "Please review the outline in the Canvas"
                      : composer.isComposing
                      ? "Document is being composed..."
                      : isVoiceActive
                      ? "Voice mode active - click mic to stop"
                      : "Ask me anything..."
                  }
                  className="flex-1 min-h-[52px] max-h-36 border-0 focus:ring-0 resize-none py-2 px-1 leading-relaxed overflow-y-auto bg-transparent transition-all duration-200 placeholder:text-muted-foreground/60"
                  disabled={agentStatus !== 'idle' || composer.showOutlineConfirm || composer.isComposing}
                  rows={1}
                />
                {/* Voice & Send buttons */}
                <div className="flex items-center gap-1.5 pb-1.5">
                  {/* Voice Mode Button */}
                  {isVoiceSupported && !swarmEnabled && (agentStatus === 'idle' || isVoiceActive) && (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (composer.showOutlineConfirm) return
                              if (!isVoiceActive) {
                                await connectVoice()
                              } else {
                                disconnectVoice()
                              }
                            }}
                            disabled={composer.showOutlineConfirm}
                            className={`h-9 w-9 p-0 rounded-xl transition-all duration-200 ${
                              composer.showOutlineConfirm
                                ? 'opacity-40 cursor-not-allowed'
                                : agentStatus === 'voice_listening'
                                ? 'bg-red-500 hover:bg-red-600 text-white'
                                : agentStatus === 'voice_speaking'
                                ? 'bg-green-500 hover:bg-green-600 text-white'
                                : agentStatus === 'voice_connecting' || agentStatus === 'voice_processing'
                                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                                : 'hover:bg-muted-foreground/10 text-muted-foreground'
                            }`}
                          >
                            {agentStatus === 'voice_connecting' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : agentStatus === 'voice_listening' ? (
                              <VoiceAnimation type="listening" />
                            ) : agentStatus === 'voice_speaking' ? (
                              <VoiceAnimation type="speaking" />
                            ) : (
                              <Mic className="w-4 h-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {!isVoiceActive
                            ? 'Start voice chat'
                            : agentStatus === 'voice_connecting'
                            ? 'Connecting...'
                            : agentStatus === 'voice_listening'
                            ? 'Listening... (click to stop)'
                            : agentStatus === 'voice_speaking'
                            ? 'Speaking... (click to stop)'
                            : 'Voice active (click to stop)'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Send/Stop Button */}
                  {agentStatus !== 'idle' && !isVoiceActive ? (
                    <Button
                      type="button"
                      onClick={stopGeneration}
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 rounded-xl hover:bg-muted-foreground/10 transition-all duration-200"
                      title={agentStatus === 'stopping' ? "Stopping..." : "Stop generation"}
                      disabled={agentStatus === 'researching' || agentStatus === 'browser_automation' || agentStatus === 'stopping'}
                    >
                      {agentStatus === 'stopping' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </Button>
                  ) : !isVoiceActive ? (
                    <Button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault()
                        if (agentStatus !== 'idle' || composer.showOutlineConfirm || composer.isComposing || (!inputMessage.trim() && selectedFiles.length === 0)) return
                        await handleSendMessage(e as any, selectedFiles)
                        setSelectedFiles([])
                      }}
                      disabled={agentStatus !== 'idle' || composer.showOutlineConfirm || composer.isComposing || (!inputMessage.trim() && selectedFiles.length === 0)}
                      size="sm"
                      className="h-9 w-9 p-0 gradient-primary hover:opacity-90 text-primary-foreground rounded-xl transition-all duration-200 disabled:opacity-40"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </form>

            {/* Bottom Options Bar - Icon only */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
              {/* Left: Upload, Tools (with Auto), Research */}
              <TooltipProvider delayDuration={300}>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => document.getElementById("file-upload")?.click()}
                        disabled={isVoiceActive || composer.showOutlineConfirm}
                        className="h-9 w-9 p-0 hover:bg-muted-foreground/10 transition-all duration-200 disabled:opacity-40 text-muted-foreground"
                      >
                        <Upload className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Upload files</p>
                    </TooltipContent>
                  </Tooltip>

                  <ToolsDropdown
                    availableTools={availableTools}
                    onToggleTool={toggleTool}
                    disabled={isResearchEnabled || isVoiceActive || composer.showOutlineConfirm || isCanvasOpen}
                    autoEnabled={swarmEnabled}
                    onToggleAuto={toggleSwarm}
                  />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={toggleResearchAgent}
                        disabled={isVoiceActive || composer.showOutlineConfirm}
                        className={`h-9 w-9 p-0 transition-all duration-200 ${
                          isResearchEnabled
                            ? 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-500'
                            : (isVoiceActive || composer.showOutlineConfirm)
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-muted-foreground/10 text-muted-foreground'
                        }`}
                      >
                        <FlaskConical className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isResearchEnabled ? 'Research mode (click to disable)' : 'Enable Research mode'}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>

              {/* Right: Model */}
              <div className="flex items-center">
                <ModelConfigDialog sessionId={sessionId} agentStatus={agentStatus} />
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>

      {/* Research Modal */}
      {activeResearchId && researchData.get(activeResearchId) && (
        <ResearchModal
          isOpen={isResearchModalOpen}
          onClose={() => {
            setIsResearchModalOpen(false)
            setActiveResearchId(null)
          }}
          query={researchData.get(activeResearchId)!.query}
          isLoading={(() => {
            const status = researchData.get(activeResearchId)!.status
            return status !== 'idle' && status !== 'complete' && status !== 'error' && status !== 'declined'
          })()}
          result={researchData.get(activeResearchId)!.result}
          status={researchData.get(activeResearchId)!.status}
          sessionId={stableSessionId}
          agentName={researchData.get(activeResearchId)!.agentName}
        />
      )}

      {/* Browser Result Modal */}
      {activeBrowserId && browserData.get(activeBrowserId) && (
        <BrowserResultModal
          isOpen={isBrowserModalOpen}
          onClose={() => {
            setIsBrowserModalOpen(false)
            setActiveBrowserId(null)
          }}
          query={browserData.get(activeBrowserId)!.query}
          isLoading={(() => {
            const status = browserData.get(activeBrowserId)!.status
            return status === 'running'
          })()}
          result={browserData.get(activeBrowserId)!.result}
          status={browserData.get(activeBrowserId)!.status}
          browserProgress={browserProgress}
        />
      )}

      {/* Interrupt Approval Modal */}
      {currentInterrupt && currentInterrupt.interrupts.length > 0 && (
        <InterruptApprovalModal
          isOpen={true}
          onApprove={handleApproveInterrupt}
          onReject={handleRejectInterrupt}
          interrupts={currentInterrupt.interrupts}
        />
      )}

      {/* Compose Wizard */}
      <ComposeWizard
        isOpen={isComposeWizardOpen}
        onComplete={handleComposeComplete}
        onClose={() => setIsComposeWizardOpen(false)}
        inputRect={inputRect}
      />

      {/* Canvas */}
      <Canvas
        isOpen={isCanvasOpen}
        onClose={closeCanvas}
        artifacts={artifacts}
        selectedArtifactId={selectedArtifactId}
        onSelectArtifact={openArtifact}
        justUpdated={artifactJustUpdated}
        composeState={composeArtifactId && selectedArtifactId === composeArtifactId ? {
          isComposing: composer.isComposing,
          progress: composer.progress,
          outline: composer.outline,
          showOutlineConfirm: composer.showOutlineConfirm,
          outlineAttempt: composer.outlineAttempt,
          documentParts: composer.documentParts,
          completedDocument: composer.completedDocument,
          onConfirmOutline: composer.confirmOutlineResponse,
          onCancel: () => {
            composer.reset()
            // Remove compose artifact
            if (composeArtifactId) {
              removeArtifact(composeArtifactId)
            }
            setComposeArtifactId(null)
            closeCanvas()
          },
        } : undefined}
      />
    </>
  )
}
