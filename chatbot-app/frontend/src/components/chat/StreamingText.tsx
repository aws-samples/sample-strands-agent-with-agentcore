import React from 'react'
import { Markdown } from '@/components/ui/Markdown'

interface StreamingTextProps {
  /** The full text content (buffered) */
  text: string
  /** Whether the message is currently streaming */
  isStreaming: boolean
  /** Session ID for Markdown component */
  sessionId?: string
  /** Tool use ID for Markdown component */
  toolUseId?: string
  /** Font size for Markdown component */
  size?: 'sm' | 'base' | 'lg' | 'xl' | '2xl'
}

/**
 * StreamingText component that renders buffered text via Markdown.
 *
 * Text arrives pre-buffered at 50ms intervals from useTextBuffer,
 * which already provides smooth streaming appearance.
 * During streaming, incomplete HTML tags are trimmed to prevent
 * raw tag display in the rendered output.
 */
export const StreamingText = React.memo<StreamingTextProps>(({
  text,
  isStreaming,
  sessionId,
  toolUseId,
  size = '2xl'
}) => {
  let displayedText = text

  // During streaming, avoid showing incomplete HTML tags to prevent raw HTML display
  if (isStreaming && displayedText.length > 0) {
    const incompleteTagMatch = displayedText.match(/<[a-zA-Z][a-zA-Z0-9]*(?:\s+[^>]*)?$/)
    if (incompleteTagMatch && incompleteTagMatch.index !== undefined) {
      displayedText = displayedText.slice(0, incompleteTagMatch.index)
    }
  }

  return (
    <Markdown sessionId={sessionId} toolUseId={toolUseId} size={size} preserveLineBreaks>
      {displayedText}
    </Markdown>
  )
}, (prevProps, nextProps) => {
  if (prevProps.text !== nextProps.text) return false
  if (prevProps.isStreaming !== nextProps.isStreaming) return false
  if (prevProps.sessionId !== nextProps.sessionId) return false
  if (prevProps.toolUseId !== nextProps.toolUseId) return false
  if (prevProps.size !== nextProps.size) return false
  return true
})

StreamingText.displayName = 'StreamingText'
