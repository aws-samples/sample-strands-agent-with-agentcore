/**
 * Tests for useAuthSession hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAuthSession } from '@/hooks/useAuthSession'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock window.location
const mockLocation = { href: '' }
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
})

// Mock session response
const mockSessionResponse = {
  user: {
    email: 'test@example.com',
    sub: 'user-123',
    name: 'Test User',
  },
  session: {
    id: 'session-123',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    active: true,
  },
}

describe('useAuthSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockLocation.href = ''
    
    // Default successful response
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSessionResponse),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    it('should start with loading state', () => {
      const { result } = renderHook(() => useAuthSession())
      
      expect(result.current.isLoading).toBe(true)
    })

    it('should have null user initially', () => {
      const { result } = renderHook(() => useAuthSession())
      
      expect(result.current.user).toBeNull()
    })
  })

  describe('Authenticated State', () => {
    it('should fetch session data on mount', async () => {
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/session', expect.any(Object))
    })

    it('should set user data after successful fetch', async () => {
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.user).not.toBeNull()
      })
      
      expect(result.current.user?.email).toBe('test@example.com')
      expect(result.current.user?.name).toBe('Test User')
    })

    it('should set isAuthenticated to true when session is valid', async () => {
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true)
      })
    })
  })

  describe('Unauthenticated State', () => {
    it('should handle 401 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      
      const onSessionExpired = vi.fn()
      const { result } = renderHook(() => useAuthSession({ onSessionExpired }))
      
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false)
      })
    })

    it('should call onSessionExpired callback on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      
      const onSessionExpired = vi.fn()
      renderHook(() => useAuthSession({ onSessionExpired }))
      
      await waitFor(() => {
        expect(onSessionExpired).toHaveBeenCalled()
      })
    })
  })

  describe('Session Refresh', () => {
    it('should provide refresh function', async () => {
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      expect(typeof result.current.refresh).toBe('function')
    })

    it('should call refresh endpoint when refresh is called', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSessionResponse),
      })
      
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      await act(async () => {
        await result.current.refresh()
      })
      
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/refresh', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  describe('Logout', () => {
    it('should provide logout function', async () => {
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      expect(typeof result.current.logout).toBe('function')
    })

    it('should call logout endpoint when logout is called', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSessionResponse),
      })
      
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      await act(async () => {
        await result.current.logout()
      })
      
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
        method: 'POST',
      }))
    })

    it('should redirect to home after logout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSessionResponse),
      })
      
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      await act(async () => {
        await result.current.logout()
      })
      
      expect(mockLocation.href).toBe('/')
    })
  })

  describe('Session Expiration', () => {
    it('should calculate time until expiry', async () => {
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.timeUntilExpiry).not.toBeNull()
      })
      
      // Should be approximately 1 hour (3600000ms)
      expect(result.current.timeUntilExpiry).toBeGreaterThan(3500000)
    })

    it('should set isExpiring when session is about to expire', async () => {
      // Session expires in 5 minutes (within warning threshold)
      const expiringSession = {
        ...mockSessionResponse,
        session: {
          ...mockSessionResponse.session,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      }
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(expiringSession),
      })
      
      const { result } = renderHook(() => useAuthSession())
      
      await waitFor(() => {
        expect(result.current.isExpiring).toBe(true)
      })
    })

    it('should call onSessionExpiring callback when session is about to expire', async () => {
      const expiringSession = {
        ...mockSessionResponse,
        session: {
          ...mockSessionResponse.session,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      }
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(expiringSession),
      })
      
      const onSessionExpiring = vi.fn()
      renderHook(() => useAuthSession({ onSessionExpiring }))
      
      await waitFor(() => {
        expect(onSessionExpiring).toHaveBeenCalled()
      })
    })
  })

  describe('Auto Refresh', () => {
    it('should auto refresh when enabled', async () => {
      const { result } = renderHook(() => useAuthSession({
        autoRefresh: true,
        refreshInterval: 1000, // 1 second for testing
      }))
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      // Initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1)
      
      // Advance time by refresh interval
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      
      // Should have fetched again
      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(1)
      })
    })

    it('should not auto refresh when disabled', async () => {
      const { result } = renderHook(() => useAuthSession({
        autoRefresh: false,
      }))
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      
      const initialCallCount = mockFetch.mock.calls.length
      
      // Advance time
      await act(async () => {
        vi.advanceTimersByTime(10000)
      })
      
      // Should not have fetched again
      expect(mockFetch.mock.calls.length).toBe(initialCallCount)
    })
  })
})
