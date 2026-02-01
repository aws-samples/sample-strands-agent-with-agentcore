import React, { useState, useMemo } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, Zap, Coins, Copy, ThumbsUp, ThumbsDown, Check, FileText, Download, FileSpreadsheet, Presentation, AudioWaveform, Sparkles } from 'lucide-react'
import { AIIcon } from '@/components/ui/AIIcon'
import { Message } from '@/types/chat'
import { ReasoningState } from '@/types/events'
import { Markdown } from '@/components/ui/Markdown'
import { StreamingText } from './StreamingText'
import { ToolExecutionContainer } from './ToolExecutionContainer'
import { ResearchContainer } from '@/components/ResearchContainer'
import { LazyImage } from '@/components/ui/LazyImage'
import { fetchAuthSession } from 'aws-amplify/auth'

// Parse artifact creation message pattern
const parseArtifactMessage = (text: string): { title: string; wordCount: number } | null => {
  // Try with markdown bold first
  let match = text.match(/Document \*\*(.+?)\*\* has been created\.\s*\((\d+) words\)/)
  if (match) {
    return { title: match[1].trim(), wordCount: parseInt(match[2], 10) }
  }
  // Try without markdown bold
  match = text.match(/Document (.+?) has been created\.\s*\((\d+) words\)/)
  if (match) {
    return { title: match[1].trim(), wordCount: parseInt(match[2], 10) }
  }
  return null
}

// Minimal artifact notification - shown instead of text for artifact creation messages
const ArtifactNotification = ({ title, wordCount }: { title: string; wordCount: number }) => {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('open-artifact-by-title', { detail: { title } }))
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-2.5 text-body text-muted-foreground hover:text-foreground transition-colors h-9"
    >
      <Sparkles className="w-4 h-4" />
      <span className="font-medium">{title}</span>
      <span className="text-label opacity-60">· {wordCount.toLocaleString()} words</span>
    </button>
  )
}

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
  researchProgress?: {
    stepNumber: number
    content: string
  }
  // Hide avatar when this turn is part of a Swarm response (SwarmProgress shows the avatar)
  hideAvatar?: boolean
}

export const AssistantTurn = React.memo<AssistantTurnProps>(({ messages, currentReasoning, availableTools = [], sessionId, onResearchClick, onBrowserClick, researchProgress, hideAvatar = false }) => {
  // Get initial feedback state from first message
  const initialFeedback = messages[0]?.feedback || null

  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(initialFeedback)

  // Get file icon and color based on extension
  const getFileIcon = (filename: string) => {
    const ext = filename.toLowerCase().split('.').pop()
    switch (ext) {
      case 'xlsx':
      case 'xls':
        return { Icon: FileSpreadsheet, color: 'text-green-600 dark:text-green-400' }
      case 'pptx':
      case 'ppt':
        return { Icon: Presentation, color: 'text-orange-600 dark:text-orange-400' }
      case 'docx':
      case 'doc':
        return { Icon: FileText, color: 'text-blue-600 dark:text-blue-400' }
      default:
        return { Icon: FileText, color: 'text-blue-600 dark:text-blue-400' }
    }
  }

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

  // Handle document download
  const handleDocumentDownload = async (filename: string, toolType: string) => {
    if (!sessionId) {
      console.error('No session ID available for document download')
      return
    }

    try {
      // Get auth token for BFF to extract userId
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      try {
        const session = await fetchAuthSession()
        const token = session.tokens?.idToken?.toString()
        if (token) {
          authHeaders['Authorization'] = `Bearer ${token}`
        }
      } catch (error) {
        console.log('[DocumentDownload] No auth session available')
      }

      // Step 1: Get S3 key from documents/download API
      // BFF extracts userId from Authorization header
      const s3KeyResponse = await fetch('/api/documents/download', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          sessionId,
          filename,
          toolType
        })
      })

      if (!s3KeyResponse.ok) {
        throw new Error(`Failed to get S3 key: ${s3KeyResponse.status}`)
      }

      const { s3Key } = await s3KeyResponse.json()

      // Step 2: Get presigned URL from existing presigned-url API
      const presignedResponse = await fetch('/api/s3/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key })
      })

      if (!presignedResponse.ok) {
        throw new Error(`Failed to get presigned URL: ${presignedResponse.status}`)
      }

      const { url } = await presignedResponse.json()

      // Step 3: Trigger download
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      console.log('[DocumentDownload] Download triggered:', filename)
    } catch (err) {
      console.error('Failed to download document:', err)
    }
  }

  // Sort messages by timestamp to maintain chronological order
  // All messages have timestamp set on creation, so no fallback needed
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return timeA - timeB
    })
  }, [messages])

  // Group consecutive text messages together while preserving tool message positions
  const groupedContent = useMemo(() => {
    const grouped: Array<{
      type: 'text' | 'tool' | 'artifact'
      content: string | Message
      images?: any[]
      key: string
      toolUseId?: string
      isStreaming?: boolean
      artifact?: { title: string; wordCount: number }
    }> = []

    let currentTextGroup = ''
    let currentTextImages: any[] = []
    let textGroupStartId: string | number = 0
    let currentToolUseId: string | undefined = undefined
    let textGroupCounter = 0 // Counter for unique keys
    let currentIsStreaming = false // Track if any message in group is streaming

    const flushTextGroup = () => {
      if (currentTextGroup.trim()) {
        grouped.push({
          type: 'text',
          content: currentTextGroup,
          images: currentTextImages,
          key: `text-group-${textGroupCounter}-${textGroupStartId}`, // Use counter + id for uniqueness
          toolUseId: currentToolUseId,
          isStreaming: currentIsStreaming
        })
        currentTextGroup = ''
        currentTextImages = []
        currentToolUseId = undefined
        currentIsStreaming = false
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
          // Track streaming state
          if (message.isStreaming) {
            currentIsStreaming = true
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
      } else if (message.artifactReference) {
        // Artifact reference from real-time update
        flushTextGroup()
        grouped.push({
          type: 'artifact',
          content: '',
          key: `artifact-${message.id}`,
          artifact: {
            title: message.artifactReference.title,
            wordCount: message.artifactReference.wordCount || 0
          }
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
        // Track streaming state
        if (message.isStreaming) {
          currentIsStreaming = true
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

  // Collect all documents from the turn (for rendering at the bottom)
  const turnDocuments = useMemo(() => {
    const docs: Array<{ filename: string; tool_type: string }> = []
    sortedMessages.forEach(msg => {
      if (msg.documents && msg.documents.length > 0) {
        docs.push(...msg.documents)
      }
    })
    return docs
  }, [sortedMessages])

  return (
    <div className="flex justify-start mb-8 group">
      <div className={`flex items-start max-w-4xl w-full min-w-0 ${hideAvatar ? '' : 'space-x-4'}`}>
        {/* Single Avatar for the entire turn - hidden when part of Swarm response */}
        {!hideAvatar && (
          messages.some(m => m.isVoiceMessage) ? (
            <div className="h-9 w-9 flex-shrink-0 mt-2 flex items-center justify-center rounded-full text-white bg-gradient-to-br from-fuchsia-500 to-purple-600">
              <AudioWaveform className="h-4 w-4" />
            </div>
          ) : (
            <AIIcon size={36} isAnimating={messages.some(m => m.isStreaming)} className="mt-2" />
          )
        )}

        {/* Turn Content - add left margin when avatar is hidden to align with SwarmProgress content */}
        <div className={`flex-1 space-y-4 pt-1 min-w-0 ${hideAvatar ? 'ml-[52px]' : ''}`}>
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
                              // Check both isCancelled flag and exact declined message from ResearchApprovalHook
                              if (researchExecution.isCancelled) return 'declined'
                              const resultText = (researchExecution.toolResult || '').toLowerCase()
                              if (resultText === 'user declined to proceed with research' ||
                                  resultText === 'user declined to proceed with browser automation') {
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
                        return !(resultText === 'user declined to proceed with research' ||
                                resultText === 'user declined to proceed with browser automation')
                      })()}
                      currentStatus={researchProgress?.content}
                      onClick={() => {
                        if (!onResearchClick || !researchExecution.toolResult) return

                        // Check both isCancelled flag and exact declined message
                        if (researchExecution.isCancelled) return
                        const resultText = (researchExecution.toolResult || '').toLowerCase()
                        if (resultText === 'user declined to proceed with research' ||
                            resultText === 'user declined to proceed with browser automation') return

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
                              // Check for exact declined message from ResearchApprovalHook
                              if (browserExecution.isCancelled) return 'declined'
                              const resultText = (browserExecution.toolResult || '').toLowerCase()
                              if (resultText === 'user declined to proceed with research' ||
                                  resultText === 'user declined to proceed with browser automation') {
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
                        // No result if task was declined
                        if (browserExecution.isCancelled) return false
                        if (browserExecution.toolResult) {
                          const resultText = browserExecution.toolResult.toLowerCase()
                          if (resultText === 'user declined to proceed with research' ||
                              resultText === 'user declined to proceed with browser automation') {
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

                        // Block if declined
                        if (browserExecution.isCancelled) return
                        if (browserExecution.toolResult) {
                          const resultText = browserExecution.toolResult.toLowerCase()
                          if (resultText === 'user declined to proceed with research' ||
                              resultText === 'user declined to proceed with browser automation') return
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

            // Handle artifact type (real-time updates via artifactReference)
            if (item.type === 'artifact' && item.artifact) {
              return (
                <div key={item.key} className="animate-fade-in">
                  <ArtifactNotification title={item.artifact.title} wordCount={item.artifact.wordCount} />
                </div>
              )
            }

            // Check for artifact creation pattern (history load)
            const textContent = item.content as string
            const artifact = parseArtifactMessage(textContent)

            // If this is an artifact message, render as notification
            if (artifact) {
              return (
                <div key={item.key} className="animate-fade-in">
                  <ArtifactNotification title={artifact.title} wordCount={artifact.wordCount} />
                </div>
              )
            }

            return (
              <div key={item.key} className="animate-fade-in">
                <div className="chat-chart-content w-full overflow-hidden">
                  {/* Use StreamingText for smooth typing animation during streaming */}
                  <StreamingText
                    text={textContent}
                    isStreaming={item.isStreaming || false}
                    sessionId={sessionId}
                    toolUseId={item.toolUseId}
                  />

                  {/* Generated Images for this text group */}
                  {item.images && item.images.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {item.images.map((image, idx) => {
                        // Type guard for URL-based images
                        const isUrlImage = 'type' in image && image.type === 'url';
                        const imageSrc = isUrlImage
                          ? (image.url || image.thumbnail || '')
                          : 'data' in image
                          ? `data:image/${image.format};base64,${image.data}`
                          : '';
                        const imageFormat = isUrlImage
                          ? 'WEB'
                          : 'format' in image
                          ? (image.format || 'IMG').toUpperCase()
                          : 'IMG';

                        // Skip rendering if no valid image source
                        if (!imageSrc) return null;

                        return (
                          <div key={idx} className="relative group">
                            <LazyImage
                              src={imageSrc}
                              alt={`Generated image ${idx + 1}`}
                              className="max-w-full h-auto rounded-xl border border-slate-200 shadow-sm"
                              style={{ maxHeight: '400px' }}
                            />
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Badge variant="secondary" className="text-caption bg-black/70 text-white border-0">
                                {imageFormat}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Generated Documents - Rendered at turn bottom */}
          {turnDocuments.length > 0 && (
            <div className="mt-4 p-3 bg-gray-50/60 dark:bg-gray-800/30 rounded-lg border border-gray-200/60 dark:border-gray-700/40">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                <span className="text-caption font-medium text-gray-600 dark:text-gray-400">
                  {turnDocuments.length} {turnDocuments.length === 1 ? 'Document' : 'Documents'}
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
                {turnDocuments.map((doc, idx) => {
                  const { Icon, color } = getFileIcon(doc.filename)
                  return (
                    <div
                      key={idx}
                      className="group relative flex items-center gap-2.5 px-3.5 py-2 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-all duration-200 cursor-pointer border border-gray-200/50 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 flex-shrink-0"
                      onClick={() => handleDocumentDownload(doc.filename, doc.tool_type)}
                    >
                      <div className="flex items-center justify-center w-7 h-7 bg-gray-50 dark:bg-gray-800 rounded shadow-sm">
                        <Icon className={`h-3.5 w-3.5 ${color}`} />
                      </div>
                      <span className="text-label font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {doc.filename}
                      </span>
                      <Download className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Metrics Badges - Shows on hover at bottom right */}
          {((latencyMetrics && (latencyMetrics.timeToFirstToken || latencyMetrics.endToEndLatency)) || tokenUsage) && (
            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 -mt-2">
              {/* Latency Metrics */}
              {latencyMetrics?.timeToFirstToken && (
                <Badge variant="secondary" className="text-caption bg-blue-100 text-blue-700 border-blue-200 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  TTFT: {latencyMetrics.timeToFirstToken}ms
                </Badge>
              )}
              {latencyMetrics?.endToEndLatency && (
                <Badge variant="secondary" className="text-caption bg-green-100 text-green-700 border-green-200 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  E2E: {latencyMetrics.endToEndLatency}ms
                </Badge>
              )}

              {/* Token Usage Metrics */}
              {tokenUsage && (
                <Badge variant="secondary" className="text-caption bg-purple-100 text-purple-700 border-purple-200 flex items-center gap-1">
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

      // Compare toolExecutions (critical for preventing flickering during tool updates)
      const prevToolExecs = msg.toolExecutions || []
      const nextToolExecs = nextMsg.toolExecutions || []

      if (prevToolExecs.length !== nextToolExecs.length) return false

      const toolExecutionsChanged = prevToolExecs.some((tool, toolIdx) => {
        const nextTool = nextToolExecs[toolIdx]
        if (!nextTool) return true

        // Compare critical tool execution fields
        if (tool.id !== nextTool.id) return true
        if (tool.isComplete !== nextTool.isComplete) return true
        if (tool.toolResult !== nextTool.toolResult) return true
        if (tool.streamingResponse !== nextTool.streamingResponse) return true

        // Compare toolInput to detect parameter updates
        // PERFORMANCE: Use reference equality check first
        if (tool.toolInput === nextTool.toolInput) return false

        // Deep comparison only if references differ
        const prevInput = JSON.stringify(tool.toolInput || {})
        const nextInput = JSON.stringify(nextTool.toolInput || {})
        if (prevInput !== nextInput) return true

        return false
      })

      if (toolExecutionsChanged) return false

      return true
    })

  const reasoningEqual = prevProps.currentReasoning?.text === nextProps.currentReasoning?.text
  const callbackEqual = prevProps.onResearchClick === nextProps.onResearchClick && prevProps.onBrowserClick === nextProps.onBrowserClick

  // Compare researchProgress for real-time status updates
  const researchProgressEqual = prevProps.researchProgress?.stepNumber === nextProps.researchProgress?.stepNumber &&
    prevProps.researchProgress?.content === nextProps.researchProgress?.content

  const hideAvatarEqual = prevProps.hideAvatar === nextProps.hideAvatar

  return messagesEqual && reasoningEqual && prevProps.sessionId === nextProps.sessionId && callbackEqual && researchProgressEqual && hideAvatarEqual
})
