import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useArtifacts } from '@/hooks/useArtifacts'
import type { Artifact } from '@/types/artifact'

const firstArtifact: Artifact = {
  id: 'research-1',
  type: 'research',
  title: 'First session report',
  content: '# Report',
  timestamp: '2026-08-06T00:00:00Z',
}

describe('useArtifacts', () => {
  it('restores a persisted diagram as an image while retaining its canonical ID and S3 source', async () => {
    vi.mocked(sessionStorage.getItem).mockReturnValueOnce(JSON.stringify([{
      id: 'diagram-chart', type: 'diagram', title: 'chart.png', content: 's3://bucket/chart.png',
    }]))
    const hook = renderHook(() => useArtifacts('image-session'))
    await waitFor(() => expect(hook.result.current.artifacts[0]).toMatchObject({
      id: 'diagram-chart', type: 'image', content: 's3://bucket/chart.png',
    }))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not expose or copy artifacts when the active session changes', async () => {
    const hook = renderHook(
      ({ sessionId }) => useArtifacts(sessionId),
      { initialProps: { sessionId: 'session-1' } },
    )

    await waitFor(() => {
      expect(hook.result.current.artifacts).toEqual([])
    })

    act(() => {
      hook.result.current.addArtifact(firstArtifact)
    })
    expect(hook.result.current.artifacts).toEqual([firstArtifact])

    const staleAddArtifact = hook.result.current.addArtifact
    hook.rerender({ sessionId: 'session-2' })

    expect(hook.result.current.artifacts).toEqual([])
    expect(hook.result.current.selectedArtifactId).toBeNull()

    act(() => {
      staleAddArtifact({
        ...firstArtifact,
        id: 'late-session-1-artifact',
      })
    })

    expect(hook.result.current.artifacts).toEqual([])

    const secondArtifact: Artifact = {
      ...firstArtifact,
      id: 'session-2-artifact',
      title: 'Second session report',
    }
    act(() => {
      hook.result.current.addArtifact(secondArtifact)
    })

    expect(hook.result.current.artifacts).toEqual([secondArtifact])
    expect(sessionStorage.setItem).toHaveBeenLastCalledWith(
      'artifacts-session-2',
      JSON.stringify([secondArtifact]),
    )
  })
})


it('updates one Office entry across repeated saves and backend refreshes', async () => {
  const hook = renderHook(() => useArtifacts('office-session'))
  const ppt: Artifact = { id: 'ppt-plan.pptx-100-0', type: 'powerpoint_presentation', title: 'plan.pptx', content: 's3://bucket/plan.pptx', timestamp: '2026-09-12T00:00:00Z' }
  act(() => {
    hook.result.current.addArtifact(ppt)
    hook.result.current.openArtifact('ppt-plan')
    hook.result.current.addArtifact({ ...ppt, id: 'ppt-plan.pptx-200-0', description: 'Updated' })
  })
  expect(hook.result.current.artifacts).toHaveLength(1)
  expect(hook.result.current.artifacts[0]).toMatchObject({ id: 'ppt-plan', description: 'Updated' })
  expect(hook.result.current.selectedArtifactId).toBe('ppt-plan')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: [ppt, { ...ppt, id: 'ppt-plan' }] }) }))
  try {
    await act(async () => { await hook.result.current.refreshArtifacts({ skipFlashEffect: true }) })
    expect(hook.result.current.artifacts).toHaveLength(1)
    expect(hook.result.current.selectedArtifactId).toBe('ppt-plan')
    act(() => { hook.result.current.addArtifact({ ...ppt, id: 'different', title: 'other.pptx' }) })
    expect(hook.result.current.artifacts).toHaveLength(2)
  } finally { vi.unstubAllGlobals() }
})

it('keeps a valid early selection when history arrives, clears removed selections, and ignores stale reloads', () => {
  vi.mocked(sessionStorage.getItem).mockReturnValue(JSON.stringify([firstArtifact]))
  const hook = renderHook(({ id }) => useArtifacts(id), { initialProps: { id: 'first' } })
  act(() => { hook.result.current.openArtifact(firstArtifact.id) })
  act(() => { hook.result.current.reloadFromStorage() })
  expect(hook.result.current.selectedArtifactId).toBe(firstArtifact.id)
  expect(hook.result.current.isCanvasOpen).toBe(true)
  vi.mocked(sessionStorage.getItem).mockReturnValue('[]')
  act(() => { hook.result.current.reloadFromStorage() })
  expect(hook.result.current.selectedArtifactId).toBeNull()
  const staleReload = hook.result.current.reloadFromStorage
  hook.rerender({ id: 'second' })
  const second = { ...firstArtifact, id: 'second-result' }
  act(() => { hook.result.current.addArtifact(second); hook.result.current.openArtifact(second.id) })
  act(() => { staleReload() })
  expect(hook.result.current.selectedArtifactId).toBe(second.id)
  expect(hook.result.current.artifacts).toEqual([second])
  vi.mocked(sessionStorage.getItem).mockReturnValue(null)
})
