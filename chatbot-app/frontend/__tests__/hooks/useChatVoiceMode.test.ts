import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChat } from '@/hooks/useChat'

// Mock dependencies (same as useChat.test.ts)
vi.mock('@/utils/chat', () => ({
  detectBackendUrl: vi.fn().mockResolvedValue({ url: 'http://localhost:8000', connected: true }),
  getToolIconById: vi.fn(),
  getCategoryColor: vi.fn()
}))

vi.mock('@/hooks/useStreamEvents', () => ({
  useStreamEvents: vi.fn(() => ({
    handleStreamEvent: vi.fn(),
    resetStreamingState: vi.fn()
  }))
}))

vi.mock('@/hooks/useChatAPI', () => ({
  useChatAPI: vi.fn(() => ({
    loadTools: vi.fn().mockResolvedValue(undefined),
    toggleTool: vi.fn().mockResolvedValue(undefined),
    newChat: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    sendStopSignal: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(null)
  }))
}))

vi.mock('@/config/environment', () => ({
  getApiUrl: vi.fn((path: string) => `http://localhost:8000/${path}`)
}))

vi.mock('@/lib/api-client', () => ({
  apiPost: vi.fn().mockResolvedValue({ success: true })
}))

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: null })
}))

describe('useChat - Voice Mode and Skills/Swarm Exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should disable skills when voice mode activates', async () => {
    const { result } = renderHook(() => useChat())
    await act(async () => { await vi.runAllTimersAsync() })

    // Skills default to true
    expect(result.current.skillsEnabled).toBe(true)

    // Activate voice
    act(() => { result.current.setVoiceStatus('voice_connected') })

    expect(result.current.skillsEnabled).toBe(false)
    expect(result.current.agentStatus).toBe('voice_connected')
  })

  it('should disable swarm when voice mode activates', async () => {
    const { result } = renderHook(() => useChat())
    await act(async () => { await vi.runAllTimersAsync() })

    // Enable swarm first
    act(() => { result.current.toggleSwarm(true) })
    expect(result.current.swarmEnabled).toBe(true)

    // Activate voice
    act(() => { result.current.setVoiceStatus('voice_connected') })

    expect(result.current.swarmEnabled).toBe(false)
  })

  it('should restore skills after voice mode ends', async () => {
    const { result } = renderHook(() => useChat())
    await act(async () => { await vi.runAllTimersAsync() })

    expect(result.current.skillsEnabled).toBe(true)

    // Voice on → skills off
    act(() => { result.current.setVoiceStatus('voice_connected') })
    expect(result.current.skillsEnabled).toBe(false)

    // Voice off → skills restored
    act(() => { result.current.setVoiceStatus('idle') })
    expect(result.current.skillsEnabled).toBe(true)
  })

  it('should restore swarm after voice mode ends', async () => {
    const { result } = renderHook(() => useChat())
    await act(async () => { await vi.runAllTimersAsync() })

    // Enable swarm, then voice
    act(() => { result.current.toggleSwarm(true) })
    act(() => { result.current.setVoiceStatus('voice_connected') })
    expect(result.current.swarmEnabled).toBe(false)

    // Voice off → swarm restored
    act(() => { result.current.setVoiceStatus('idle') })
    expect(result.current.swarmEnabled).toBe(true)
  })

  it('should not restore modes if they were off before voice', async () => {
    const { result } = renderHook(() => useChat())
    await act(async () => { await vi.runAllTimersAsync() })

    // Disable skills explicitly
    act(() => { result.current.toggleSkills(false) })
    expect(result.current.skillsEnabled).toBe(false)
    expect(result.current.swarmEnabled).toBe(false)

    // Voice on/off cycle
    act(() => { result.current.setVoiceStatus('voice_connected') })
    act(() => { result.current.setVoiceStatus('idle') })

    // Both should remain off
    expect(result.current.skillsEnabled).toBe(false)
    expect(result.current.swarmEnabled).toBe(false)
  })

  it('should handle voice status transitions without double-toggling', async () => {
    const { result } = renderHook(() => useChat())
    await act(async () => { await vi.runAllTimersAsync() })

    // Voice connected → voice listening (both are voice_ prefixed)
    act(() => { result.current.setVoiceStatus('voice_connected') })
    expect(result.current.skillsEnabled).toBe(false)

    // Transition within voice states should not re-save
    act(() => { result.current.setVoiceStatus('voice_listening') })
    expect(result.current.skillsEnabled).toBe(false)

    // Final disconnect restores original state
    act(() => { result.current.setVoiceStatus('idle') })
    expect(result.current.skillsEnabled).toBe(true)
  })
})
