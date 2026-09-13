import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCanvasHandlers } from '@/hooks/useCanvasHandlers'

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

it('uses the same durable artifact ID as history and revisions', async () => {
  vi.useFakeTimers()
  const hook = renderHook(() => useCanvasHandlers())
  const addArtifact = vi.fn(), openArtifact = vi.fn()
  hook.result.current.setArtifactMethods({ artifacts: [], refreshArtifacts: vi.fn(), addArtifact, updateArtifact: vi.fn(), openArtifact })
  await act(async () => {
    await hook.result.current.handleDiagramCreated('documents/session/image/margins.png', 'margins.png')
    await hook.result.current.handleDiagramCreated('documents/session/image/margins.png', 'margins.png')
    vi.runAllTimers()
  })
  expect(addArtifact.mock.calls.map(([artifact]) => artifact.id)).toEqual(['diagram-margins', 'diagram-margins'])
  expect(openArtifact).toHaveBeenCalledWith('diagram-margins')
})
