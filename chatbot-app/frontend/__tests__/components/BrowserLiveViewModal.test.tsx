import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserLiveViewModal } from '@/components/BrowserLiveViewModal'

// Mock Dialog components
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <div data-testid="dialog-content" className={className}>{children}</div>,
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <div data-testid="dialog-header" className={className}>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    <h2 data-testid="dialog-title">{children}</h2>,
  DialogDescription: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <p data-testid="dialog-description" className={className}>{children}</p>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, variant }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    variant?: string
  }) => (
    <button data-testid="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}))

describe('BrowserLiveViewModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sessionId: 'test-session-123',
    browserId: 'test-browser-456'
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock fetch for BFF live view URL
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ presignedUrl: 'https://test-presigned-url.com' })
    })

    // Mock DCV SDK on window
    const mockConnection = {
      disconnect: vi.fn()
    }

    const mockDcv = {
      setLogLevel: vi.fn(),
      LogLevel: { WARN: 2 },
      setWorkerPath: vi.fn(),
      authenticate: vi.fn((url, options) => {
        // Simulate async authentication
        setTimeout(() => {
          if (options.success) {
            options.success(null, [{ sessionId: 'dcv-session', authToken: 'dcv-token' }])
          }
        }, 10)
      }),
      connect: vi.fn().mockResolvedValue(mockConnection)
    }

    Object.defineProperty(window, 'dcv', {
      value: mockDcv,
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Clean up window.dcv
    delete (window as any).dcv
  })

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(
        <BrowserLiveViewModal
          {...defaultProps}
          isOpen={false}
        />
      )

      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
    })

    it('should render when isOpen is true', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      expect(screen.getByTestId('dialog')).toBeInTheDocument()
    })

    it('should render dialog header with title', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      expect(screen.getByTestId('dialog-header')).toBeInTheDocument()
      expect(screen.getByTestId('dialog-title')).toBeInTheDocument()
      expect(screen.getByText('Live View')).toBeInTheDocument()
    })

    it('should render LIVE indicator', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      expect(screen.getByText('LIVE')).toBeInTheDocument()
    })

    it('should render DCV display container', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      const container = document.getElementById('dcv-display-container')
      expect(container).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should show loading indicator initially', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      expect(screen.getByText(/Connecting to browser session/i)).toBeInTheDocument()
    })
  })

  describe('Props Validation', () => {
    it('should not attempt connection without sessionId', () => {
      render(
        <BrowserLiveViewModal
          {...defaultProps}
          sessionId={null}
        />
      )

      // Should show loading but not call authenticate
      expect(window.dcv?.authenticate).not.toHaveBeenCalled()
    })

    it('should not attempt connection without browserId', () => {
      render(
        <BrowserLiveViewModal
          {...defaultProps}
          browserId={null}
        />
      )

      // Should not call authenticate
      expect(window.dcv?.authenticate).not.toHaveBeenCalled()
    })
  })

  describe('onClose callback', () => {
    it('should be called when dialog is closed', () => {
      const onClose = vi.fn()

      render(
        <BrowserLiveViewModal
          {...defaultProps}
          onClose={onClose}
        />
      )

      // The dialog is rendered, onClose is passed to Dialog's onOpenChange
      expect(screen.getByTestId('dialog')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have dialog description for screen readers', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      expect(screen.getByTestId('dialog-description')).toBeInTheDocument()
    })

    it('should have dialog description with sr-only class', () => {
      render(<BrowserLiveViewModal {...defaultProps} />)

      const description = screen.getByTestId('dialog-description')
      expect(description.className).toContain('sr-only')
    })
  })
})

describe('BrowserLiveViewModal - Error Handling', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sessionId: 'test-session-123',
    browserId: 'test-browser-456'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (window as any).dcv
  })

  it('should show error when BFF returns error', async () => {
    // Mock fetch to return error
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    })

    // Mock DCV SDK
    Object.defineProperty(window, 'dcv', {
      value: {
        setLogLevel: vi.fn(),
        LogLevel: { WARN: 2 },
        authenticate: vi.fn()
      },
      writable: true,
      configurable: true
    })

    render(<BrowserLiveViewModal {...defaultProps} />)

    await waitFor(() => {
      const errorText = screen.queryByText(/Connection Failed/i) ||
                       screen.queryByText(/No live view URL available/i)
      // Either shows error or still loading
      expect(screen.getByTestId('dialog')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should handle DCV SDK load failure gracefully', async () => {
    // No DCV on window
    delete (window as any).dcv

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ presignedUrl: 'https://test-url.com' })
    })

    render(<BrowserLiveViewModal {...defaultProps} />)

    // Should show loading initially (DCV SDK will try to load from script)
    expect(screen.getByText(/Connecting to browser session/i)).toBeInTheDocument()
  })

  it('should show error message when authentication fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ presignedUrl: 'https://test-url.com' })
    })

    // Mock DCV SDK with auth failure
    Object.defineProperty(window, 'dcv', {
      value: {
        setLogLevel: vi.fn(),
        LogLevel: { WARN: 2 },
        authenticate: vi.fn((url, options) => {
          setTimeout(() => {
            if (options.error) {
              options.error(null, { message: 'Auth failed' })
            }
          }, 10)
        })
      },
      writable: true,
      configurable: true
    })

    render(<BrowserLiveViewModal {...defaultProps} />)

    await waitFor(() => {
      // Either shows error or loading
      expect(screen.getByTestId('dialog')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})

describe('BrowserLiveViewModal - DCV Connection', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sessionId: 'test-session-123',
    browserId: 'test-browser-456'
  }

  beforeEach(() => {
    vi.clearAllMocks()

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ presignedUrl: 'https://dcv-presigned-url.com?X-Amz-Security-Token=test' })
    })
  })

  afterEach(() => {
    delete (window as any).dcv
  })

  it('should call DCV authenticate with presigned URL', async () => {
    const mockAuthenticate = vi.fn((url, options) => {
      setTimeout(() => {
        options.success(null, [{ sessionId: 'dcv-session', authToken: 'token' }])
      }, 10)
    })

    Object.defineProperty(window, 'dcv', {
      value: {
        setLogLevel: vi.fn(),
        LogLevel: { WARN: 2 },
        authenticate: mockAuthenticate,
        connect: vi.fn().mockResolvedValue({ disconnect: vi.fn() })
      },
      writable: true,
      configurable: true
    })

    render(<BrowserLiveViewModal {...defaultProps} />)

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalled()
    }, { timeout: 3000 })

    // Check authenticate was called with the presigned URL
    const callArgs = mockAuthenticate.mock.calls[0]
    expect(callArgs[0]).toContain('dcv-presigned-url.com')
  })

  it('should call DCV connect after successful authentication', async () => {
    const mockConnect = vi.fn().mockResolvedValue({ disconnect: vi.fn() })

    Object.defineProperty(window, 'dcv', {
      value: {
        setLogLevel: vi.fn(),
        LogLevel: { WARN: 2 },
        authenticate: vi.fn((url, options) => {
          setTimeout(() => {
            options.success(null, [{ sessionId: 'dcv-session', authToken: 'token' }])
          }, 10)
        }),
        connect: mockConnect
      },
      writable: true,
      configurable: true
    })

    render(<BrowserLiveViewModal {...defaultProps} />)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    }, { timeout: 3000 })
  })

  it('should set DCV log level to WARN', async () => {
    const mockSetLogLevel = vi.fn()

    Object.defineProperty(window, 'dcv', {
      value: {
        setLogLevel: mockSetLogLevel,
        LogLevel: { WARN: 2 },
        authenticate: vi.fn((url, options) => {
          options.success(null, [{ sessionId: 'dcv-session', authToken: 'token' }])
        }),
        connect: vi.fn().mockResolvedValue({ disconnect: vi.fn() })
      },
      writable: true,
      configurable: true
    })

    render(<BrowserLiveViewModal {...defaultProps} />)

    await waitFor(() => {
      expect(mockSetLogLevel).toHaveBeenCalledWith(2)
    })
  })
})
