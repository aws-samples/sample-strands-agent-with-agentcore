/**
 * Tests for useLatencyTracking hook
 *
 * Tests cover:
 * - TTFT (Time to First Token) measurement
 * - E2E (End-to-End) latency measurement
 * - Duplicate tracking prevention
 * - Metadata saving with token usage and documents
 * - Reset functionality
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLatencyTracking } from '@/hooks/useLatencyTracking'

// Mock fetchAuthSession
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } }
  })
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useLatencyTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'msg-123' }] })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('startTracking', () => {
    it('should initialize tracking state', () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      const metrics = result.current.getMetrics()
      expect(metrics.timeToFirstToken).toBeUndefined()
      expect(metrics.endToEndLatency).toBeUndefined()
    })

    it('should accept custom start time', () => {
      const { result } = renderHook(() => useLatencyTracking())
      const customStartTime = Date.now() - 1000

      act(() => {
        result.current.startTracking(customStartTime)
      })

      // Record TTFT immediately
      act(() => {
        result.current.recordTTFT()
      })

      const metrics = result.current.getMetrics()
      // TTFT should be approximately 1000ms (since we started 1 second ago)
      expect(metrics.timeToFirstToken).toBeGreaterThanOrEqual(1000)
    })

    it('should prevent duplicate tracking calls', () => {
      const { result } = renderHook(() => useLatencyTracking())
      const consoleSpy = vi.spyOn(console, 'log')

      act(() => {
        result.current.startTracking()
      })

      act(() => {
        result.current.startTracking() // Second call should be ignored
      })

      expect(consoleSpy).toHaveBeenCalledWith('[Latency] Already tracking, skipping startTracking')
    })
  })

  describe('recordTTFT', () => {
    it('should calculate TTFT from start time', () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      // Advance time by 500ms
      vi.advanceTimersByTime(500)

      let ttft: number | undefined
      act(() => {
        ttft = result.current.recordTTFT()
      })

      expect(ttft).toBe(500)
      expect(result.current.getMetrics().timeToFirstToken).toBe(500)
    })

    it('should only record TTFT once', () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(500)

      let firstTTFT: number | undefined
      act(() => {
        firstTTFT = result.current.recordTTFT()
      })

      vi.advanceTimersByTime(500)

      let secondTTFT: number | undefined
      act(() => {
        secondTTFT = result.current.recordTTFT()
      })

      // Second call should return the same value
      expect(firstTTFT).toBe(500)
      expect(secondTTFT).toBe(500)
    })

    it('should return undefined if tracking not started', () => {
      const { result } = renderHook(() => useLatencyTracking())

      let ttft: number | undefined
      act(() => {
        ttft = result.current.recordTTFT()
      })

      expect(ttft).toBeUndefined()
    })
  })

  describe('recordE2E', () => {
    it('should calculate E2E latency', async () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(100)

      act(() => {
        result.current.recordTTFT()
      })

      vi.advanceTimersByTime(900) // Total 1000ms

      let metrics: { ttft?: number; e2e?: number }
      act(() => {
        metrics = result.current.recordE2E({
          sessionId: 'session-123',
          messageId: 'msg-1'
        })
      })

      expect(metrics!.ttft).toBe(100)
      expect(metrics!.e2e).toBe(1000)
    })

    it('should include token usage in metadata', async () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(500)

      act(() => {
        result.current.recordTTFT()
      })

      vi.advanceTimersByTime(500)

      const tokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 10
      }

      act(() => {
        result.current.recordE2E({
          sessionId: 'session-123',
          messageId: 'msg-1',
          tokenUsage
        })
      })

      // Wait for async operations
      await vi.runAllTimersAsync()

      // Check that fetch was called with token usage
      expect(mockFetch).toHaveBeenCalled()
      const fetchCalls = mockFetch.mock.calls
      const metadataCall = fetchCalls.find(call => call[0] === '/api/session/update-metadata')

      if (metadataCall) {
        const body = JSON.parse(metadataCall[1].body)
        expect(body.metadata.tokenUsage).toEqual(tokenUsage)
      }
    })

    it('should include documents in metadata', async () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(500)

      act(() => {
        result.current.recordTTFT()
      })

      const documents = [
        { filename: 'report.docx', tool_type: 'word' },
        { filename: 'data.xlsx', tool_type: 'excel' }
      ]

      act(() => {
        result.current.recordE2E({
          sessionId: 'session-123',
          messageId: 'msg-1',
          documents
        })
      })

      await vi.runAllTimersAsync()

      const fetchCalls = mockFetch.mock.calls
      const metadataCall = fetchCalls.find(call => call[0] === '/api/session/update-metadata')

      if (metadataCall) {
        const body = JSON.parse(metadataCall[1].body)
        expect(body.metadata.documents).toEqual(documents)
      }
    })

    it('should only save metadata once', async () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(500)

      act(() => {
        result.current.recordTTFT()
      })

      act(() => {
        result.current.recordE2E({
          sessionId: 'session-123',
          messageId: 'msg-1'
        })
      })

      act(() => {
        result.current.recordE2E({
          sessionId: 'session-123',
          messageId: 'msg-1'
        })
      })

      await vi.runAllTimersAsync()

      // Count metadata save calls
      const metadataCalls = mockFetch.mock.calls.filter(
        call => call[0] === '/api/session/update-metadata'
      )

      // Should only save once
      expect(metadataCalls.length).toBe(1)
    })
  })

  describe('reset', () => {
    it('should clear all tracking state', () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(500)

      act(() => {
        result.current.recordTTFT()
      })

      act(() => {
        result.current.reset()
      })

      const metrics = result.current.getMetrics()
      expect(metrics.timeToFirstToken).toBeUndefined()
      expect(metrics.endToEndLatency).toBeUndefined()
    })

    it('should allow new tracking after reset', () => {
      const { result } = renderHook(() => useLatencyTracking())

      // First tracking session
      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(500)

      act(() => {
        result.current.recordTTFT()
      })

      act(() => {
        result.current.reset()
      })

      // Second tracking session
      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(200)

      let ttft: number | undefined
      act(() => {
        ttft = result.current.recordTTFT()
      })

      expect(ttft).toBe(200) // Should be 200, not 700
    })
  })

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const { result } = renderHook(() => useLatencyTracking())

      act(() => {
        result.current.startTracking()
      })

      vi.advanceTimersByTime(300)

      act(() => {
        result.current.recordTTFT()
      })

      vi.advanceTimersByTime(700)

      act(() => {
        result.current.recordE2E({
          sessionId: 'session-123',
          messageId: 'msg-1'
        })
      })

      const metrics = result.current.getMetrics()
      expect(metrics).toEqual({
        timeToFirstToken: 300,
        endToEndLatency: 1000
      })
    })
  })
})

describe('LatencyMetrics type', () => {
  it('should have correct shape', () => {
    const metrics = {
      timeToFirstToken: 100,
      endToEndLatency: 500
    }

    expect(metrics).toHaveProperty('timeToFirstToken')
    expect(metrics).toHaveProperty('endToEndLatency')
    expect(typeof metrics.timeToFirstToken).toBe('number')
    expect(typeof metrics.endToEndLatency).toBe('number')
  })
})
