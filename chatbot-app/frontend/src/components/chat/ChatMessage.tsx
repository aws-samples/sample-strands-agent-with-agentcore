import React, { useState, useMemo, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { FileText, Image, ChevronDown, ChevronUp, Copy, Check, Mic, Sparkles } from 'lucide-react'
import { Message } from '@/types/chat'
import { Markdown } from '@/components/ui/Markdown'
import { ToolExecutionContainer } from './ToolExecutionContainer'
import { LazyImage } from '@/components/ui/LazyImage'
import { AIIcon } from '@/components/ui/AIIcon'

// Check if this is a compose request JSON (user message to hide)
const isComposeRequest = (text: string): boolean => {
  try {
    const data = JSON.parse(text)
    return !!(data.document_type && 'topic' in data)
  } catch {
    return false
  }
}

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

// Minimal artifact notification - shown instead of user+assistant message pair
const ArtifactNotification = ({ title, wordCount }: { title: string; wordCount: number }) => {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('open-artifact-by-title', { detail: { title } }))
  }

  return (
    <div className="flex justify-start mb-4">
      <button
        onClick={handleClick}
        className="flex items-center gap-3 py-2 px-4 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-100/50 dark:hover:bg-violet-900/30 transition-colors text-left"
      >
        <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
        <span className="text-label font-medium text-foreground">{title}</span>
        <span className="text-caption text-muted-foreground">{wordCount.toLocaleString()} words</span>
      </button>
    </div>
  )
}

interface ChatMessageProps {
  message: Message
  sessionId?: string
}

const MAX_LINES = 5

const getFileIcon = (fileType: string) => {
  if (fileType.startsWith('image/')) {
    return <Image className="w-3 h-3" />
  } else if (fileType === 'application/pdf') {
    return <FileText className="w-3 h-3" />
  }
  return <FileText className="w-3 h-3" />
}

const CollapsibleUserMessage = ({ text }: { text: string }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const { lines, isLong, truncatedText } = useMemo(() => {
    const allLines = text.split('\n')
    const isLong = allLines.length > MAX_LINES
    const truncatedText = isLong ? allLines.slice(0, MAX_LINES).join('\n') : text
    return { lines: allLines, isLong, truncatedText }
  }, [text])

  const textClass = "text-[17px] leading-[1.8] font-[450] tracking-[-0.005em] whitespace-pre-wrap break-all"

  if (!isLong) {
    return <p className={textClass}>{text}</p>
  }

  return (
    <div>
      <p className={textClass}>
        {isExpanded ? text : truncatedText}
        {!isExpanded && '...'}
      </p>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="mt-2 flex items-center gap-1 text-[11px] text-blue-200 hover:text-white transition-colors"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="w-3 h-3" />
            Show less
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" />
            Show more ({lines.length - MAX_LINES} lines)
          </>
        )}
      </button>
    </div>
  )
}

export const ChatMessage = React.memo<ChatMessageProps>(({ message, sessionId }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [message.text])

  if (message.sender === 'user') {
    // Hide compose request messages (they're shown combined with artifact result)
    if (isComposeRequest(message.text)) {
      return null
    }

    return (
      <div className="flex justify-end mb-8 animate-slide-in group">
        <div className="flex items-start max-w-3xl">
          <div className="flex flex-col items-end space-y-2">
            {/* Uploaded files display */}
            {message.uploadedFiles && message.uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end max-w-sm">
                {message.uploadedFiles.map((file, index) => (
                  <Badge key={index} variant="secondary" className="flex items-center gap-1 text-caption">
                    {getFileIcon(file.type)}
                    <span className="truncate max-w-[120px]">
                      {file.name.length > 15 ? `${file.name.substring(0, 15)}...` : file.name}
                    </span>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                title="Copy message"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <div className={`rounded-2xl rounded-tr-md px-5 py-3.5 shadow-sm ${
                message.isVoiceMessage
                  ? 'bg-gradient-to-r from-fuchsia-100 to-purple-100 dark:from-fuchsia-900/30 dark:to-purple-900/30 text-fuchsia-800 dark:text-fuchsia-200'
                  : 'bg-blue-100 dark:bg-[#303030] text-slate-800 dark:text-[#E0E0E0]'
              }`}>
                {message.isVoiceMessage && (
                  <div className="flex items-center gap-1.5 mb-1 text-fuchsia-600 dark:text-fuchsia-300">
                    <Mic className="w-3 h-3" />
                    <span className="text-[10px] font-medium">Voice</span>
                  </div>
                )}
                <CollapsibleUserMessage text={message.text} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Handle artifact messages - check artifactReference first (real-time), then text pattern (history)
  if (message.artifactReference) {
    console.log('[ChatMessage] Rendering artifact via artifactReference:', message.artifactReference.title)
    return <ArtifactNotification title={message.artifactReference.title} wordCount={message.artifactReference.wordCount || 0} />
  }

  // Check for artifact creation pattern in text
  if (message.text && message.text.includes('has been created.') && message.text.includes('words)')) {
    const artifact = parseArtifactMessage(message.text)
    console.log('[ChatMessage] Text check:', message.text.substring(0, 80), 'artifact:', artifact)
    if (artifact) {
      return <ArtifactNotification title={artifact.title} wordCount={artifact.wordCount} />
    }
  }

  // Handle tool execution messages separately - No background box
  if (message.isToolMessage && message.toolExecutions && message.toolExecutions.length > 0) {
    return (
      <div className="flex justify-start mb-4">
        <div className="flex items-start space-x-3 max-w-5xl w-full min-w-0">
          <AIIcon size={32} isAnimating={message.isStreaming} className="mt-1" />
          <div className="flex-1 min-w-0">
            <ToolExecutionContainer toolExecutions={message.toolExecutions} sessionId={sessionId} />
          </div>
        </div>
      </div>
    )
  }

  // Regular bot message - No background box
  return (
    <div className="flex justify-start mb-4">
      <div className="flex items-start space-x-3 max-w-5xl w-full min-w-0">
        <AIIcon size={32} isAnimating={message.isStreaming} className="mt-1" />
        <div className="flex-1 min-w-0">
          {/* Tool Executions Section - Only show if not a separate tool message */}
          {message.toolExecutions && message.toolExecutions.length > 0 && !message.isToolMessage && (
            <div className="mb-4">
              <div className="text-caption font-medium text-slate-600 mb-2 flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                Tools Used ({message.toolExecutions.length})
              </div>
              <ToolExecutionContainer toolExecutions={message.toolExecutions} compact={true} sessionId={sessionId} />
            </div>
          )}

          <div className="w-full overflow-hidden">
            <Markdown size="2xl" sessionId={sessionId}>{message.text}</Markdown>
            
            {/* Generated Images */}
            {message.images && message.images.length > 0 && (
              <div className="mt-4 space-y-3">
                {message.images.map((image, idx) => {
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
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Only re-render if these specific values change
  return prevProps.message.id === nextProps.message.id &&
         prevProps.message.text === nextProps.message.text &&
         prevProps.message.isStreaming === nextProps.message.isStreaming &&
         prevProps.message.artifactReference?.id === nextProps.message.artifactReference?.id &&
         prevProps.sessionId === nextProps.sessionId
})
