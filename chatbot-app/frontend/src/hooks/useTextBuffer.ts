import { useRef, useCallback, useEffect } from 'react'

interface UseTextBufferOptions {
  /** Flush interval in milliseconds (default: 50ms) */
  flushInterval?: number
}

interface UseTextBufferReturn {
  /** Append text chunk to buffer (called on each SSE chunk) */
  appendChunk: (chunk: string) => void
  /** Get current buffer content without flushing */
  getBuffer: () => string
  /** Clear buffer and stop flushing (call when streaming ends). Returns final buffered text. */
  reset: () => string
  /** Check if buffer has unflushed content */
  hasPendingContent: () => boolean
  /** Start periodic flushing with a callback. Call this when streaming starts. */
  startFlushing: (onFlush: (text: string) => void) => void
  /** Stop periodic flushing without clearing buffer */
  stopFlushing: () => void
}

/**
 * Hook for buffering streaming text chunks and flushing them at regular intervals.
 * This reduces re-renders and provides smoother UI updates during streaming.
 *
 * Instead of updating UI on every SSE chunk (which can be very frequent),
 * this hook accumulates chunks in a buffer and flushes at a fixed interval.
 *
 * Key design: The onFlush callback is passed to startFlushing() at streaming start time,
 * not at hook initialization. This avoids stale closure issues with refs.
 *
 * @example
 * ```typescript
 * const textBuffer = useTextBuffer({ flushInterval: 50 })
 *
 * // When first chunk arrives and streaming starts:
 * textBuffer.startFlushing((text) => {
 *   // This callback is created fresh, so refs are current
 *   setMessages(prev => updateMessage(prev, streamingIdRef.current, text))
 * })
 * textBuffer.appendChunk(data.text)
 *
 * // On subsequent chunks:
 * textBuffer.appendChunk(data.text)
 *
 * // When streaming ends:
 * const finalText = textBuffer.reset()
 * ```
 */
export function useTextBuffer({
  flushInterval = 50
}: UseTextBufferOptions = {}): UseTextBufferReturn {
  // Buffer to accumulate incoming chunks
  const bufferRef = useRef<string>('')

  // Track what has been flushed to UI
  const flushedTextRef = useRef<string>('')

  // Interval ID for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Store the flush callback (set when startFlushing is called)
  const onFlushRef = useRef<((text: string) => void) | null>(null)

  // Flush buffer to UI if there's new content
  const flush = useCallback(() => {
    const currentBuffer = bufferRef.current
    const flushedText = flushedTextRef.current
    const onFlush = onFlushRef.current

    // Only flush if there's new content and we have a callback
    if (currentBuffer.length > flushedText.length && onFlush) {
      flushedTextRef.current = currentBuffer
      onFlush(currentBuffer)
    }
  }, [])

  // Start the flush interval with a callback
  const startFlushing = useCallback((onFlush: (text: string) => void) => {
    // Store the callback in ref (avoids closure issues)
    onFlushRef.current = onFlush

    // Don't start another interval if already running
    if (intervalRef.current) return

    intervalRef.current = setInterval(flush, flushInterval)
  }, [flush, flushInterval])

  // Stop flushing without clearing buffer
  const stopFlushing = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    onFlushRef.current = null
  }, [])

  // Append chunk to buffer
  const appendChunk = useCallback((chunk: string) => {
    bufferRef.current += chunk
  }, [])

  // Get current buffer content
  const getBuffer = useCallback(() => {
    return bufferRef.current
  }, [])

  // Reset buffer (call when streaming ends). Returns final buffered text.
  const reset = useCallback(() => {
    // Final flush to ensure all content is rendered
    flush()

    // Get final text before clearing
    const finalText = bufferRef.current

    // Stop interval
    stopFlushing()

    // Clear buffer
    bufferRef.current = ''
    flushedTextRef.current = ''

    return finalText
  }, [flush, stopFlushing])

  // Check if there's unflushed content
  const hasPendingContent = useCallback(() => {
    return bufferRef.current.length > flushedTextRef.current.length
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopFlushing()
    }
  }, [stopFlushing])

  return {
    appendChunk,
    getBuffer,
    reset,
    hasPendingContent,
    startFlushing,
    stopFlushing
  }
}
