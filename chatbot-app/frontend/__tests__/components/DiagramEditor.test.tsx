import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagramEditor } from '@/components/canvas/DiagramEditor'
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiFetch }))
vi.mock('@/components/canvas/ExcalidrawRenderer', () => ({ ExcalidrawRenderer: ({ onChange }: any) => <><button onClick={() => onChange({ elements: [{ id: 'note', text: 'Keep this note' }], sceneVersion: 1 })}>Edit diagram</button><button onClick={() => onChange({ elements: [{ id: 'note', text: 'The latest note' }], sceneVersion: 1 })}>Edit again</button></> }))
const artifact = { id: 'diagram-1', type: 'excalidraw' as const, title: 'Workflow', content: { elements: [] }, timestamp: '2026-09-12T00:00:00Z' }
describe('Diagram saving', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retains edits in the artifact immediately and saves them after the panel closes', async () => {
    let finish: (value: any) => void = () => {}
    apiFetch.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const update = vi.fn()
    const view = render(<DiagramEditor artifact={artifact} sessionId="session-1" onUpdate={update} />)
    fireEvent.click(screen.getByText('Edit diagram'))
    expect(update).toHaveBeenCalledWith('diagram-1', expect.objectContaining({ content: expect.objectContaining({ elements: [{ id: 'note', text: 'Keep this note' }] }) }))
    expect(screen.getByText('Saving changes…')).toBeInTheDocument()
    view.unmount()
    await act(async () => finish({ ok: true, json: async () => ({ version: 'saved-v1' }) }))
    expect(update).toHaveBeenLastCalledWith('diagram-1', expect.objectContaining({ metadata: expect.objectContaining({ editVersion: 'saved-v1' }) }))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).baseTimestamp).toBe(artifact.timestamp)
  })
  it('shows failure and retries the same edits without claiming success', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Save unavailable' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ version: 'v2' }) })
    render(<DiagramEditor artifact={artifact} sessionId="session-1" onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText('Edit diagram'))
    await screen.findByText('Save unavailable')
    fireEvent.click(screen.getByText('Retry save'))
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
  it('coalesces a burst of edits into one save of the latest scene', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ version: 'latest' }) })
    render(<DiagramEditor artifact={artifact} sessionId="session-1" onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText('Edit diagram'))
    fireEvent.click(screen.getByText('Edit again'))
    expect(apiFetch).not.toHaveBeenCalled()
    await screen.findByText('All changes saved')
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).content.elements[0].text).toBe('The latest note')
  })
})
