import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InterruptApprovalModal } from '@/components/InterruptApprovalModal'

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  FlaskConical: () => <div data-testid="flask-icon" />,
  CheckCircle2: () => <div data-testid="check-icon" />,
  XCircle: () => <div data-testid="x-icon" />,
  Globe: () => <div data-testid="globe-icon" />,
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
  // Research Approval Scenario Tests
  // ============================================================

  describe('Research Approval', () => {
    const researchInterrupts = [
      {
        id: 'interrupt_001',
        name: 'chatbot-research-approval',
        reason: {
          tool_name: 'research_agent',
          plan: 'Step 1: Search for quantum computing basics\nStep 2: Analyze recent papers\nStep 3: Summarize findings',
        },
      },
    ]

    it('should render research approval modal with correct title', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      expect(screen.getByText('Research Approval Required')).toBeInTheDocument()
      expect(screen.getByText('Review the research plan before proceeding')).toBeInTheDocument()
    })

    it('should display research plan content', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      expect(screen.getByText(/Step 1: Search for quantum computing basics/)).toBeInTheDocument()
      expect(screen.getByText(/Step 2: Analyze recent papers/)).toBeInTheDocument()
    })

    it('should show flask icon for research approval', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      expect(screen.getByTestId('flask-icon')).toBeInTheDocument()
    })

    it('should show "Research Plan" label', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      expect(screen.getByText('Research Plan')).toBeInTheDocument()
    })

    it('should have "Approve & Start Research" button text', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      expect(screen.getByText('Approve & Start Research')).toBeInTheDocument()
    })

    it('should call onApprove when approve button is clicked', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      const approveButton = screen.getByText('Approve & Start Research')
      fireEvent.click(approveButton)

      expect(mockOnApprove).toHaveBeenCalledTimes(1)
    })

    it('should call onReject when decline button is clicked', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={researchInterrupts}
        />
      )

      const declineButton = screen.getByText('Decline')
      fireEvent.click(declineButton)

      expect(mockOnReject).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================
  // Browser Approval Scenario Tests
  // ============================================================

  describe('Browser Approval', () => {
    const browserInterrupts = [
      {
        id: 'interrupt_002',
        name: 'chatbot-browser-approval',
        reason: {
          tool_name: 'browser_use_agent',
          task: 'Navigate to Amazon.com and search for "wireless headphones", then compare the top 3 results',
          max_steps: 20,
        },
      },
    ]

    it('should render browser approval modal with correct title', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={browserInterrupts}
        />
      )

      expect(screen.getByText('Browser Automation Approval Required')).toBeInTheDocument()
      expect(screen.getByText('Review the browser task before proceeding')).toBeInTheDocument()
    })

    it('should display browser task content', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={browserInterrupts}
        />
      )

      expect(screen.getByText(/Navigate to Amazon.com/)).toBeInTheDocument()
      expect(screen.getByText(/wireless headphones/)).toBeInTheDocument()
    })

    it('should show globe icon for browser approval', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={browserInterrupts}
        />
      )

      expect(screen.getByTestId('globe-icon')).toBeInTheDocument()
    })

    it('should show "Browser Task" label', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={browserInterrupts}
        />
      )

      expect(screen.getByText('Browser Task')).toBeInTheDocument()
    })

    it('should display max_steps information', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={browserInterrupts}
        />
      )

      expect(screen.getByText('Maximum steps:')).toBeInTheDocument()
      expect(screen.getByText('20')).toBeInTheDocument()
    })

    it('should have "Approve & Start Browser Task" button text', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={browserInterrupts}
        />
      )

      expect(screen.getByText('Approve & Start Browser Task')).toBeInTheDocument()
    })

    it('should use default max_steps of 15 when not provided', () => {
      const interruptsWithoutMaxSteps = [
        {
          id: 'interrupt_003',
          name: 'chatbot-browser-approval',
          reason: {
            task: 'Simple browser task',
          },
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={interruptsWithoutMaxSteps}
        />
      )

      expect(screen.getByText('15')).toBeInTheDocument()
    })
  })

  // ============================================================
  // Modal State Tests
  // ============================================================

  describe('Modal State', () => {
    const defaultInterrupts = [
      {
        id: 'interrupt_001',
        name: 'chatbot-research-approval',
        reason: { plan: 'Test plan' },
      },
    ]

    it('should not render when isOpen is false', () => {
      render(
        <InterruptApprovalModal
          isOpen={false}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      expect(screen.queryByText('Research Approval Required')).not.toBeInTheDocument()
    })

    it('should render when isOpen is true', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      expect(screen.getByText('Research Approval Required')).toBeInTheDocument()
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

      // Modal should not render any content
      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('Edge Cases', () => {
    it('should handle empty plan gracefully', () => {
      const interruptsWithEmptyPlan = [
        {
          id: 'interrupt_001',
          name: 'chatbot-research-approval',
          reason: {},
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={interruptsWithEmptyPlan}
        />
      )

      // Should render modal without crashing
      expect(screen.getByText('Research Approval Required')).toBeInTheDocument()
    })

    it('should handle empty task gracefully for browser approval', () => {
      const interruptsWithEmptyTask = [
        {
          id: 'interrupt_001',
          name: 'chatbot-browser-approval',
          reason: {},
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={interruptsWithEmptyTask}
        />
      )

      // Should render modal without crashing
      expect(screen.getByText('Browser Automation Approval Required')).toBeInTheDocument()
    })

    it('should handle undefined reason', () => {
      const interruptsWithUndefinedReason = [
        {
          id: 'interrupt_001',
          name: 'chatbot-research-approval',
          reason: undefined,
        },
      ]

      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={interruptsWithUndefinedReason as any}
        />
      )

      // Should render modal without crashing
      expect(screen.getByText('Research Approval Required')).toBeInTheDocument()
    })

    it('should only process first interrupt when multiple provided', () => {
      const multipleInterrupts = [
        {
          id: 'interrupt_001',
          name: 'chatbot-research-approval',
          reason: { plan: 'First research plan' },
        },
        {
          id: 'interrupt_002',
          name: 'chatbot-browser-approval',
          reason: { task: 'Browser task' },
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

      // Should show first interrupt (research) only
      expect(screen.getByText('Research Approval Required')).toBeInTheDocument()
      expect(screen.queryByText('Browser Automation Approval Required')).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // Accessibility Tests
  // ============================================================

  describe('Accessibility', () => {
    const defaultInterrupts = [
      {
        id: 'interrupt_001',
        name: 'chatbot-research-approval',
        reason: { plan: 'Test plan' },
      },
    ]

    it('should have accessible decline button', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      const declineButton = screen.getByRole('button', { name: /decline/i })
      expect(declineButton).toBeInTheDocument()
    })

    it('should have accessible approve button', () => {
      render(
        <InterruptApprovalModal
          isOpen={true}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
          interrupts={defaultInterrupts}
        />
      )

      const approveButton = screen.getByRole('button', { name: /approve/i })
      expect(approveButton).toBeInTheDocument()
    })
  })
})
