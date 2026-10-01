import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/model/available-models/route'
import { ModelConfigDialog } from '@/components/ModelConfigDialog'
import { apiGet } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

describe('ModelConfigDialog with the deployed catalog', () => {
  it('renders after loading models without descriptions, then searches and selects', async () => {
    const catalog = await (await GET()).json()
    vi.mocked(apiGet).mockResolvedValue(catalog)
    const onModelChange = vi.fn()
    render(<ModelConfigDialog sessionId={null} currentModelId={catalog.models[0].id} onModelChange={onModelChange} />)

    const trigger = await screen.findByRole('button', { name: 'Claude Sonnet 5.5' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: 'Show all models' }))
    expect(screen.getByText('Claude Opus 5.5')).toBeInTheDocument()
    expect(screen.getByText('Grok 4.7')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search models...'), { target: { value: 'Opus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claude Opus 5.5' }))
    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith('anthropic.claude-opus-5-5'))
  })
})
