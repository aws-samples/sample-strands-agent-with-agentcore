import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OfficeViewer } from '@/components/canvas/OfficeViewer'

describe('OfficeViewer', () => {
  it('uses a storage-neutral signed preview URL without another S3 lookup', async () => {
    render(
      <OfficeViewer
        previewUrl="https://example.test/report.docx?signature=short-lived"
        filename="report.docx"
      />,
    )

    const frame = await screen.findByTitle('Preview: report.docx')
    expect(frame).toHaveAttribute(
      'src',
      expect.stringContaining('https%3A%2F%2Fexample.test%2Freport.docx'),
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports an invalid legacy S3 URL instead of rendering a broken frame', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<OfficeViewer s3Url="not-an-s3-url" filename="report.docx" />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('The file link is unavailable')
      expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
    })
    expect(screen.queryByTitle('Preview: report.docx')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })
})

it('keeps the current workbook when an earlier preview lookup finishes late', async () => {
  let release!: (value: any) => void
  vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const view = render(<OfficeViewer s3Url="s3://bucket/old.xlsx" filename="old.xlsx" />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  view.rerender(<OfficeViewer previewUrl="https://example.test/new.xlsx" filename="new.xlsx" />)
  await act(async () => release({ ok: true, json: async () => ({ url: 'https://example.test/old.xlsx' }) }))
  expect(screen.getByTitle('Preview: new.xlsx')).toHaveAttribute('src', expect.stringContaining('new.xlsx'))
})

it('retries a failed lookup without regenerating the document', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://example.test/retry.xlsx' }) } as Response)
  render(<OfficeViewer s3Url="s3://bucket/retry.xlsx" filename="retry.xlsx" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry preview' }))
  expect(await screen.findByTitle('Preview: retry.xlsx')).toHaveAttribute('src', expect.stringContaining('retry.xlsx'))
})
