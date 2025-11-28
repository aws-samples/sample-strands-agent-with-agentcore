"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useChat } from "@/hooks/useChat"
import { useIframeAuth, postAuthStatusToParent } from "@/hooks/useIframeAuth"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { AssistantTurn } from "@/components/chat/AssistantTurn"
import { Greeting } from "@/components/Greeting"
import { ToolSidebar } from "@/components/ToolSidebar"
import { SuggestedQuestions } from "@/components/SuggestedQuestions"
import { BrowserLiveViewButton } from "@/components/BrowserLiveViewButton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { Upload, Send, FileText, ImageIcon, Square, Bot, Brain, Maximize2, Minimize2, Moon, Sun } from "lucide-react"
import { ModelConfigDialog } from "@/components/ModelConfigDialog"
import { apiGet } from "@/lib/api-client"
import { useTheme } from "next-themes"

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

  const {
    groupedMessages,
    inputMessage,
    setInputMessage,
    isConnected,
    isTyping,
    agentStatus,
    availableTools,
    currentReasoning,
    toolProgress,
    sendMessage,
    stopGeneration,
    newChat,
    toggleTool,
    refreshTools,
    sessionId,
    loadSession,
    onGatewayToolsChange,
    browserSession,
  } = useChat()

  // Stable sessionId reference to prevent unnecessary re-renders
  const stableSessionId = useMemo(() => sessionId || undefined, [sessionId])

  // iframe auth (only for embedded mode)
  const iframeAuth = isEmbedded ? useIframeAuth() : { isInIframe: false, isAuthenticated: false, user: null, isLoading: false, error: null }

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [suggestionKey, setSuggestionKey] = useState<string>("initial")
  const [isWideMode, setIsWideMode] = useState<boolean>(false)
  const [currentModelName, setCurrentModelName] = useState<string>("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  // Load wide mode preference from localStorage
  useEffect(() => {
    const savedWideMode = localStorage.getItem('chatWideMode')
    if (savedWideMode !== null) {
      setIsWideMode(savedWideMode === 'true')
    }
  }, [])

  // Save wide mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('chatWideMode', isWideMode.toString())
  }, [isWideMode])

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
    await newChat()
    regenerateSuggestions()
  }, [newChat, regenerateSuggestions])

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

  const scrollToBottomImmediate = useCallback(() => {
    if (!messagesEndRef.current) return

    if (isEmbedded) {
      // In embedded mode, scroll within the container without affecting parent
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest"
      })
    } else {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [isEmbedded])

  const scrollToBottom = useThrottle(scrollToBottomImmediate, 200)

  useEffect(() => {
    // Only auto-scroll in standalone mode, not in embedded mode
    if (!isEmbedded) {
      scrollToBottom()
    }
  }, [groupedMessages, isTyping, isEmbedded, scrollToBottom])

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
      if (agentStatus === 'idle' && (inputMessage.trim() || selectedFiles.length > 0)) {
        const syntheticEvent = {
          preventDefault: () => {},
        } as React.FormEvent
        handleSendMessage(syntheticEvent, selectedFiles)
        setSelectedFiles([])
      }
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
      {/* Tool Sidebar */}
      <ToolSidebar
        availableTools={availableTools}
        onToggleTool={handleToggleTool}
        onNewChat={handleNewChat}
        refreshTools={refreshTools}
        sessionId={sessionId}
        loadSession={loadSession}
        onGatewayToolsChange={onGatewayToolsChange}
      />

      {/* Main Chat Area */}
      <SidebarInset className={`${isEmbedded ? "h-screen" : ""} flex flex-col ${groupedMessages.length === 0 ? 'justify-center items-center' : ''} transition-all duration-700 ease-in-out`}>
        {/* Top Controls - Only show when chat started */}
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
              {isEmbedded && availableTools.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {availableTools.filter(tool => tool.enabled).length}/{availableTools.length} tools
                </div>
              )}

              {/* Browser Live View Button */}
              <BrowserLiveViewButton sessionId={sessionId} browserSession={browserSession} />
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className={`${isEmbedded
          ? `flex flex-col min-w-0 gap-6 ${groupedMessages.length > 0 ? 'flex-1' : ''} overflow-y-auto relative min-h-0 max-h-full`
          : `flex flex-col min-w-0 gap-6 ${groupedMessages.length > 0 ? 'flex-1' : ''} overflow-y-scroll relative`
        } ${groupedMessages.length > 0 ? 'pt-4' : ''}`}>
          {groupedMessages.map((group) => (
            <div key={group.id} className={`mx-auto w-full ${isWideMode ? 'max-w-6xl' : 'max-w-3xl'} px-4 min-w-0`}>
              {group.type === "user" ? (
                group.messages.map((message) => (
                  <ChatMessage key={message.id} message={message} sessionId={stableSessionId} />
                ))
              ) : (
                <AssistantTurn
                  messages={group.messages}
                  currentReasoning={currentReasoning}
                  availableTools={availableTools}
                  sessionId={stableSessionId}
                />
              )}
            </div>
          ))}

          {/* Thinking Animation - Show only when agent is thinking */}
          {agentStatus === 'thinking' && (
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

        {/* Suggested Questions - Show only for embedded mode or when explicitly enabled */}
        {isEmbedded && groupedMessages.length === 0 && availableTools.length > 0 && (
          <div className={`mx-auto w-full ${isWideMode ? 'max-w-6xl' : 'max-w-3xl'} px-4 pb-2`}>
            <SuggestedQuestions
              key={suggestionKey}
              onQuestionSelect={(question) => setInputMessage(question)}
              onQuestionSubmit={handleQuestionSubmit}
              enabledTools={availableTools.filter((tool) => tool.enabled).map((tool) => tool.id)}
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
              await handleSendMessage(e, selectedFiles)
              setSelectedFiles([])
            }}
          >
            <div className="flex items-center gap-3 bg-muted/30 rounded-2xl p-2 shadow-sm">
              <Input
                type="file"
                accept="image/*,application/pdf,.pdf"
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
                className="flex items-center justify-center h-10 w-10 hover:bg-muted-foreground/10 transition-all duration-200"
              >
                <Upload className="w-5 h-5" />
              </Button>
              <Textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false
                }}
                placeholder="Ask me anything..."
                className="flex-1 min-h-[48px] max-h-32 rounded-lg border-0 focus:ring-0 resize-none py-3 px-4 text-base leading-6 overflow-y-auto bg-transparent transition-all duration-200"
                disabled={agentStatus !== 'idle'}
                rows={1}
                style={{ minHeight: "48px" }}
              />
              {agentStatus !== 'idle' ? (
                <Button
                  type="button"
                  onClick={stopGeneration}
                  variant="ghost"
                  className="h-10 w-10 hover:bg-muted-foreground/10 transition-all duration-200"
                >
                  <Square className="w-5 h-5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!inputMessage.trim() && selectedFiles.length === 0}
                  className="h-10 w-10 gradient-primary hover:opacity-90 text-primary-foreground rounded-lg transition-all duration-200 disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </Button>
              )}
            </div>
          </form>

          {/* Model selector, keyboard shortcut hint and wide mode toggle */}
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground/70">
            {/* Left: Model Selector */}
            <div className="flex items-center">
              <ModelConfigDialog
                sessionId={sessionId}
                onOpenChange={(open) => {
                  if (!open) {
                    // Reload model info when dialog closes
                    loadCurrentModel()
                  }
                }}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-3 hover:bg-muted-foreground/10 transition-all duration-200 text-xs font-medium"
                    title="Change model settings"
                  >
                    {currentModelName || 'Model'}
                  </Button>
                }
              />
            </div>

            {/* Center: Keyboard shortcut hint */}
            <div className="flex-1 text-center">
              <kbd className="px-2 py-1 text-sm bg-muted rounded border border-border/50">⌘ B</kbd>
              {' or '}
              <kbd className="px-2 py-1 text-sm bg-muted rounded border border-border/50">Ctrl B</kbd>
              {' '}to open sidebar settings
            </div>

            {/* Right: Theme toggle and Wide mode toggle */}
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="h-7 px-2 hover:bg-muted-foreground/10 transition-all duration-200 relative"
                title="Toggle theme"
              >
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsWideMode(!isWideMode)}
                className="h-7 px-2 hover:bg-muted-foreground/10 transition-all duration-200"
                title={isWideMode ? "Switch to normal width" : "Switch to wide mode"}
              >
                {isWideMode ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </SidebarInset>
    </>
  )
}
