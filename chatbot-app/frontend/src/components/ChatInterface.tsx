"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { useChat } from "@/hooks/useChat"
import { useIframeAuth, postAuthStatusToParent } from "@/hooks/useIframeAuth"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { AssistantTurn } from "@/components/chat/AssistantTurn"
import { Greeting } from "@/components/Greeting"
import { ToolSidebar } from "@/components/ToolSidebar"
import { SuggestedQuestions } from "@/components/SuggestedQuestions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { Upload, Send, FileText, ImageIcon } from "lucide-react"

interface ChatInterfaceProps {
  mode: 'standalone' | 'embedded'
}

export function ChatInterface({ mode }: ChatInterfaceProps) {
  const isEmbedded = mode === 'embedded'
  const sidebarContext = useSidebar()
  const { setOpen, setOpenMobile, open } = sidebarContext

  const {
    groupedMessages,
    inputMessage,
    setInputMessage,
    isConnected,
    isTyping,
    availableTools,
    currentReasoning,
    toolProgress,
    sendMessage,
    clearChat,
    toggleTool,
    refreshTools,
    sessionId,
  } = useChat()

  // iframe auth (only for embedded mode)
  const iframeAuth = isEmbedded ? useIframeAuth() : { isInIframe: false, isAuthenticated: false, user: null, isLoading: false, error: null }

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [suggestionKey, setSuggestionKey] = useState<string>("initial")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

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

  const handleClearChat = useCallback(async () => {
    await clearChat()
    regenerateSuggestions()
  }, [clearChat, regenerateSuggestions])

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

  const scrollToBottom = () => {
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
  }

  useEffect(() => {
    // Only auto-scroll in standalone mode, not in embedded mode
    if (!isEmbedded) {
      scrollToBottom()
    }
  }, [groupedMessages, isTyping, isEmbedded])

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
      if (!isTyping && (inputMessage.trim() || selectedFiles.length > 0)) {
        const syntheticEvent = {
          preventDefault: () => {},
        } as React.FormEvent
        handleSendMessage(syntheticEvent, selectedFiles)
        setSelectedFiles([])
      }
    }
  }

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const scrollHeight = textarea.scrollHeight
      const maxHeight = 128 // max-h-32 = 8rem = 128px
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`
    }
  }, [])

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
        onClearChat={handleClearChat}
        refreshTools={refreshTools}
        sessionId={sessionId}
      />

      {/* Main Chat Area */}
      <SidebarInset className={isEmbedded ? "h-screen flex flex-col min-h-0" : ""}>
        {/* Top Controls - Responsive padding */}
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
          </div>
        </div>

        {/* Messages Area */}
        <div className={isEmbedded
          ? "flex flex-col min-w-0 gap-6 flex-1 overflow-y-auto pt-4 relative min-h-0 max-h-full"
          : "flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll pt-4 relative"
        }>
          {groupedMessages.length === 0 && <Greeting />}

          {groupedMessages.map((group) => (
            <div key={group.id} className="mx-auto w-full max-w-3xl px-4">
              {group.type === "user" ? (
                group.messages.map((message) => (
                  <ChatMessage key={message.id} message={message} sessionId={sessionId || undefined} />
                ))
              ) : (
                <AssistantTurn
                  messages={group.messages}
                  currentReasoning={currentReasoning}
                  availableTools={availableTools}
                  sessionId={sessionId || undefined}
                />
              )}
            </div>
          ))}

          {/* Scroll target */}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* Suggested Questions - Show only for embedded mode or when explicitly enabled */}
        {isEmbedded && groupedMessages.length === 0 && availableTools.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-2">
            <SuggestedQuestions
              key={suggestionKey}
              onQuestionSelect={(question) => setInputMessage(question)}
              onQuestionSubmit={async (question) => {
                setInputMessage(question)
                const syntheticEvent = {
                  preventDefault: () => {},
                  target: { elements: { message: { value: question } } },
                } as any
                await handleSendMessage(syntheticEvent, [])
              }}
              enabledTools={availableTools.filter((tool) => tool.enabled).map((tool) => tool.id)}
            />
          </div>
        )}

        {/* File Upload Area - Above Input */}
        {selectedFiles.length > 0 && (
          <div className="mx-auto px-4 w-full md:max-w-3xl mb-2">
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
        <form
          onSubmit={async (e) => {
            await handleSendMessage(e, selectedFiles)
            setSelectedFiles([])
          }}
          className={`mx-auto px-4 bg-background/50 backdrop-blur-sm pb-4 md:pb-6 w-full md:max-w-3xl ${isEmbedded ? 'flex-shrink-0' : ''}`}
        >
          <div className="flex items-center gap-3">
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
              variant="outline"
              size="sm"
              onClick={() => document.getElementById("file-upload")?.click()}
              className="flex items-center justify-center h-10 w-10 border-border hover:bg-muted hover:border-primary/50 transition-all duration-200 gradient-hover"
            >
              <Upload className="w-4 h-4" />
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
              className="flex-1 min-h-[48px] max-h-32 rounded-xl border-border focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none py-3 px-4 text-base leading-6 overflow-y-auto bg-input transition-all duration-200"
              disabled={isTyping}
              rows={1}
              style={{ minHeight: "48px" }}
            />
            <Button
              type="submit"
              disabled={isTyping || (!inputMessage.trim() && selectedFiles.length === 0)}
              className="h-12 px-6 gradient-primary hover:opacity-90 text-primary-foreground rounded-xl shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-50 gradient-hover"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </SidebarInset>
    </>
  )
}
