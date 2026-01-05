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
}

/**
 * StreamingText component that renders text with a smooth typing animation.
 *
 * Uses Markdown rendering throughout (both during and after streaming)
 * with smooth character-by-character animation via local state.
 *
 * Animation happens within each buffer flush interval (~50ms) to avoid delay.
 */
export const StreamingText = React.memo<StreamingTextProps>(({
  text,
  isStreaming,
  sessionId,
  toolUseId
}) => {
  // Displayed text (animated) - only used during streaming
  const [displayedText, setDisplayedText] = useState(text)
  // Track animation state
  const animationFrameRef = useRef<number | null>(null)
  const displayedLengthRef = useRef(text.length)
  const lastAnimationTimeRef = useRef(0)

  // Animate new text appearing character by character
  const animateText = useCallback(() => {
    const currentLength = displayedLengthRef.current
    const targetLength = text.length

    // Nothing to animate
    if (currentLength >= targetLength) {
      animationFrameRef.current = null
      return
    }

    const now = performance.now()
    const elapsed = now - lastAnimationTimeRef.current

    // Calculate characters to add based on elapsed time
    // Target: animate all new text within ~50ms (match buffer flush interval)
    const charsRemaining = targetLength - currentLength
    const msPerChar = Math.max(2, Math.min(8, 50 / Math.max(charsRemaining, 1)))

    if (elapsed >= msPerChar) {
      // Add characters (batch 2-5 at a time for smoother feel)
      const charsToAdd = Math.min(
        Math.ceil(elapsed / msPerChar),
        5, // Max 5 chars per frame
        charsRemaining
      )

      const newLength = currentLength + charsToAdd
      displayedLengthRef.current = newLength
      lastAnimationTimeRef.current = now

      // Update state to trigger Markdown re-render
      setDisplayedText(text.slice(0, newLength))
    }

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(animateText)
  }, [text])

  // Start/continue animation when text changes during streaming
  useEffect(() => {
    if (!isStreaming) {
      // Streaming ended - ensure full text is displayed
      displayedLengthRef.current = text.length
      setDisplayedText(text)
      return
    }

    // Start animation if we have new text to display
    if (text.length > displayedLengthRef.current) {
      if (animationFrameRef.current === null) {
        lastAnimationTimeRef.current = performance.now()
        animationFrameRef.current = requestAnimationFrame(animateText)
      }
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [text, isStreaming, animateText])

  // Reset when component unmounts
  useEffect(() => {
    return () => {
      displayedLengthRef.current = 0
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  // Always render with Markdown - use displayedText during streaming, full text after
  const textToRender = isStreaming ? displayedText : text

  return (
    <Markdown sessionId={sessionId} toolUseId={toolUseId} preserveLineBreaks>
      {textToRender}
    </Markdown>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for memo
  if (prevProps.isStreaming !== nextProps.isStreaming) return false
  if (prevProps.text !== nextProps.text) return false
  if (prevProps.sessionId !== nextProps.sessionId) return false
  if (prevProps.toolUseId !== nextProps.toolUseId) return false
  return true
})

StreamingText.displayName = 'StreamingText'
