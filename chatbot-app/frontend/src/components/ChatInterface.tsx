"use client"

import React, { startTransition } from "react"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useChat } from "@/hooks/useChat"
import { useArtifacts } from "@/hooks/useArtifacts"
import { useCanvasHandlers } from "@/hooks/useCanvasHandlers"
import { useAgentExecutions } from "@/hooks/useAgentExecutions"
import { ArtifactType } from "@/types/artifact"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { AssistantTurn } from "@/components/chat/AssistantTurn"
import { Greeting } from "@/components/Greeting"
import { ChatSidebar } from "@/components/ChatSidebar"
import { ToolsDropdown } from "@/components/ToolsDropdown"
import { BrowserResultModal } from "@/components/BrowserResultModal"
import { InterruptApprovalModal } from "@/components/InterruptApprovalModal"
import { SwarmProgress } from "@/components/SwarmProgress"
import { Canvas } from "@/components/canvas"
import { VoiceAnimation } from "@/components/VoiceAnimation"
import { ComposeWizard, ComposeConfig } from "@/components/ComposeWizard"
import { ChatInputArea } from "@/components/chat/ChatInputArea"
import { useComposer } from "@/hooks/useComposer"
import { useResearch } from "@/hooks/useResearch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, Send, FileText, ImageIcon, Square, Loader2, ArrowDown, Mic, FlaskConical, Sparkles } from "lucide-react"
import { AIIcon } from "@/components/ui/AIIcon"
import { ModelConfigDialog } from "@/components/ModelConfigDialog"
import { apiGet } from "@/lib/api-client"
import { useTheme } from "next-themes"
import { useVoiceIntegration } from "@/hooks/useVoiceIntegration"


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

export function ChatInterface() {
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

  // Canvas handlers (centralized document artifact handling)
  const {
    handleArtifactUpdated,
    handleWordDocumentsCreated,
    handleExcelDocumentsCreated,
    handlePptDocumentsCreated,
    handleExtractedDataCreated,
    handleOpenResearchArtifact,
    handleOpenWordArtifact,
    handleOpenExcelArtifact,
    handleOpenPptArtifact,
    handleOpenExtractedDataArtifact,
    setArtifactMethods,
  } = useCanvasHandlers()

  // Refs for browser session handling (to avoid circular dependency with useArtifacts)
  const addArtifactRef = useRef<typeof addArtifact | null>(null)
  const openCanvasRef = useRef<(() => void) | null>(null)
  const setBrowserArtifactIdRef = useRef<typeof setBrowserArtifactId | null>(null)
  const reloadFromStorageRef = useRef<(() => void) | null>(null)

  // Handler for browser session detection - creates artifact and opens Canvas
  const handleBrowserSessionDetected = useCallback((browserSessionId: string, browserId: string) => {
    console.log('[ChatInterface] Browser session detected:', browserSessionId, browserId)

    const artifactId = `browser-${browserSessionId}`
    const addArtifact = addArtifactRef.current
    const openCanvas = openCanvasRef.current
    const setBrowserArtifactId = setBrowserArtifactIdRef.current

    if (!addArtifact || !openCanvas || !setBrowserArtifactId) {
      console.warn('[ChatInterface] Artifact methods not ready yet')
      return
    }

    // Create browser artifact
    const browserArtifact = {
      id: artifactId,
      type: 'browser' as const,
      title: 'Browser View',
      content: '',
      description: 'Real-time browser automation view',
      timestamp: new Date().toISOString(),
      metadata: {
        browserSessionId,
        browserId,
      },
    }

    addArtifact(browserArtifact)

    // Also save to sessionStorage for persistence across page reloads
    const currentSessionId = sessionStorage.getItem('chat-session-id')
    if (currentSessionId) {
      const artifactsKey = `artifacts-${currentSessionId}`
      const stored = sessionStorage.getItem(artifactsKey)
      const existingArtifacts = stored ? JSON.parse(stored) : []

      // Check if browser artifact already exists
      const existingIndex = existingArtifacts.findIndex((a: any) => a.id === artifactId)
      if (existingIndex >= 0) {
        existingArtifacts[existingIndex] = browserArtifact
      } else {
        existingArtifacts.push(browserArtifact)
      }
      sessionStorage.setItem(artifactsKey, JSON.stringify(existingArtifacts))
    }

    // Set browser artifact ID and open canvas
    setBrowserArtifactId(artifactId)
    openCanvas()
  }, [])

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
    isLoadingMessages,
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
    currentModelId,
    updateModelConfig,
  } = useChat({
    onArtifactUpdated: handleArtifactUpdated,
    onWordDocumentsCreated: handleWordDocumentsCreated,
    onExcelDocumentsCreated: handleExcelDocumentsCreated,
    onPptDocumentsCreated: handlePptDocumentsCreated,
    onBrowserSessionDetected: handleBrowserSessionDetected,
    onExtractedDataCreated: handleExtractedDataCreated,
    onSessionLoaded: () => reloadFromStorageRef.current?.(),
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

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [currentModelName, setCurrentModelName] = useState<string>("")
  const [isResearchEnabled, setIsResearchEnabled] = useState<boolean>(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Agent executions (research/browser)
  const {
    researchData,
    browserData,
    isBrowserModalOpen,
    activeBrowserId,
    handleBrowserClick,
    closeBrowserModal,
  } = useAgentExecutions(groupedMessages)

  // Compose wizard state
  const [isComposeWizardOpen, setIsComposeWizardOpen] = useState(false)
  const [inputRect, setInputRect] = useState<DOMRect | null>(null)

  // Artifact management
  const {
    artifacts,
    selectedArtifactId,
    isCanvasOpen,
    toggleCanvas: toggleCanvasBase,
    openCanvas: openCanvasBase,
    openArtifact: openArtifactBase,
    closeCanvas: closeCanvasBase,
    setSelectedArtifactId,
    addArtifact,
    removeArtifact,
    refreshArtifacts,
    reloadFromStorage,
    justUpdated: artifactJustUpdated,
  } = useArtifacts(groupedMessages, sessionId)

  // Keep reloadFromStorage ref in sync for the onSessionLoaded callback
  useEffect(() => {
    reloadFromStorageRef.current = reloadFromStorage
  }, [reloadFromStorage])

  // Connect artifact methods to canvas handlers (to avoid circular dependency with useChat)
  useEffect(() => {
    setArtifactMethods({
      artifacts,
      refreshArtifacts,
      addArtifact,
      openArtifact: openArtifactBase,
    })
  }, [artifacts, refreshArtifacts, addArtifact, openArtifactBase, setArtifactMethods])

  // Composer artifact ID tracking
  const [composeArtifactId, setComposeArtifactId] = useState<string | null>(null)

  // Research artifact ID tracking
  const [researchArtifactId, setResearchArtifactId] = useState<string | null>(null)

  // Browser artifact ID tracking (for Live View in Canvas)
  const [browserArtifactId, setBrowserArtifactId] = useState<string | null>(null)

  // Update browser session handling refs (to avoid circular dependency)
  useEffect(() => {
    addArtifactRef.current = addArtifact
  }, [addArtifact])

  useEffect(() => {
    openCanvasRef.current = openCanvasBase
  }, [openCanvasBase])

  useEffect(() => {
    setBrowserArtifactIdRef.current = setBrowserArtifactId
  }, [setBrowserArtifactId])

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

  // Research management
  const research = useResearch({
    sessionId,
    respondToInterrupt,
  })

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

  const openCanvas = useCallback(() => {
    // Opening canvas - close left sidebar
    setOpen(false)
    setOpenMobile(false)
    openCanvasBase()
  }, [openCanvasBase, setOpen, setOpenMobile])

  // Research Canvas callbacks - use refs for stable references
  const researchRef = useRef(research)
  researchRef.current = research

  const handleResearchConfirmPlan = useCallback((approved: boolean) => {
    researchRef.current.confirmPlanResponse(approved)
    if (!approved) {
      researchRef.current.reset()
      setResearchArtifactId(null)
      processedInterruptRef.current = null
      closeCanvas()
    }
  }, [closeCanvas])

  const handleResearchCancel = useCallback(() => {
    if (researchRef.current.showPlanConfirm) {
      researchRef.current.confirmPlanResponse(false)
    }
    researchRef.current.reset()
    setResearchArtifactId(null)
    processedInterruptRef.current = null
    closeCanvas()
  }, [closeCanvas])

  // Browser Canvas callbacks - handle connection errors and validation failures
  const handleBrowserConnectionError = useCallback(() => {
    console.log('[ChatInterface] Browser connection error, removing artifact')
    if (browserArtifactId) {
      removeArtifact(browserArtifactId)
      setBrowserArtifactId(null)

      // Also remove from sessionStorage
      const currentSessionId = sessionStorage.getItem('chat-session-id')
      if (currentSessionId) {
        const artifactsKey = `artifacts-${currentSessionId}`
        const stored = sessionStorage.getItem(artifactsKey)
        if (stored) {
          const artifacts = JSON.parse(stored).filter((a: any) => a.id !== browserArtifactId)
          sessionStorage.setItem(artifactsKey, JSON.stringify(artifacts))
        }
      }
    }
  }, [browserArtifactId, removeArtifact])

  const handleBrowserValidationFailed = useCallback(() => {
    console.log('[ChatInterface] Browser session validation failed, removing artifact')
    if (browserArtifactId) {
      removeArtifact(browserArtifactId)
      setBrowserArtifactId(null)

      // Also remove from sessionStorage
      const currentSessionId = sessionStorage.getItem('chat-session-id')
      if (currentSessionId) {
        const artifactsKey = `artifacts-${currentSessionId}`
        const stored = sessionStorage.getItem(artifactsKey)
        if (stored) {
          const artifacts = JSON.parse(stored).filter((a: any) => a.id !== browserArtifactId)
          sessionStorage.setItem(artifactsKey, JSON.stringify(artifacts))
        }
      }
    }
  }, [browserArtifactId, removeArtifact])

  // Restore and validate browser artifact on page load
  useEffect(() => {
    if (!sessionId) return

    // Check if we have a browser artifact that needs to be restored
    const existingBrowserArtifact = artifacts.find(a => a.type === 'browser')
    if (existingBrowserArtifact && !browserArtifactId) {
      console.log('[ChatInterface] Found browser artifact, validating session...')

      // Get browserSession info from artifact metadata or sessionStorage
      const metadata = existingBrowserArtifact.metadata
      const browserSessionId = metadata?.browserSessionId || browserSession?.sessionId
      const browserId = metadata?.browserId || browserSession?.browserId

      if (!browserSessionId) {
        // No session info - remove invalid artifact
        console.log('[ChatInterface] No browser session info, removing artifact')
        removeArtifact(existingBrowserArtifact.id)
        return
      }

      // Validate the session
      const validateAndRestore = async () => {
        try {
          let validateUrl = `/api/browser/validate-session?sessionId=${encodeURIComponent(browserSessionId)}`
          if (browserId) {
            validateUrl += `&browserId=${encodeURIComponent(browserId)}`
          }

          const response = await fetch(validateUrl)
          const data = await response.json()

          if (data.isValid) {
            // Session is valid - restore artifact
            console.log('[ChatInterface] Browser session valid, restoring artifact')
            setBrowserArtifactId(existingBrowserArtifact.id)
            openCanvasRef.current?.()
          } else {
            // Session is invalid - remove artifact
            console.log('[ChatInterface] Browser session invalid, removing artifact')
            removeArtifact(existingBrowserArtifact.id)

            // Also remove from sessionStorage
            const artifactsKey = `artifacts-${sessionId}`
            const stored = sessionStorage.getItem(artifactsKey)
            if (stored) {
              const artifacts = JSON.parse(stored).filter((a: any) => a.id !== existingBrowserArtifact.id)
              sessionStorage.setItem(artifactsKey, JSON.stringify(artifacts))
            }
          }
        } catch (error) {
          console.warn('[ChatInterface] Failed to validate browser session:', error)
          // On error, still restore artifact - let BrowserLiveView handle connection
          setBrowserArtifactId(existingBrowserArtifact.id)
        }
      }

      validateAndRestore()
    }
  }, [sessionId, artifacts, browserArtifactId, browserSession, removeArtifact])

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

  // Reset research state when a new research starts
  // This allows the second research in the same session to show the HITL modal
  const prevAgentStatusRef = useRef<string | null>(null)
  useEffect(() => {
    // When transitioning to 'researching' from another status, reset the research artifact
    if (agentStatus === 'researching' && prevAgentStatusRef.current !== 'researching') {
      if (researchArtifactId && researchArtifactId !== 'in-progress') {
        // Previous research was completed, reset for new research
        setResearchArtifactId(null)
        researchRef.current.reset()
      }
    }
    prevAgentStatusRef.current = agentStatus
  }, [agentStatus, researchArtifactId])

  // Connect research_progress events to useResearch hook
  useEffect(() => {
    if (researchProgress && researchArtifactId) {
      researchRef.current.handleProgressEvent(researchProgress)
    }
  }, [researchProgress, researchArtifactId])

  // Track processed interrupt IDs to prevent duplicate handling
  const processedInterruptRef = useRef<string | null>(null)

  // Auto-open Canvas when research interrupt is received
  useEffect(() => {
    if (currentInterrupt && currentInterrupt.interrupts.length > 0) {
      const interrupt = currentInterrupt.interrupts[0]

      if (interrupt.name === "chatbot-research-approval" &&
          !researchArtifactId &&
          processedInterruptRef.current !== interrupt.id) {

        // Mark as processed
        processedInterruptRef.current = interrupt.id

        // Set research in progress flag (no temp artifact needed)
        setResearchArtifactId('in-progress')

        // Open canvas and pass interrupt to research hook
        openCanvas()
        researchRef.current.handleInterrupt(interrupt)
      }
    } else {
      // Clear processed ref when no interrupt
      processedInterruptRef.current = null
    }
  }, [currentInterrupt, researchArtifactId, openCanvas])

  // Track which research executions we've already processed
  const processedResearchIdsRef = useRef<Set<string>>(new Set())

  // Extract clean research content using <research> XML tags (same as ResearchModal)
  const extractResearchContent = useCallback((result: string): { title: string; content: string } => {
    if (!result) return { title: 'Research Results', content: '' }

    // Helper function to unescape JSON-escaped strings
    const unescapeJsonString = (str: string): string => {
      if (str.includes('\\n') || str.includes('\\u') || str.includes('\\t')) {
        try {
          const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          return JSON.parse(`"${escaped}"`)
        } catch (e) {
          return str
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        }
      }
      return str
    }

    // Helper to extract title from content
    const extractTitle = (content: string): string => {
      const h1Match = content.match(/^#\s+(.+)$/m)
      if (h1Match) return h1Match[1].trim()
      const h2Match = content.match(/^##\s+(.+)$/m)
      if (h2Match) return h2Match[1].trim()
      return 'Research Results'
    }

    // 1. Check for <research> XML tag (primary method)
    const researchMatch = result.match(/<research>([\s\S]*?)<\/research>/)
    if (researchMatch && researchMatch[1]) {
      const content = unescapeJsonString(researchMatch[1].trim())
      return { title: extractTitle(content), content }
    }

    // 2. Try to parse as JSON (legacy format)
    try {
      const parsed = JSON.parse(result)
      if (parsed.content && typeof parsed.content === 'string') {
        const content = unescapeJsonString(parsed.content)
        return { title: extractTitle(content), content }
      }
      if (parsed.text && typeof parsed.text === 'string') {
        const innerMatch = parsed.text.match(/<research>([\s\S]*?)<\/research>/)
        if (innerMatch && innerMatch[1]) {
          const content = unescapeJsonString(innerMatch[1].trim())
          return { title: extractTitle(content), content }
        }
        const content = unescapeJsonString(parsed.text)
        return { title: extractTitle(content), content }
      }
    } catch (e) {
      // Not JSON, continue with other methods
    }

    // 3. Fallback: Look for first H1 heading (skip progress lines before it)
    const h1Match = result.match(/^#\s+.+$/m)
    if (h1Match && h1Match.index !== undefined) {
      const content = unescapeJsonString(result.substring(h1Match.index))
      return { title: extractTitle(content), content }
    }

    // 4. Last resort: return as is
    return { title: 'Research Results', content: unescapeJsonString(result) }
  }, [])


  // Clean up when research completes - detect via researchData status changes
  useEffect(() => {
    // Only process if we have an active research in progress
    if (!researchArtifactId) return

    // Check if any research execution has completed
    for (const [executionId, data] of researchData) {
      // Skip already processed
      if (processedResearchIdsRef.current.has(executionId)) continue

      if (data.status === 'complete' && data.result) {
        processedResearchIdsRef.current.add(executionId)

        // Extract clean content from research result
        const { title, content } = extractResearchContent(data.result)

        // Call research.handleComplete to update ResearchArtifact UI
        researchRef.current.handleComplete({ title, content })

        // Artifact ID is research-{toolUseId} where toolUseId = executionId
        const targetArtifactId = `research-${executionId}`

        // Add artifact directly to state (backend also saves it)
        // No need to call refreshArtifacts which triggers unnecessary API calls
        addArtifact({
          id: targetArtifactId,
          type: 'research',
          title: title,
          content: content,
          description: '',
          timestamp: new Date().toISOString(),
          sessionId: sessionId || undefined,
        })

        // Update sessionStorage for persistence
        if (sessionId) {
          const artifactsKey = `artifacts-${sessionId}`
          const stored = sessionStorage.getItem(artifactsKey)
          const existingArtifacts = stored ? JSON.parse(stored) : []
          const newArtifact = {
            id: targetArtifactId,
            type: 'research',
            title: title,
            content: content,
            metadata: { description: '' },
            created_at: new Date().toISOString(),
          }
          // Check if artifact already exists
          const existingIndex = existingArtifacts.findIndex((a: any) => a.id === targetArtifactId)
          if (existingIndex >= 0) {
            existingArtifacts[existingIndex] = newArtifact
          } else {
            existingArtifacts.push(newArtifact)
          }
          sessionStorage.setItem(artifactsKey, JSON.stringify(existingArtifacts))
        }

        // Select the artifact and clean up research state (synchronous updates)
        setSelectedArtifactId(targetArtifactId)
        setResearchArtifactId(null)
        researchRef.current.reset()
      } else if (data.status === 'error' || data.status === 'declined') {
        processedResearchIdsRef.current.add(executionId)
        // Only cleanup if this is the active research (not 'in-progress' waiting for new one)
        if (researchArtifactId && researchArtifactId !== 'in-progress') {
          setResearchArtifactId(null)
          researchRef.current.reset()
          closeCanvas()
        }
      }
    }
  }, [researchData, researchArtifactId, closeCanvas, addArtifact, sessionId, extractResearchContent, setSelectedArtifactId])

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

  // Handle tool toggle - disable research if a non-research tool is toggled
  const handleToggleTool = useCallback(async (toolId: string) => {
    // If research is enabled and we're toggling a non-research tool, disable research
    if (isResearchEnabled && toolId !== 'agentcore_research-agent') {
      const researchTool = availableTools.find(tool => tool.id === 'agentcore_research-agent')
      if (researchTool && researchTool.enabled) {
        await toggleTool('agentcore_research-agent')
        setIsResearchEnabled(false)
      }
    }
    await toggleTool(toolId)
  }, [toggleTool, isResearchEnabled, availableTools])

  // Toggle Swarm (using hook from useChat)
  const toggleSwarm = useCallback((enabled?: boolean) => {
    const newValue = enabled !== undefined ? enabled : !swarmEnabled
    toggleSwarmHook(newValue)
  }, [toggleSwarmHook, swarmEnabled])

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

  const handleNewChat = useCallback(async () => {
    forceDisconnectVoice()
    await newChat()
  }, [newChat, forceDisconnectVoice])

  // Wrapper for loadSession that disconnects voice first
  const handleLoadSession = useCallback(async (newSessionId: string) => {
    // Force disconnect voice chat before switching sessions
    forceDisconnectVoice()
    await loadSession(newSessionId)
  }, [loadSession, forceDisconnectVoice])

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

  // Open compose wizard handler (called from ChatInputArea)
  const handleOpenComposeWizard = useCallback((rect: DOMRect) => {
    setInputRect(rect)
    setIsComposeWizardOpen(true)
  }, [])

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

  // Interrupt approval handlers (for browser interrupts - research is handled via useEffect/Canvas)
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
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 bg-background/70 backdrop-blur-md border-b border-border/30 shadow-sm">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
            </div>

            <div className="flex items-center gap-2">
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
        <ScrollArea
          viewportRef={messagesContainerRef}
          onScrollCapture={handleScroll}
          className={`${groupedMessages.length > 0 || isLoadingMessages ? 'flex-1' : ''} relative min-h-0`}
          viewportClassName={`flex flex-col min-w-0 gap-6 ${groupedMessages.length > 0 || isLoadingMessages ? 'pt-4' : ''}`}
        >
          {/* Loading skeleton when switching sessions */}
          {isLoadingMessages && (
            <div className="mx-auto w-full max-w-4xl px-4">
              {/* User message skeleton */}
              <div className="flex justify-end mb-8">
                <Skeleton className="h-12 w-[420px] rounded-2xl rounded-tr-md" />
              </div>
              {/* Assistant message skeleton */}
              <div className="flex justify-start mb-8">
                <div className="flex items-start w-full space-x-4">
                  <Skeleton className="w-9 h-9 rounded-full flex-shrink-0 mt-2" />
                  <div className="flex-1 space-y-3 pt-1">
                    <Skeleton className="h-5 w-[90%]" />
                    <Skeleton className="h-5 w-[85%]" />
                    <Skeleton className="h-5 w-[78%]" />
                    <Skeleton className="h-5 w-[60%]" />
                  </div>
                </div>
              </div>
              {/* Another exchange */}
              <div className="flex justify-end mb-8">
                <Skeleton className="h-12 w-[320px] rounded-2xl rounded-tr-md" />
              </div>
              <div className="flex justify-start mb-8">
                <div className="flex items-start w-full space-x-4">
                  <Skeleton className="w-9 h-9 rounded-full flex-shrink-0 mt-2" />
                  <div className="flex-1 space-y-3 pt-1">
                    <Skeleton className="h-5 w-[88%]" />
                    <Skeleton className="h-5 w-[75%]" />
                    <Skeleton className="h-5 w-[55%]" />
                  </div>
                </div>
              </div>
            </div>
          )}
          {!isLoadingMessages && groupedMessages.map((group, index) => {
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
                        onBrowserClick={handleBrowserClick}
                        onOpenResearchArtifact={handleOpenResearchArtifact}
                        onOpenWordArtifact={handleOpenWordArtifact}
                        onOpenExcelArtifact={handleOpenExcelArtifact}
                        onOpenPptArtifact={handleOpenPptArtifact}
                        onOpenExtractedDataArtifact={handleOpenExtractedDataArtifact}
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
        </ScrollArea>

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

        {/* Greeting - Show when chat not started (not during loading) */}
        {groupedMessages.length === 0 && !isLoadingMessages && (
          <div className="mx-auto px-4 w-full md:max-w-4xl">
            <div className="flex flex-col items-center justify-center mb-16 animate-fade-in">
              <Greeting />
            </div>
          </div>
        )}

        {/* Chat Input Area */}
        <ChatInputArea
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          selectedFiles={selectedFiles}
          setSelectedFiles={setSelectedFiles}
          agentStatus={agentStatus}
          isVoiceActive={isVoiceActive}
          isVoiceSupported={isVoiceSupported}
          swarmEnabled={swarmEnabled}
          isResearchEnabled={isResearchEnabled}
          isCanvasOpen={isCanvasOpen}
          availableTools={availableTools}
          sessionId={sessionId}
          composerState={{
            isComposing: composer.isComposing,
            showOutlineConfirm: composer.showOutlineConfirm,
          }}
          currentModelId={currentModelId}
          onModelChange={updateModelConfig}
          onSendMessage={handleSendMessage}
          onStopGeneration={stopGeneration}
          onToggleTool={handleToggleTool}
          onToggleSwarm={toggleSwarm}
          onToggleResearch={toggleResearchAgent}
          onConnectVoice={connectVoice}
          onDisconnectVoice={disconnectVoice}
          onOpenComposeWizard={handleOpenComposeWizard}
          onExportConversation={exportConversation}
          onNewChat={handleNewChat}
        />
      </SidebarInset>

      {/* Browser Result Modal */}
      {activeBrowserId && browserData.get(activeBrowserId) && (
        <BrowserResultModal
          isOpen={isBrowserModalOpen}
          onClose={closeBrowserModal}
          query={browserData.get(activeBrowserId)!.query}
          isLoading={browserData.get(activeBrowserId)!.status === 'running'}
          result={browserData.get(activeBrowserId)!.result}
          status={browserData.get(activeBrowserId)!.status}
          browserProgress={browserProgress}
        />
      )}

      {/* Interrupt Approval Modal - for email deletion (research handled via Canvas) */}
      {currentInterrupt && currentInterrupt.interrupts.length > 0 &&
       currentInterrupt.interrupts[0].name === "chatbot-email-delete-approval" && (
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
        researchState={researchArtifactId ? {
          isResearching: research.isResearching,
          progress: research.progress,
          plan: research.plan,
          showPlanConfirm: research.showPlanConfirm,
          resultParts: research.resultParts,
          completedResult: research.completedResult,
          onConfirmPlan: handleResearchConfirmPlan,
          onCancel: handleResearchCancel,
          sessionId: sessionId || undefined,
        } : undefined}
        browserState={browserArtifactId && browserSession?.sessionId ? {
          sessionId: browserSession.sessionId,
          browserId: browserSession.browserId || '',
          isActive: true,
          onConnectionError: handleBrowserConnectionError,
          onValidationFailed: handleBrowserValidationFailed,
        } : undefined}
        sessionId={sessionId || undefined}
      />
    </>
  )
}
