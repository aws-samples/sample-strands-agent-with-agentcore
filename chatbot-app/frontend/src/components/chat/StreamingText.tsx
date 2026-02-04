import React, { useRef, useEffect, useCallback, useState } from 'react'
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
 * StreamingText component that renders text with smooth animation.
 *
 * Uses a lightweight animation approach:
 * - Receives buffered text from useTextBuffer (50ms intervals)
 * - Animates between buffer updates at 60fps using requestAnimationFrame
 * - Only updates state when there's meaningful progress (16ms throttle)
 * - No citation processing overhead during animation (handled by Markdown)
 */
export const StreamingText = React.memo<StreamingTextProps>(({
  text,
  isStreaming,
  sessionId,
  toolUseId,
  size = '2xl'
}) => {
  const [displayedLength, setDisplayedLength] = useState(text.length)
  const targetLengthRef = useRef(text.length)
  const animationRef = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)

  // Update target when text changes
  useEffect(() => {
    targetLengthRef.current = text.length

    // If not streaming, show full text immediately
    if (!isStreaming) {
      setDisplayedLength(text.length)
      return
    }

    // Start animation if not already running
    if (animationRef.current === null && displayedLength < text.length) {
      lastUpdateRef.current = performance.now()
      animationRef.current = requestAnimationFrame(animate)
    }
  }, [text, isStreaming])

  const animate = useCallback(() => {
    const now = performance.now()
    const elapsed = now - lastUpdateRef.current
    const target = targetLengthRef.current

    setDisplayedLength(current => {
      if (current >= target) {
        animationRef.current = null
        return current
      }

      // Throttle state updates to ~60fps (16ms)
      if (elapsed < 16) {
        animationRef.current = requestAnimationFrame(animate)
        return current
      }

      lastUpdateRef.current = now

      // Calculate chars to add: faster when more text is pending
      const remaining = target - current
      const speed = Math.max(1, Math.min(remaining, Math.ceil(elapsed / 8)))
      const newLength = Math.min(current + speed, target)

      // Continue animation if not done
      if (newLength < target) {
        animationRef.current = requestAnimationFrame(animate)
      } else {
        animationRef.current = null
      }

      return newLength
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  // Slice text to displayed length during streaming
  let displayedText = isStreaming ? text.slice(0, displayedLength) : text

  // During streaming, avoid showing incomplete HTML tags to prevent raw HTML display
  if (isStreaming && displayedText.length > 0) {
    // Check for incomplete opening tags (no closing >)
    // Matches: <tagname, <tagname , <tagname attr="value, etc.
    const incompleteTagMatch = displayedText.match(/<[a-zA-Z][a-zA-Z0-9]*(?:\s+[^>]*)?$/)
    if (incompleteTagMatch && incompleteTagMatch.index !== undefined) {
      // Remove incomplete tag from displayed text to prevent raw HTML display
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
