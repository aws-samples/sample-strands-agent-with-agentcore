import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Greeting } from '@/components/Greeting'

// Mock Math.random to get predictable greeting
const mockMathRandom = vi.spyOn(Math, 'random')

describe('Greeting Component', () => {
  beforeEach(() => {
    mockMathRandom.mockReset()
  })

  it('should render a greeting from the list', async () => {
    // Mock to return first greeting (index 0)
    mockMathRandom.mockReturnValue(0)

    render(<Greeting />)

    await waitFor(() => {
      expect(screen.getByText('Hello, creator')).toBeInTheDocument()
    })
  })

  it('should render different greeting based on random value', async () => {
    // Mock to return index 1 (0.2 * 5 = 1)
    mockMathRandom.mockReturnValue(0.2)

    render(<Greeting />)

    await waitFor(() => {
      expect(screen.getByText('Ready to build?')).toBeInTheDocument()
    })
  })

  it('should render "Your AI companion" for index 2', async () => {
    // Mock to return index 2 (0.4 * 5 = 2)
    mockMathRandom.mockReturnValue(0.4)

    render(<Greeting />)

    await waitFor(() => {
      expect(screen.getByText('Your AI companion')).toBeInTheDocument()
    })
  })

  it('should render "Let\'s explore" for index 3', async () => {
    // Mock to return index 3 (0.6 * 5 = 3)
    mockMathRandom.mockReturnValue(0.6)

    render(<Greeting />)

    await waitFor(() => {
      expect(screen.getByText("Let's explore")).toBeInTheDocument()
    })
  })

  it('should render "Ideas welcome" for index 4', async () => {
    // Mock to return index 4 (0.8 * 5 = 4)
    mockMathRandom.mockReturnValue(0.8)

    render(<Greeting />)

    await waitFor(() => {
      expect(screen.getByText('Ideas welcome')).toBeInTheDocument()
    })
  })

  it('should have proper styling classes', async () => {
    mockMathRandom.mockReturnValue(0)

    render(<Greeting />)

    await waitFor(() => {
      const greetingElement = screen.getByText('Hello, creator')
      expect(greetingElement).toHaveClass('bg-gradient-to-r')
      expect(greetingElement).toHaveClass('bg-clip-text')
      expect(greetingElement).toHaveClass('text-transparent')
    })
  })

  it('should render within centered container', () => {
    mockMathRandom.mockReturnValue(0)

    const { container } = render(<Greeting />)

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv).toHaveClass('flex')
    expect(outerDiv).toHaveClass('justify-center')
    expect(outerDiv).toHaveClass('items-center')
  })
})
