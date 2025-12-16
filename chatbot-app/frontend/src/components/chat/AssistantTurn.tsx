import React, { useState, useMemo } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bot, Clock, Zap, Coins, Copy, ThumbsUp, ThumbsDown, Check } from 'lucide-react'
import { Message } from '@/types/chat'
import { ReasoningState } from '@/types/events'
import { Markdown } from '@/components/ui/Markdown'
import { ToolExecutionContainer } from './ToolExecutionContainer'
import { ResearchContainer } from '@/components/ResearchContainer'
import { LazyImage } from '@/components/ui/LazyImage'
import { fetchAuthSession } from 'aws-amplify/auth'

interface AssistantTurnProps {
  messages: Message[]
  currentReasoning?: ReasoningState | null
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
  sessionId?: string
  onResearchClick?: (executionId: string) => void
  onBrowserClick?: (executionId: string) => void
}

export const AssistantTurn = React.memo<AssistantTurnProps>(({ messages, currentReasoning, availableTools = [], sessionId, onResearchClick, onBrowserClick }) => {
  // Get initial feedback state from first message
  const initialFeedback = messages[0]?.feedback || null

  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(initialFeedback)

  if (!messages || messages.length === 0) {
    return null
  }

  // Get turn ID from first message for feedback storage
  const turnId = messages[0]?.id

  // Handle copy to clipboard
  const handleCopy = async () => {
    try {
      // Collect all text content from messages
      const allText = messages
        .filter(msg => msg.text)
        .map(msg => msg.text)
        .join('\n\n')

      await navigator.clipboard.writeText(allText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Handle feedback (thumbs up/down)
  const handleFeedback = async (type: 'up' | 'down') => {
    const newFeedback = feedback === type ? null : type
    setFeedback(newFeedback)

    // Save feedback to metadata
    if (sessionId && turnId) {
      try {
        // Get auth token
        const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        try {
          const session = await fetchAuthSession()
          const token = session.tokens?.idToken?.toString()
          if (token) {
            authHeaders['Authorization'] = `Bearer ${token}`
          }
        } catch (error) {
          console.log('[AssistantTurn] No auth session available')
        }

        await fetch('/api/session/update-metadata', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            sessionId,
            messageId: turnId,
            metadata: {
              feedback: newFeedback
            }
          })
        })
      } catch (err) {
        console.error('Failed to save feedback:', err)
      }
    }
  }

  // Sort messages by timestamp to maintain chronological order
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      // Extract timestamp for comparison - use id as fallback since it's based on Date.now()
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : (typeof a.id === 'number' ? a.id : 0)
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : (typeof b.id === 'number' ? b.id : 0)
      return timeA - timeB
    })
  }, [messages])

  // Group consecutive text messages together while preserving tool message positions
  const groupedContent = useMemo(() => {
    const grouped: Array<{
      type: 'text' | 'tool'
      content: string | Message
      images?: any[]
      key: string
      toolUseId?: string
    }> = []

    let currentTextGroup = ''
    let currentTextImages: any[] = []
    let textGroupStartId: string | number = 0
    let currentToolUseId: string | undefined = undefined
    let textGroupCounter = 0 // Counter for unique keys

    const flushTextGroup = () => {
      if (currentTextGroup.trim()) {
        grouped.push({
          type: 'text',
          content: currentTextGroup,
          images: currentTextImages,
          key: `text-group-${textGroupCounter}-${textGroupStartId}`, // Use counter + id for uniqueness
          toolUseId: currentToolUseId
        })
        currentTextGroup = ''
        currentTextImages = []
        currentToolUseId = undefined
        textGroupCounter++ // Increment counter
      }
    }

    sortedMessages.forEach((message) => {
      // Check if message has tool executions
      const hasToolExecutions = message.toolExecutions && message.toolExecutions.length > 0

      if (hasToolExecutions) {
        // Message has tool executions - render text first, then tools

        // Add text if present
        if (message.text) {
          if (!currentTextGroup) {
            textGroupStartId = typeof message.id === 'number' ? message.id : 0
          }
          currentTextGroup += message.text
          if (message.images && message.images.length > 0) {
            currentTextImages.push(...message.images)
          }
        }

        // Flush text group before tool container
        flushTextGroup()

        // Add tool execution container
        grouped.push({
          type: 'tool',
          content: message,
          key: `tool-${message.id}`
        })
      } else if (message.text) {
        // Text-only message - accumulate
        if (!currentTextGroup) {
          textGroupStartId = typeof message.id === 'number' ? message.id : 0
        }
        currentTextGroup += message.text
        if (message.images && message.images.length > 0) {
          currentTextImages.push(...message.images)
        }
        // Track toolUseId for this text message
        if (message.toolUseId && !currentToolUseId) {
          currentToolUseId = message.toolUseId
        }
      }
    })

    // Flush any remaining text
    flushTextGroup()

    return grouped
  }, [sortedMessages])

  // Find latency metrics and token usage from the messages
  const latencyMetrics = sortedMessages.find(msg => msg.latencyMetrics)?.latencyMetrics
  const tokenUsage = sortedMessages.find(msg => msg.tokenUsage)?.tokenUsage

  return (
    <div className="flex justify-start mb-8 group">
      <div className="flex items-start space-x-4 max-w-4xl w-full min-w-0">
        {/* Single Avatar for the entire turn */}
        <Avatar className="h-9 w-9 flex-shrink-0 mt-2">
          <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>

        {/* Turn Content */}
        <div className="flex-1 space-y-4 pt-1 min-w-0">
          {/* Render messages in chronological order */}
          {groupedContent.map((item) => {
            if (item.type === 'tool') {
              const message = item.content as Message
              const toolExecutions = message.toolExecutions || []

              // Separate research_agent, browser_use_agent, and other tool executions
              const researchExecution = toolExecutions.find(te => te.toolName === 'research_agent')
              const browserExecution = toolExecutions.find(te => te.toolName === 'browser_use_agent')
              const otherExecutions = toolExecutions.filter(te => te.toolName !== 'research_agent' && te.toolName !== 'browser_use_agent')

              return (
                <div key={item.key} className="animate-fade-in space-y-4">
                  {/* Research Agent Container */}
                  {researchExecution && (
                    <ResearchContainer
                      query={researchExecution.toolInput?.plan || 'Research Task'}
                      agentName='Research Agent'
                      status={
                        researchExecution.isComplete
                          ? (() => {
                              // Check both isCancelled flag and tool result text for decline detection
                              if (researchExecution.isCancelled) return 'declined'
                              const resultText = (researchExecution.toolResult || '').toLowerCase()
                              if (resultText.includes('declined') || resultText.includes('cancelled') || resultText.includes('cancel')) {
                                return 'declined'
                              }
                              return 'complete'
                            })()
                          : researchExecution.streamingResponse
                          ? 'generating'
                          : 'searching'
                      }
                      isLoading={!researchExecution.isComplete}
                      hasResult={(() => {
                        if (!researchExecution.toolResult) return false
                        if (researchExecution.isCancelled) return false
                        const resultText = (researchExecution.toolResult || '').toLowerCase()
                        return !(resultText.includes('declined') || resultText.includes('cancelled') || resultText.includes('cancel'))
                      })()}
                      onClick={() => {
                        if (!onResearchClick || !researchExecution.toolResult) return

                        // Check both isCancelled flag and tool result text
                        if (researchExecution.isCancelled) return
                        const resultText = (researchExecution.toolResult || '').toLowerCase()
                        if (resultText.includes('declined') || resultText.includes('cancelled') || resultText.includes('cancel')) return

                        onResearchClick(researchExecution.id)
                      }}
                    />
                  )}

                  {/* Browser Use Agent Container */}
                  {browserExecution && (
                    <ResearchContainer
                      query={browserExecution.toolInput?.task || 'Browser Task'}
                      agentName='Browser Use Agent'
                      status={
                        browserExecution.isComplete
                          ? (() => {
                              // Check for declined first (matching Research Agent pattern)
                              if (browserExecution.isCancelled) return 'declined'
                              const resultText = (browserExecution.toolResult || '').toLowerCase()
                              if (resultText.includes('declined') || resultText.includes('cancelled') || resultText.includes('cancel')) {
                                return 'declined'
                              }
                              // Then check for errors
                              if (resultText.includes('error:') || resultText.includes('failed:') || resultText.includes('browser automation failed')) {
                                return 'error'
                              }
                              return 'complete'
                            })()
                          : browserExecution.streamingResponse
                          ? 'generating'
                          : 'searching'
                      }
                      isLoading={!browserExecution.isComplete}
                      hasResult={(() => {
                        // No result if task was declined/cancelled
                        if (browserExecution.isCancelled) return false
                        if (browserExecution.toolResult) {
                          const resultText = browserExecution.toolResult.toLowerCase()
                          if (resultText.includes('declined') || resultText.includes('cancelled') || resultText.includes('cancel')) {
                            return false
                          }
                        }

                        // Running: enable real-time viewing
                        if (!browserExecution.isComplete) {
                          return true
                        }

                        // Completed: has result if no errors
                        if (browserExecution.isComplete && browserExecution.toolResult) {
                          const resultText = browserExecution.toolResult.toLowerCase()
                          return !(resultText.includes('browser automation failed'))
                        }

                        return false
                      })()}
                      onClick={() => {
                        if (!onBrowserClick) return

                        // Block if declined/cancelled
                        if (browserExecution.isCancelled) return
                        if (browserExecution.toolResult) {
                          const resultText = browserExecution.toolResult.toLowerCase()
                          if (resultText.includes('declined') || resultText.includes('cancelled') || resultText.includes('cancel')) return
                        }

                        // Block if failed
                        if (browserExecution.isComplete && browserExecution.toolResult) {
                          const resultText = browserExecution.toolResult.toLowerCase()
                          if (resultText.includes('browser automation failed')) return
                        }

                        onBrowserClick(browserExecution.id)
                      }}
                    />
                  )}

                  {/* Other Tool Executions */}
                  {otherExecutions.length > 0 && (
                    <ToolExecutionContainer
                      toolExecutions={otherExecutions}
                      availableTools={availableTools}
                      sessionId={sessionId}
                    />
                  )}
                </div>
              )
            }

            return (
              <div key={item.key} className="animate-fade-in">
                <div className="chat-chart-content w-full overflow-hidden">
                  <Markdown sessionId={sessionId} toolUseId={item.toolUseId}>{item.content as string}</Markdown>

                  {/* Generated Images for this text group */}
                  {item.images && item.images.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {item.images.map((image, idx) => (
                        <div key={idx} className="relative group">
                          <LazyImage
                            src={`data:image/${image.format};base64,${image.data}`}
                            alt={`Generated image ${idx + 1}`}
                            className="max-w-full h-auto rounded-xl border border-slate-200 shadow-sm"
                            style={{ maxHeight: '400px' }}
                          />
                          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Badge variant="secondary" className="text-xs bg-black/70 text-white border-0">
                              {image.format.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Metrics Badges - Shows on hover at bottom right */}
          {((latencyMetrics && (latencyMetrics.timeToFirstToken || latencyMetrics.endToEndLatency)) || tokenUsage) && (
            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 -mt-2">
              {/* Latency Metrics */}
              {latencyMetrics?.timeToFirstToken && (
                <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-200 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  TTFT: {latencyMetrics.timeToFirstToken}ms
                </Badge>
              )}
              {latencyMetrics?.endToEndLatency && (
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  E2E: {latencyMetrics.endToEndLatency}ms
                </Badge>
              )}

              {/* Token Usage Metrics */}
              {tokenUsage && (
                <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-purple-200 flex items-center gap-1">
                  <Coins className="h-3 w-3" />
                  Token: {tokenUsage.inputTokens.toLocaleString()} in / {tokenUsage.outputTokens.toLocaleString()} out
                  {((tokenUsage.cacheReadInputTokens && tokenUsage.cacheReadInputTokens > 0) ||
                    (tokenUsage.cacheWriteInputTokens && tokenUsage.cacheWriteInputTokens > 0)) && (
                    <span className="ml-1 text-purple-600">
                      ({[
                        tokenUsage.cacheReadInputTokens && tokenUsage.cacheReadInputTokens > 0 && `${tokenUsage.cacheReadInputTokens.toLocaleString()} hit`,
                        tokenUsage.cacheWriteInputTokens && tokenUsage.cacheWriteInputTokens > 0 && `${tokenUsage.cacheWriteInputTokens.toLocaleString()} write`
                      ].filter(Boolean).join(', ')})
                    </span>
                  )}
                </Badge>
              )}
            </div>
          )}

          {/* Action Buttons - Shows on hover at bottom */}
          <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-3 text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback('up')}
              className={`h-8 px-3 ${
                feedback === 'up'
                  ? 'text-green-600 bg-green-50 hover:bg-green-100 dark:text-green-400 dark:bg-green-950/30 dark:hover:bg-green-950/50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback('down')}
              className={`h-8 px-3 ${
                feedback === 'down'
                  ? 'text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-950/30 dark:hover:bg-red-950/50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Only re-render if messages or reasoning actually changed
  const messagesEqual = prevProps.messages.length === nextProps.messages.length &&
    prevProps.messages.every((msg, idx) => {
      const nextMsg = nextProps.messages[idx]
      if (!nextMsg) return false

      // Compare basic properties
      if (msg.id !== nextMsg.id || msg.text !== nextMsg.text) return false

      // Compare latencyMetrics (important for showing metrics after streaming)
      const latencyChanged =
        msg.latencyMetrics?.timeToFirstToken !== nextMsg.latencyMetrics?.timeToFirstToken ||
        msg.latencyMetrics?.endToEndLatency !== nextMsg.latencyMetrics?.endToEndLatency

      // Compare tokenUsage (important for showing token counts after streaming)
      const tokenUsageChanged =
        msg.tokenUsage?.inputTokens !== nextMsg.tokenUsage?.inputTokens ||
        msg.tokenUsage?.outputTokens !== nextMsg.tokenUsage?.outputTokens

      // If metrics changed, we need to re-render
      if (latencyChanged || tokenUsageChanged) return false

      return true
    })

  const reasoningEqual = prevProps.currentReasoning?.text === nextProps.currentReasoning?.text
  const callbackEqual = prevProps.onResearchClick === nextProps.onResearchClick && prevProps.onBrowserClick === nextProps.onBrowserClick

  return messagesEqual && reasoningEqual && prevProps.sessionId === nextProps.sessionId && callbackEqual
})
