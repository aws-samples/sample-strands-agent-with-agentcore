"use client"

import React from "react"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useChat } from "@/hooks/useChat"
import { useIframeAuth, postAuthStatusToParent } from "@/hooks/useIframeAuth"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Upload, Send, FileText, ImageIcon, Square, Bot, Brain, Maximize2, Minimize2, Moon, Sun, FlaskConical, Loader2, ArrowDown, Download, Mic } from "lucide-react"
import { ModelConfigDialog } from "@/components/ModelConfigDialog"
import { apiGet } from "@/lib/api-client"
import { useTheme } from "next-themes"
import { useVoiceChat } from "@/hooks/useVoiceChat"

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

  // Scroll control state
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const isAutoScrollingRef = useRef(false)

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
  } = useChat()

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
  const [isWideMode, setIsWideMode] = useState<boolean>(false)
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

  // Voice chat hook - delegates state management to useChat via callbacks
  const {
    isSupported: isVoiceSupported,
    currentToolExecution: voiceToolExecution,
    pendingTranscript,
    error: voiceError,
    connect: connectVoice,
    disconnect: disconnectVoice,
  } = useVoiceChat({
    sessionId,
    enabledTools: enabledToolIds,
    onStatusChange: setVoiceStatus,  // Unified state management
    onTranscript: (entry) => {
      // Stream all transcripts to chat (both intermediate and final)
      if (entry.text.trim()) {
        updateVoiceMessage(entry.role, entry.text, entry.isFinal)
      }
    },
    onToolExecution: (execution) => {
      console.log('[ChatInterface] onToolExecution called:', execution)
      // Add tool execution as separate tool message (mirrors text mode pattern)
      const toolExec = {
        id: execution.toolUseId,
        toolName: execution.toolName,
        toolInput: execution.input,
        toolResult: execution.result,
        isComplete: execution.status !== 'running',
        isCancelled: execution.status === 'error',
        reasoning: [],  // Voice mode doesn't have reasoning
        isExpanded: true,  // Default to expanded (like text mode)
      }
      console.log('[ChatInterface] Created toolExec for addVoiceToolExecution:', toolExec)
      addVoiceToolExecution(toolExec)
    },
    onResponseComplete: () => {
      // Called when assistant finishes speaking (bidi_response_complete)
      // Finalize the current streaming assistant message
      finalizeVoiceMessage()
    },
    onError: (error) => {
      console.error('[Voice] Error:', error)
    },
    onSessionCreated: refreshSessionList,  // Refresh session list when voice creates new session
  })

  // Helper to check if voice mode is active (derived from unified agentStatus)
  const isVoiceActive = agentStatus.startsWith('voice_')

  // Load wide mode preference from localStorage
  useEffect(() => {
    const savedWideMode = localStorage.getItem('chatWideMode')
    if (savedWideMode !== null) {
      setIsWideMode(savedWideMode === 'true')
    }
  }, [])

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
  const toggleSwarm = useCallback(() => {
    toggleSwarmHook(!swarmEnabled)
  }, [toggleSwarmHook, swarmEnabled])

  // Monitor messages for research_agent and browser_use_agent tool executions separately
  useEffect(() => {
    const newResearchData = new Map(researchData)
    const newBrowserData = new Map(browserData)

    // Process ALL research/browser executions across all messages
    for (const group of groupedMessages) {
      if (group.type === 'assistant_turn') {
        for (const message of group.messages) {
          if (message.toolExecutions && message.toolExecutions.length > 0) {
            // Separate research_agent and browser_use_agent
            const researchExecutions = message.toolExecutions.filter(te => te.toolName === 'research_agent')
            const browserExecutions = message.toolExecutions.filter(te => te.toolName === 'browser_use_agent')

            // Process research_agent executions
            for (const researchExecution of researchExecutions) {
              const executionId = researchExecution.id
              const query = researchExecution.toolInput?.plan || "Research Task"

              if (!researchExecution.isComplete) {
                // Still running
                newResearchData.set(executionId, {
                  query: query,
                  result: researchExecution.streamingResponse || '',
                  status: researchExecution.streamingResponse ? 'generating' : 'searching',
                  agentName: 'Research Agent'
                })
              } else if (researchExecution.toolResult) {
                // Completed with result
                const resultText = researchExecution.toolResult.toLowerCase()
                const isError = researchExecution.isCancelled || resultText.includes('error:') || resultText.includes('failed:')
                // Match exact declined message from ResearchApprovalHook
                const isDeclined = resultText === 'user declined to proceed with research' ||
                                  resultText === 'user declined to proceed with browser automation'

                let status: 'complete' | 'error' | 'declined' = 'complete'
                if (isError) {
                  status = 'error'
                } else if (isDeclined) {
                  status = 'declined'
                }

                newResearchData.set(executionId, {
                  query: query,
                  result: researchExecution.toolResult,
                  status: status,
                  agentName: 'Research Agent'
                })
              }
            }

            // Process browser_use_agent executions
            for (const browserExecution of browserExecutions) {
              const executionId = browserExecution.id
              const query = browserExecution.toolInput?.task || "Browser Task"

              if (!browserExecution.isComplete) {
                // Still running
                newBrowserData.set(executionId, {
                  query: query,
                  result: browserExecution.streamingResponse || '',
                  status: 'running',
                  agentName: 'Browser Use Agent'
                })
              } else if (browserExecution.toolResult) {
                // Completed with result
                const resultText = browserExecution.toolResult.toLowerCase()
                const isError = browserExecution.isCancelled || resultText.includes('error:') || resultText.includes('failed:') || resultText.includes('browser automation failed')

                const status: 'complete' | 'error' = isError ? 'error' : 'complete'

                newBrowserData.set(executionId, {
                  query: query,
                  result: browserExecution.toolResult,
                  status: status,
                  agentName: 'Browser Use Agent'
                })
              }
            }
          }
        }
      }
    }

    // Update research data only if changed
    if (newResearchData.size !== researchData.size ||
        Array.from(newResearchData.entries()).some(([id, data]) => {
          const existing = researchData.get(id)
          return !existing || existing.result !== data.result || existing.status !== data.status
        })) {
      setResearchData(newResearchData)
    }

    // Update browser data only if changed
    if (newBrowserData.size !== browserData.size ||
        Array.from(newBrowserData.entries()).some(([id, data]) => {
          const existing = browserData.get(id)
          return !existing || existing.result !== data.result || existing.status !== data.status
        })) {
      setBrowserData(newBrowserData)
    }
  }, [groupedMessages])

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

  // Save wide mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('chatWideMode', isWideMode.toString())
  }, [isWideMode])

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
    if (isVoiceActive) {
      disconnectVoice()
    }
    await newChat()
    regenerateSuggestions()
  }, [newChat, regenerateSuggestions, isVoiceActive, disconnectVoice])

  // Wrapper for loadSession that disconnects voice first
  const handleLoadSession = useCallback(async (newSessionId: string) => {
    // Force disconnect voice chat before switching sessions
    if (isVoiceActive) {
      disconnectVoice()
    }
    await loadSession(newSessionId)
  }, [loadSession, isVoiceActive, disconnectVoice])

  const handleToggleTool = useCallback(
    async (toolId: string) => {
      await toggleTool(toolId)
      regenerateSuggestions()
    },
    [toggleTool, regenerateSuggestions],
  )

  const handleSendMessage = async (e: React.FormEvent, files: File[]) => {
    if (open) {
      setOpen(false)
    }
    setOpenMobile(false)
    await sendMessage(e, files)
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

  // Auto-scroll on new messages (both modes now use container scroll)
  useEffect(() => {
    scrollToBottom()
  }, [groupedMessages, isTyping, scrollToBottom])

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
    if (e.key === "Enter" && !e.shiftKey) {
      // Don't submit if user is composing Korean/Chinese/Japanese
      if (isComposingRef.current) {
        return
      }

      e.preventDefault()
      // Don't submit if voice mode is active (uses unified agentStatus)
      if (agentStatus === 'idle' && (inputMessage.trim() || selectedFiles.length > 0)) {
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
      />

      {/* Main Chat Area - unified layout for both modes */}
      <SidebarInset className={`h-screen flex flex-col overflow-hidden ${groupedMessages.length === 0 ? 'justify-center items-center' : ''} transition-all duration-700 ease-in-out relative`}>
        {/* Sidebar trigger - Always visible in top-left */}
        {groupedMessages.length === 0 && (
          <div className={`absolute top-4 left-4 z-20`}>
            <SidebarTrigger />
          </div>
        )}

        {/* Top Controls - Show when chat started */}
        {groupedMessages.length > 0 && (
          <div className={`sticky top-0 z-10 flex items-center justify-between ${isEmbedded ? 'p-2' : 'p-4'} bg-background/70 backdrop-blur-md border-b border-border/30 shadow-sm`}>
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              {isConnected ? (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium text-muted-foreground">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-destructive rounded-full"></div>
                  <span className="text-xs font-medium text-muted-foreground">Disconnected</span>
                </div>
              )}

              {/* Show iframe status if in embedded mode */}
              {isEmbedded && iframeAuth.isInIframe && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-xs font-medium text-muted-foreground">Embedded</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Tool count indicator (embedded mode only) */}
              {isEmbedded && totalCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {enabledCount}/{totalCount} tools
                </div>
              )}

              {/* Browser Live View Button */}
              <BrowserLiveViewButton sessionId={sessionId} browserSession={browserSession} />
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
                <div className={`mx-auto w-full ${isWideMode ? 'max-w-6xl' : 'max-w-3xl'} px-4 min-w-0`}>
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
                            <Avatar className="h-9 w-9 flex-shrink-0 mt-1">
                              <AvatarFallback className="text-white bg-gradient-to-br from-purple-500 to-indigo-600">
                                <Bot className="h-4 w-4" />
                              </AvatarFallback>
                            </Avatar>
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
            <div className={`mx-auto w-full ${isWideMode ? 'max-w-6xl' : 'max-w-3xl'} px-4 min-w-0`}>
              <SwarmProgress progress={swarmProgress} sessionId={stableSessionId} />
            </div>
          )}

          {/* Thinking Animation - Show only when agent is thinking (not in swarm mode) */}
          {agentStatus === 'thinking' && !swarmProgress?.isActive && (
            <div className={`mx-auto w-full ${isWideMode ? 'max-w-6xl' : 'max-w-3xl'} px-4 min-w-0 animate-fade-in`}>
              <div className="flex gap-4 items-start">
                <div className="flex items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 h-10 w-10 flex-shrink-0 shadow-md">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 pt-2">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
                    <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
                    <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
                  </div>
                </div>
              </div>
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
              <span className="text-sm">Scroll to bottom</span>
            </Button>
          </div>
        )}

        {/* Suggested Questions - Show only for embedded mode or when explicitly enabled */}
        {isEmbedded && groupedMessages.length === 0 && availableTools.length > 0 && (
          <div className={`mx-auto w-full ${isWideMode ? 'max-w-6xl' : 'max-w-3xl'} px-4 pb-2`}>
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
          <div className={`mx-auto px-4 w-full ${isWideMode ? 'md:max-w-6xl' : 'md:max-w-3xl'} mb-2`}>
            <div className="flex flex-wrap gap-2">
              {selectedFiles.map((file, index) => (
                <Badge key={index} variant="secondary" className="flex items-center gap-1 max-w-[200px]">
                  {getFileIcon(file)}
                  <span className="truncate text-xs">
                    {file.name.length > 20 ? `${file.name.substring(0, 20)}...` : file.name}
                  </span>
                  <button
                    onClick={() => removeFile(index)}
                    className="ml-1 text-slate-500 hover:text-slate-700 text-sm"
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
        <div className={`mx-auto px-4 pb-4 md:pb-6 w-full ${isWideMode ? 'md:max-w-6xl' : 'md:max-w-3xl'} ${isEmbedded ? 'flex-shrink-0' : ''}`}>
          {/* Show title when chat not started */}
          {groupedMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center mb-16 animate-fade-in">
              <Greeting />
            </div>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault()
              // Don't submit if voice mode is active (uses unified agentStatus)
              if (isVoiceActive) return
              await handleSendMessage(e, selectedFiles)
              setSelectedFiles([])
            }}
          >
            <div className="flex items-center gap-3 bg-muted/30 rounded-2xl p-2 shadow-sm">
              <Input
                type="file"
                accept="image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => document.getElementById("file-upload")?.click()}
                disabled={isVoiceActive}
                className="flex items-center justify-center h-10 w-10 hover:bg-muted-foreground/10 transition-all duration-200 disabled:opacity-50"
              >
                <Upload className="w-5 h-5" />
              </Button>
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
                  isVoiceActive
                    ? "Voice mode active - click mic to stop"
                    : isResearchEnabled
                    ? "Ask me anything... (Research Agent active)"
                    : swarmEnabled
                    ? "Ask me anything... (Auto mode)"
                    : "Ask me anything..."
                }
                className="flex-1 min-h-[48px] max-h-32 rounded-lg border-0 focus:ring-0 resize-none py-3 px-4 text-base leading-6 overflow-y-auto bg-transparent transition-all duration-200"
                disabled={agentStatus !== 'idle'}
                rows={1}
                style={{ minHeight: "48px" }}
              />
              {/* Voice Mode Button - Show mic button next to send (hidden in Swarm mode) */}
              {isVoiceSupported && !swarmEnabled && (agentStatus === 'idle' || isVoiceActive) && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={async () => {
                          if (!isVoiceActive) {
                            await connectVoice()
                          } else {
                            disconnectVoice()
                          }
                        }}
                        className={`h-10 w-10 transition-all duration-200 ${
                          agentStatus === 'voice_listening'
                            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                            : agentStatus === 'voice_speaking'
                            ? 'bg-green-500 hover:bg-green-600 text-white'
                            : agentStatus === 'voice_connecting' || agentStatus === 'voice_processing'
                            ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                            : 'hover:bg-muted-foreground/10'
                        }`}
                      >
                        {agentStatus === 'voice_connecting' ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Mic className="w-5 h-5" />
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
                        ? 'Assistant speaking... (click to stop)'
                        : 'Voice active (click to stop)'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {agentStatus !== 'idle' && !isVoiceActive ? (
                <Button
                  type="button"
                  onClick={stopGeneration}
                  variant="ghost"
                  className="h-10 w-10 hover:bg-muted-foreground/10 transition-all duration-200"
                  title={agentStatus === 'stopping' ? "Stopping..." : "Stop generation"}
                  disabled={agentStatus === 'researching' || agentStatus === 'browser_automation' || agentStatus === 'stopping'}
                >
                  {agentStatus === 'stopping' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </Button>
              ) : !isVoiceActive ? (
                <Button
                  type="submit"
                  disabled={agentStatus !== 'idle' || (!inputMessage.trim() && selectedFiles.length === 0)}
                  className="h-10 w-10 gradient-primary hover:opacity-90 text-primary-foreground rounded-lg transition-all duration-200 disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </Button>
              ) : null}
            </div>
          </form>

          {/* Model selector, keyboard shortcut hint and wide mode toggle */}
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground/70">
            {/* Left: Model Selector, Tools, and Research Agent */}
            <TooltipProvider delayDuration={300}>
              <div className="flex items-center gap-0.5">
                <ModelConfigDialog sessionId={sessionId} agentStatus={agentStatus} />
                <ToolsDropdown
                  availableTools={availableTools}
                  onToggleTool={toggleTool}
                  disabled={isResearchEnabled || swarmEnabled || isVoiceActive}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleSwarm}
                      disabled={isResearchEnabled || isVoiceActive}
                      className={`h-7 px-2 transition-all duration-200 text-xs font-medium flex items-center gap-1 ${
                        swarmEnabled
                          ? 'bg-purple-500/20 text-purple-500 hover:bg-purple-500/30'
                          : isResearchEnabled || isVoiceActive
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-muted-foreground/10'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5" />
                      Auto
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{swarmEnabled ? 'Auto mode active' : 'AI agents collaborate automatically'}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleResearchAgent}
                      disabled={isVoiceActive}
                      className={`h-7 px-2 transition-all duration-200 text-xs font-medium flex items-center gap-1 ${
                        isResearchEnabled
                          ? 'bg-blue-500/20 text-blue-500 hover:bg-blue-500/30'
                          : isVoiceActive
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-muted-foreground/10'
                      }`}
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      Research
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isResearchEnabled ? 'Research mode active' : 'Conducts web research, cites sources, generates visualizations'}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>

            {/* Spacer */}
            <div className="flex-1"></div>

            {/* Right: Export, Theme toggle and Wide mode toggle */}
            <TooltipProvider delayDuration={300}>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={exportConversation}
                      disabled={groupedMessages.length === 0}
                      className="h-7 px-2 hover:bg-muted-foreground/10 transition-all duration-200 disabled:opacity-40"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Export conversation</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      className="h-7 px-2 hover:bg-muted-foreground/10 transition-all duration-200 relative"
                    >
                      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsWideMode(!isWideMode)}
                      className="h-7 px-2 hover:bg-muted-foreground/10 transition-all duration-200"
                    >
                      {isWideMode ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isWideMode ? 'Normal width' : 'Wide mode'}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
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


    </>
  )
}
