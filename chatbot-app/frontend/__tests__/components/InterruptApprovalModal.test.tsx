import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InterruptApprovalModal } from '@/components/InterruptApprovalModal'

// Mock lucide-react icons (include X used by Dialog close button)
vi.mock('lucide-react', () => ({
  Trash2: () => <div data-testid="trash-icon" />,
  X: () => <div data-testid="close-icon" />,
}))

describe('InterruptApprovalModal', () => {
  const mockOnApprove = vi.fn()
  const mockOnReject = vi.fn()

  beforeEach(() => {
    mockOnApprove.mockClear()
    mockOnReject.mockClear()
  })

  // ============================================================
  // Email Delete Approval Scenario Tests
  // ============================================================

  describe('Email Delete Approval', () => {
    const emailDeleteInterrupts = [
      {
        id: 'interrupt_001',
        name: 'chatbot-email-delete-approval',
        reason: {
          query: 'newsletter emails',
          intent: 'Delete all newsletter emails from inbox',
          max_delete: 25,
        },
      },
    ]

    it('should render email delete modal with correct title', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      expect(screen.getByText('Delete Emails')).toBeInTheDocument()
      expect(screen.getByText('This action cannot be undone')).toBeInTheDocument()
    })

    it('should display query and max delete count', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      expect(screen.getByText('newsletter emails')).toBeInTheDocument()
      expect(screen.getByText('25')).toBeInTheDocument()
    })

    it('should display intent text', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      expect(screen.getByText('Delete all newsletter emails from inbox')).toBeInTheDocument()
    })

    it('should show trash icon', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      expect(screen.getByTestId('trash-icon')).toBeInTheDocument()
    })

    it('should have Delete button', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('should call onApprove when Delete button is clicked', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      fireEvent.click(screen.getByText('Delete'))
      expect(mockOnApprove).toHaveBeenCalledTimes(1)
    })

    it('should call onReject when Cancel button is clicked', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={emailDeleteInterrupts}
        />
      )

      fireEvent.click(screen.getByText('Cancel'))
      expect(mockOnReject).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================
  // Modal State Tests
  // ============================================================

  describe('Modal State', () => {
    const defaultInterrupts = [
      {
        id: 'interrupt_001',
        name: 'chatbot-email-delete-approval',
        reason: { query: 'test', intent: 'test intent', max_delete: 50 },
      },
    ]

    it('should render when isOpen is true', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      expect(screen.getByText('Delete Emails')).toBeInTheDocument()
    })

    it('should return null when interrupts array is empty', () => {
      const { container } = render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={[]}
        />
      )

      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('Edge Cases', () => {
    it('should handle empty reason gracefully', () => {
      const interruptsWithEmptyReason = [
        {
          id: 'interrupt_001',
          name: 'chatbot-email-delete-approval',
          reason: {},
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={interruptsWithEmptyReason}
        />
      )

      expect(screen.getByText('Delete Emails')).toBeInTheDocument()
    })

    it('should use default max_delete of 50 when not provided', () => {
      const interrupts = [
        {
          id: 'interrupt_001',
          name: 'chatbot-email-delete-approval',
          reason: { query: 'spam' },
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={interrupts}
        />
      )

      expect(screen.getByText('50')).toBeInTheDocument()
    })

    it('should only process first interrupt when multiple provided', () => {
      const multipleInterrupts = [
        {
          id: 'interrupt_001',
          name: 'chatbot-email-delete-approval',
          reason: { query: 'first query', intent: 'first' },
        },
        {
          id: 'interrupt_002',
          name: 'chatbot-email-delete-approval',
          reason: { query: 'second query', intent: 'second' },
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={multipleInterrupts}
        />
      )

      expect(screen.getByText('first query')).toBeInTheDocument()
      expect(screen.queryByText('second query')).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Accessibility Tests
  // ============================================================

  describe('Accessibility', () => {
    const defaultInterrupts = [
      {
        id: 'interrupt_001',
        name: 'chatbot-email-delete-approval',
        reason: { query: 'test' },
      },
    ]

    it('should have accessible cancel button', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      expect(cancelButton).toBeInTheDocument()
    })

    it('should have accessible delete button', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      expect(deleteButton).toBeInTheDocument()
    })
  })
})
