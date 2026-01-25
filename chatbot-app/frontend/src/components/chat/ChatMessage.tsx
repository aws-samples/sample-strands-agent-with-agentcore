import React, { useState, useMemo, useCallback } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Bot, User, FileText, Image, ChevronDown, ChevronUp, Copy, Check, Mic } from 'lucide-react'
import { Message } from '@/types/chat'
import { Markdown } from '@/components/ui/Markdown'
import { ToolExecutionContainer } from './ToolExecutionContainer'
import { LazyImage } from '@/components/ui/LazyImage'

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

  const textClass = "text-[13px] leading-relaxed font-[450] tracking-[-0.005em] whitespace-pre-wrap break-all"

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
    return (
      <div className="flex justify-end mb-8 animate-slide-in group">
        <div className="flex items-start space-x-4 max-w-2xl">
          <div className="flex flex-col items-end space-y-2">
            {/* Uploaded files display */}
            {message.uploadedFiles && message.uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end max-w-sm">
                {message.uploadedFiles.map((file, index) => (
                  <Badge key={index} variant="secondary" className="flex items-center gap-1 text-xs">
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
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                title="Copy message"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <div className={`text-white rounded-2xl rounded-tr-md px-5 py-3.5 shadow-sm ${
                message.isVoiceMessage
                  ? 'bg-gradient-to-r from-fuchsia-500 to-purple-600'
                  : 'bg-blue-600'
              }`}>
                {message.isVoiceMessage && (
                  <div className="flex items-center gap-1.5 mb-1 text-white/80">
                    <Mic className="w-3 h-3" />
                    <span className="text-[10px] font-medium">Voice</span>
                  </div>
                )}
                <CollapsibleUserMessage text={message.text} />
              </div>
            </div>
          </div>
          <Avatar className="h-9 w-9 flex-shrink-0 mt-1">
            <AvatarFallback className={`${
              message.isVoiceMessage
                ? 'bg-gradient-to-br from-fuchsia-100 to-purple-100 text-fuchsia-600'
                : 'bg-blue-100 text-blue-600'
            }`}>
              {message.isVoiceMessage ? <Mic className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    )
  }

  // Handle tool execution messages separately - No background box
  if (message.isToolMessage && message.toolExecutions && message.toolExecutions.length > 0) {
    return (
      <div className="flex justify-start mb-4">
        <div className="flex items-start space-x-3 max-w-4xl w-full min-w-0">
          <Avatar className="h-8 w-8 flex-shrink-0 mt-1">
            <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
              <Bot className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
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
      <div className="flex items-start space-x-3 max-w-4xl w-full min-w-0">
        <Avatar className="h-8 w-8 flex-shrink-0 mt-1">
          <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          {/* Tool Executions Section - Only show if not a separate tool message */}
          {message.toolExecutions && message.toolExecutions.length > 0 && !message.isToolMessage && (
            <div className="mb-4">
              <div className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                Tools Used ({message.toolExecutions.length})
              </div>
              <ToolExecutionContainer toolExecutions={message.toolExecutions} compact={true} sessionId={sessionId} />
            </div>
          )}
          
          <div className="w-full overflow-hidden">
            <Markdown size="base" sessionId={sessionId}>{message.text}</Markdown>
            
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
                        <Badge variant="secondary" className="text-xs bg-black/70 text-white border-0">
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
         prevProps.sessionId === nextProps.sessionId
})
