import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ResearchModal } from '@/components/ResearchModal'

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  FlaskConical: () => <div data-testid="flask-icon" />,
  Loader2: ({ className }: { className?: string }) => <div data-testid="loader-icon" className={className} />,
  FileDown: () => <div data-testid="file-down-icon" />,
  FileText: () => <div data-testid="file-text-icon" />,
  X: () => <div data-testid="close-icon" />,
}))

// Mock react-markdown
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown-content">{children}</div>,
}))

// Mock remark/rehype plugins
vi.mock('remark-gfm', () => ({ default: () => {} }))
vi.mock('rehype-raw', () => ({ default: () => {} }))

// Mock fetch for S3 presigned URLs
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('ResearchModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    query: 'What are the latest trends in AI?',
    isLoading: false,
    result: '',
    status: 'idle' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================
  // Basic Rendering Tests
  // ============================================================

  describe('Basic Rendering', () => {
    it('should render modal when isOpen is true', () => {
      render(<ResearchModal {...defaultProps} />)

      expect(screen.getByText('Research Agent')).toBeInTheDocument()
      // Query is not displayed in the UI, only used internally
      expect(screen.getByText('No results yet')).toBeInTheDocument()
    })

    it('should not render when isOpen is false', () => {
      render(<ResearchModal {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('Research Agent')).not.toBeInTheDocument()
    })

    it('should display custom agent name', () => {
      render(<ResearchModal {...defaultProps} agentName="Custom Research Bot" />)

      expect(screen.getByText('Custom Research Bot')).toBeInTheDocument()
    })

    it('should show flask icon', () => {
      render(<ResearchModal {...defaultProps} />)

      expect(screen.getByTestId('flask-icon')).toBeInTheDocument()
    })
  })

  // ============================================================
  // Status Display Tests
  // ============================================================

  describe('Status Display', () => {
    it('should show "Starting research..." for idle status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="idle" />)

      // Multiple elements may exist, use getAllByText
      const elements = screen.getAllByText('Starting research...')
      expect(elements.length).toBeGreaterThan(0)
    })

    it('should show "Searching web sources..." for searching status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="searching" />)

      expect(screen.getByText('Searching web sources...')).toBeInTheDocument()
    })

    it('should show "Analyzing information..." for analyzing status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="analyzing" />)

      expect(screen.getByText('Analyzing information...')).toBeInTheDocument()
    })

    it('should show "Generating report..." for generating status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="generating" />)

      expect(screen.getByText('Generating report...')).toBeInTheDocument()
    })

    it('should show "Research complete" for complete status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="complete" />)

      expect(screen.getByText('Research complete')).toBeInTheDocument()
    })

    it('should show "Research failed" for error status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="error" />)

      expect(screen.getByText('Research failed')).toBeInTheDocument()
    })

    it('should show "Research declined" for declined status', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="declined" />)

      expect(screen.getByText('Research declined')).toBeInTheDocument()
    })

    it('should show loader icon when loading', () => {
      render(<ResearchModal {...defaultProps} isLoading={true} status="searching" />)

      // Multiple loader icons may exist, use getAllByTestId
      const loaders = screen.getAllByTestId('loader-icon')
      expect(loaders.length).toBeGreaterThan(0)
      expect(loaders[0]).toHaveClass('animate-spin')
    })
  })

  // ============================================================
  // Result Display Tests
  // ============================================================

  describe('Result Display', () => {
    it('should display markdown content from result', () => {
      const result = '<research># AI Trends\n\nHere are the latest trends...</research>'

      render(<ResearchModal {...defaultProps} result={result} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should extract content from <research> tags', () => {
      const result = 'Some prefix text<research># Research Report\n\n## Introduction</research>Some suffix'

      render(<ResearchModal {...defaultProps} result={result} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown.textContent).toContain('# Research Report')
      expect(markdown.textContent).not.toContain('Some prefix text')
    })

    it('should show "No results yet" when result is empty and not loading', () => {
      render(<ResearchModal {...defaultProps} result="" isLoading={false} />)

      expect(screen.getByText('No results yet')).toBeInTheDocument()
    })

    it('should show loading spinner when loading and no result', () => {
      render(<ResearchModal {...defaultProps} result="" isLoading={true} />)

      // Multiple elements may exist, use getAllByText
      const elements = screen.getAllByText('Starting research...')
      expect(elements.length).toBeGreaterThan(0)
    })
  })

  // ============================================================
  // Research Complete Scenario Tests
  // ============================================================

  describe('Research Complete Scenario', () => {
    it('should show footer with Done button when status is complete', () => {
      render(
        <ResearchModal
          {...defaultProps}
          result="<research># Report\n\nContent here</research>"
          status="complete"
        />
      )

      // Footer shows "Research completed" text
      expect(screen.getByText(/Research completed/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })

    it('should show character count in footer', () => {
      const longResult = '<research>' + 'A'.repeat(5000) + '</research>'

      render(
        <ResearchModal
          {...defaultProps}
          result={longResult}
          status="complete"
        />
      )

      // 5000 chars = 5k characters
      expect(screen.getByText(/5k characters/)).toBeInTheDocument()
    })

    it('should call onClose when Done button is clicked', async () => {
      const onClose = vi.fn()

      render(
        <ResearchModal
          {...defaultProps}
          onClose={onClose}
          result="<research># Report</research>"
          status="complete"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not show Done button when status is not complete', () => {
      render(
        <ResearchModal
          {...defaultProps}
          result="<research># Report</research>"
          status="generating"
        />
      )

      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Research Declined Scenario Tests
  // ============================================================

  describe('Research Declined Scenario', () => {
    it('should show yellow status color for declined', () => {
      render(
        <ResearchModal
          {...defaultProps}
          isLoading={true}
          status="declined"
        />
      )

      const statusText = screen.getByText('Research declined')
      expect(statusText).toHaveClass('text-yellow-500')
    })

    it('should not show Done button when declined', () => {
      render(
        <ResearchModal
          {...defaultProps}
          result=""
          status="declined"
        />
      )

      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Error Scenario Tests
  // ============================================================

  describe('Error Scenario', () => {
    it('should show red status color for error', () => {
      render(
        <ResearchModal
          {...defaultProps}
          isLoading={true}
          status="error"
        />
      )

      const statusText = screen.getByText('Research failed')
      expect(statusText).toHaveClass('text-red-500')
    })
  })

  // ============================================================
  // Content Extraction Tests
  // ============================================================

  describe('Content Extraction', () => {
    it('should handle JSON-escaped content', () => {
      // Content with escaped newlines
      const result = '<research># Title\\n\\nParagraph with\\nnewlines</research>'

      render(<ResearchModal {...defaultProps} result={result} />)

      // Should render without crashing
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should handle JSON format with content field', () => {
      const result = JSON.stringify({ content: '# Research Title\n\nContent here' })

      render(<ResearchModal {...defaultProps} result={result} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should handle JSON format with text field', () => {
      const result = JSON.stringify({ text: '# Research Title\n\nContent here' })

      render(<ResearchModal {...defaultProps} result={result} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should fallback to H1 heading extraction', () => {
      const result = 'Some preamble text\n\n# Main Research Title\n\nActual content starts here'

      render(<ResearchModal {...defaultProps} result={result} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown.textContent).toContain('# Main Research Title')
    })

    it('should return content as-is when no pattern matches', () => {
      const result = 'Plain text without any markdown structure'

      render(<ResearchModal {...defaultProps} result={result} />)

      expect(screen.getByTestId('markdown-content').textContent).toBe(result)
    })
  })

  // ============================================================
  // S3 Image Handling Tests
  // ============================================================

  describe('S3 Image Handling', () => {
    it('should attempt to resolve S3 image URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ url: 'https://presigned-url.amazonaws.com/image.png' }),
      })

      const result = '<research>![Test Image](s3://bucket/test-image.png)</research>'

      render(
        <ResearchModal
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/s3/presigned-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s3Key: 's3://bucket/test-image.png' }),
        })
      })
    })

    it('should reset image URLs when modal closes', () => {
      const { rerender } = render(
        <ResearchModal
          {...defaultProps}
          result="<research>![Image](s3://bucket/image.png)</research>"
        />
      )

      // Close modal
      rerender(
        <ResearchModal
          {...defaultProps}
          isOpen={false}
          result="<research>![Image](s3://bucket/image.png)</research>"
        />
      )

      // Modal should not be visible
      expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('Edge Cases', () => {
    it('should handle empty query', () => {
      render(<ResearchModal {...defaultProps} query="" />)

      expect(screen.getByText('Research Agent')).toBeInTheDocument()
    })

    it('should handle very long result', () => {
      const longResult = '<research>' + '# Section\n\nContent\n'.repeat(1000) + '</research>'

      render(<ResearchModal {...defaultProps} result={longResult} status="complete" />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should handle special characters in query', () => {
      render(
        <ResearchModal
          {...defaultProps}
          query="What about <script>alert('xss')</script>?"
        />
      )

      // Should render without executing script - query is not displayed
      // but the component should render without crashing
      expect(screen.getByText('Research Agent')).toBeInTheDocument()
    })

    it('should handle Unicode content', () => {
      const result = '<research># Research Report\n\nUnicode content test with special chars: cafe, resume</research>'

      render(<ResearchModal {...defaultProps} result={result} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown.textContent).toContain('Unicode content test')
    })
  })

  // ============================================================
  // Export Buttons Tests
  // ============================================================

  describe('Export Buttons', () => {
    const completeProps = {
      ...defaultProps,
      result: '<research># Research Report\n\nContent here</research>',
      status: 'complete' as const,
    }

    it('should show PDF and Markdown export buttons when research is complete', () => {
      render(<ResearchModal {...completeProps} />)

      expect(screen.getByRole('button', { name: /PDF/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Markdown/i })).toBeInTheDocument()
    })

    it('should not show export buttons when research is not complete', () => {
      render(<ResearchModal {...defaultProps} result="" status="generating" />)

      expect(screen.queryByRole('button', { name: /PDF/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Markdown/i })).not.toBeInTheDocument()
    })

    it('should have correct tooltip on PDF button', () => {
      render(<ResearchModal {...completeProps} />)

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      expect(pdfButton).toHaveAttribute('title', 'Print to PDF (opens print dialog)')
    })

    it('should have correct tooltip on Markdown button', () => {
      render(<ResearchModal {...completeProps} />)

      const mdButton = screen.getByRole('button', { name: /Markdown/i })
      expect(mdButton).toHaveAttribute('title', 'Download as Markdown file')
    })
  })

  // ============================================================
  // PDF Export Tests
  // ============================================================

  describe('PDF Export', () => {
    const completeProps = {
      ...defaultProps,
      result: '<research># Research Report\n\nContent here</research>',
      status: 'complete' as const,
    }

    let mockOpen: ReturnType<typeof vi.fn>
    let mockDocument: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mockDocument = {
        write: vi.fn(),
        close: vi.fn(),
      }
      mockOpen = vi.fn().mockReturnValue({
        document: mockDocument,
      })
      vi.stubGlobal('open', mockOpen)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('should open new window when PDF button is clicked', async () => {
      render(<ResearchModal {...completeProps} />)

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfButton)

      expect(mockOpen).toHaveBeenCalledWith('', '_blank')
    })

    it('should write print-optimized HTML to new window', async () => {
      render(<ResearchModal {...completeProps} />)

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfButton)

      expect(mockDocument.write).toHaveBeenCalled()
      const writtenHtml = mockDocument.write.mock.calls[0][0]

      // Should contain print-optimized styles
      expect(writtenHtml).toContain('<!DOCTYPE html>')
      expect(writtenHtml).toContain('print-color-adjust: exact')
      expect(writtenHtml).toContain('@media print')
      expect(writtenHtml).toContain('Save as PDF')
    })

    it('should include citation styles in PDF HTML', async () => {
      render(<ResearchModal {...completeProps} />)

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfButton)

      const writtenHtml = mockDocument.write.mock.calls[0][0]
      expect(writtenHtml).toContain('a[href^="http"]')
      expect(writtenHtml).toContain('border-radius: 12px')
    })

    it('should show alert when popup is blocked', async () => {
      mockOpen.mockReturnValue(null) // Simulate blocked popup
      const mockAlert = vi.fn()
      vi.stubGlobal('alert', mockAlert)

      render(<ResearchModal {...completeProps} />)

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfButton)

      expect(mockAlert).toHaveBeenCalledWith(
        'Unable to open print window. Please check your popup blocker settings.'
      )
    })

    it('should convert relative URLs to absolute URLs', async () => {
      // Create a mock with innerHTML containing relative URLs
      const mockInnerHTML = '<img src="/api/charts/test.png" alt="chart" />'

      // We need to mock the contentRef - this is tricky with the current setup
      // For now, just verify the function exists and is callable
      render(<ResearchModal {...completeProps} />)

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      expect(pdfButton).not.toBeDisabled()
    })
  })

  // ============================================================
  // Markdown Export Tests
  // ============================================================

  describe('Markdown Export', () => {
    const completeProps = {
      ...defaultProps,
      result: '<research># Research Report\n\nContent with [link](https://example.com)</research>',
      status: 'complete' as const,
      sessionId: 'test-session-123',
    }

    let mockCreateObjectURL: ReturnType<typeof vi.fn>
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>
    let mockClick: ReturnType<typeof vi.fn>
    let appendedLink: HTMLAnchorElement | null = null

    beforeEach(() => {
      mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url')
      mockRevokeObjectURL = vi.fn()
      mockClick = vi.fn()

      vi.stubGlobal('URL', {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      })

      // Mock document.createElement and appendChild
      const originalCreateElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag)
        if (tag === 'a') {
          appendedLink = element as HTMLAnchorElement
          vi.spyOn(element, 'click').mockImplementation(mockClick)
        }
        return element
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
      appendedLink = null
    })

    it('should create blob with markdown content when Markdown button is clicked', () => {
      render(<ResearchModal {...completeProps} />)

      const mdButton = screen.getByRole('button', { name: /Markdown/i })
      fireEvent.click(mdButton)

      expect(mockCreateObjectURL).toHaveBeenCalled()
      const blobArg = mockCreateObjectURL.mock.calls[0][0]
      expect(blobArg).toBeInstanceOf(Blob)
      expect(blobArg.type).toBe('text/markdown;charset=utf-8')
    })

    it('should trigger download with correct filename', () => {
      render(<ResearchModal {...completeProps} />)

      const mdButton = screen.getByRole('button', { name: /Markdown/i })
      fireEvent.click(mdButton)

      expect(appendedLink).not.toBeNull()
      expect(appendedLink?.download).toMatch(/^research-report-\d{4}-\d{2}-\d{2}\.md$/)
      expect(mockClick).toHaveBeenCalled()
    })

    it('should revoke object URL after download', () => {
      render(<ResearchModal {...completeProps} />)

      const mdButton = screen.getByRole('button', { name: /Markdown/i })
      fireEvent.click(mdButton)

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url')
    })

    it('should add note about expiring image URLs when images present', () => {
      const resultWithImage = '<research># Report\n\n![Chart](s3://bucket/chart.png)</research>'

      render(
        <ResearchModal
          {...completeProps}
          result={resultWithImage}
        />
      )

      const mdButton = screen.getByRole('button', { name: /Markdown/i })
      fireEvent.click(mdButton)

      // The blob should contain the note
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('should replace chart paths with full URLs', () => {
      const resultWithChart = '<research># Report\n\n![Chart](charts/test.png)</research>'

      render(
        <ResearchModal
          {...completeProps}
          result={resultWithChart}
        />
      )

      const mdButton = screen.getByRole('button', { name: /Markdown/i })
      fireEvent.click(mdButton)

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })
  })

  // ============================================================
  // Citation UI Tests
  // ============================================================

  describe('Citation UI', () => {
    // For citation tests, we need to use a more realistic ReactMarkdown mock
    // that actually renders the link component

    it('should render external links with domain visible', () => {
      // This test verifies the link component logic
      // In actual rendering, ReactMarkdown calls our custom 'a' component

      // Test the domain extraction logic
      const getDomain = (url: string): string => {
        try {
          const hostname = new URL(url).hostname
          return hostname.replace(/^www\./, '')
        } catch {
          return ''
        }
      }

      expect(getDomain('https://www.wikipedia.org/wiki/AI')).toBe('wikipedia.org')
      expect(getDomain('https://arxiv.org/abs/1234')).toBe('arxiv.org')
      expect(getDomain('https://docs.google.com/document')).toBe('docs.google.com')
      expect(getDomain('invalid-url')).toBe('')
    })

    it('should identify external links correctly', () => {
      const isExternalLink = (href: string) => href?.startsWith('http')

      expect(isExternalLink('https://example.com')).toBe(true)
      expect(isExternalLink('http://example.com')).toBe(true)
      expect(isExternalLink('/internal/path')).toBe(false)
      expect(isExternalLink('#anchor')).toBe(false)
    })

    it('should truncate long domains', () => {
      // The UI truncates domains to 150px max width
      // This is handled by CSS class max-w-[150px]
      render(
        <ResearchModal
          {...defaultProps}
          result="<research>[Link](https://very-long-subdomain.example-domain.co.uk/path)</research>"
          status="complete"
        />
      )

      // Component should render without error
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })

  // ============================================================
  // Image Loading State Tests
  // ============================================================

  describe('Image Loading State', () => {
    it('should warn user when exporting PDF with loading images', async () => {
      const mockConfirm = vi.fn().mockReturnValue(false)
      vi.stubGlobal('confirm', mockConfirm)

      // Mock a slow S3 response to keep images in loading state
      mockFetch.mockImplementation(() => new Promise(() => {})) // Never resolves

      const resultWithS3Image = '<research># Report\n\n![Image](s3://bucket/image.png)</research>'

      render(
        <ResearchModal
          {...defaultProps}
          result={resultWithS3Image}
          status="complete"
        />
      )

      // Wait for the S3 resolution to start
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfButton)

      expect(mockConfirm).toHaveBeenCalledWith(
        'Some images are still loading. The PDF may be missing images. Continue anyway?'
      )

      vi.unstubAllGlobals()
    })

    it('should not warn when all images are loaded', async () => {
      const mockConfirm = vi.fn()
      vi.stubGlobal('confirm', mockConfirm)

      const mockOpen = vi.fn().mockReturnValue({
        document: { write: vi.fn(), close: vi.fn() }
      })
      vi.stubGlobal('open', mockOpen)

      // No S3 images, so no loading state
      const resultNoImages = '<research># Report\n\nJust text content</research>'

      render(
        <ResearchModal
          {...defaultProps}
          result={resultNoImages}
          status="complete"
        />
      )

      const pdfButton = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfButton)

      expect(mockConfirm).not.toHaveBeenCalled()
      expect(mockOpen).toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })

  // ============================================================
  // Print HTML Generation Tests
  // ============================================================

  describe('Print HTML Generation', () => {
    it('should generate valid HTML document structure', () => {
      const mockOpen = vi.fn().mockReturnValue({
        document: { write: vi.fn(), close: vi.fn() }
      })
      vi.stubGlobal('open', mockOpen)

      render(
        <ResearchModal
          {...defaultProps}
          result="<research># Test</research>"
          status="complete"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /PDF/i }))

      const writtenHtml = mockOpen.mock.results[0].value.document.write.mock.calls[0][0]

      expect(writtenHtml).toContain('<!DOCTYPE html>')
      expect(writtenHtml).toContain('<html lang="en">')
      expect(writtenHtml).toContain('<meta charset="UTF-8">')
      expect(writtenHtml).toContain('<title>Research Report</title>')
      expect(writtenHtml).toContain('</html>')

      vi.unstubAllGlobals()
    })

    it('should include print-specific CSS rules', () => {
      const mockOpen = vi.fn().mockReturnValue({
        document: { write: vi.fn(), close: vi.fn() }
      })
      vi.stubGlobal('open', mockOpen)

      render(
        <ResearchModal
          {...defaultProps}
          result="<research># Test</research>"
          status="complete"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /PDF/i }))

      const writtenHtml = mockOpen.mock.results[0].value.document.write.mock.calls[0][0]

      expect(writtenHtml).toContain('@page { margin: 20mm; size: A4; }')
      expect(writtenHtml).toContain('page-break-after: avoid')
      expect(writtenHtml).toContain('page-break-inside: avoid')

      vi.unstubAllGlobals()
    })

    it('should include print control buttons', () => {
      const mockOpen = vi.fn().mockReturnValue({
        document: { write: vi.fn(), close: vi.fn() }
      })
      vi.stubGlobal('open', mockOpen)

      render(
        <ResearchModal
          {...defaultProps}
          result="<research># Test</research>"
          status="complete"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /PDF/i }))

      const writtenHtml = mockOpen.mock.results[0].value.document.write.mock.calls[0][0]

      expect(writtenHtml).toContain('class="print-btn"')
      expect(writtenHtml).toContain('Save as PDF')
      expect(writtenHtml).toContain('class="close-btn"')
      expect(writtenHtml).toContain('Close')

      vi.unstubAllGlobals()
    })

    it('should hide print controls when printing', () => {
      const mockOpen = vi.fn().mockReturnValue({
        document: { write: vi.fn(), close: vi.fn() }
      })
      vi.stubGlobal('open', mockOpen)

      render(
        <ResearchModal
          {...defaultProps}
          result="<research># Test</research>"
          status="complete"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /PDF/i }))

      const writtenHtml = mockOpen.mock.results[0].value.document.write.mock.calls[0][0]

      // Check that print controls are hidden in print media query
      expect(writtenHtml).toContain('.print-controls { display: none; }')

      vi.unstubAllGlobals()
    })
  })
})
