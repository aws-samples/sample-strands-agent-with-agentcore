import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { GeneratedFilePreview } from '@/components/canvas/GeneratedFilePreview'
import { apiFetch } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('resolves a restored S3 image through the authenticated client', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, json: async () => ({ url: 'https://example.test/chart.png' }) } as Response)
  render(<GeneratedFilePreview source="s3://bucket/chart.png" s3Key="documents/user/session/image/chart.png" filename="chart.png" />)
  expect(await screen.findByRole('img', { name: 'chart.png' })).toHaveAttribute('src', 'https://example.test/chart.png')
  expect(apiFetch).toHaveBeenCalledWith('s3/presigned-url', expect.objectContaining({ body: JSON.stringify({ s3Key: 's3://bucket/chart.png', filename: 'chart.png' }) }))
})

it('offers retry after retrieval fails and does not leave a permanent blank preview', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://example.test/recovered.png' }) } as Response)
  render(<GeneratedFilePreview source="key" s3Key="documents/session/chart.png" filename="chart.png" sessionId="session-1" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'chart.png' })).toHaveAttribute('src', 'https://example.test/recovered.png'))
  expect(apiFetch).toHaveBeenLastCalledWith('workspace/download', expect.objectContaining({
    body: JSON.stringify({ path: 'documents/image/chart.png', sessionId: 'session-1' }),
  }))
})
