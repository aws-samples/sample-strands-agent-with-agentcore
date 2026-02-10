import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Greeting } from '@/components/Greeting'

describe('Greeting Component', () => {
  it('should render the greeting text', () => {
    render(<Greeting />)
    expect(screen.getByText('Define the agent you need')).toBeInTheDocument()
  })

  it('should have proper styling classes', () => {
    render(<Greeting />)

    const greetingElement = screen.getByText('Define the agent you need')
    expect(greetingElement).toHaveClass('bg-gradient-to-r')
    expect(greetingElement).toHaveClass('bg-clip-text')
    expect(greetingElement).toHaveClass('text-transparent')
  })

  it('should render within centered container', () => {
    const { container } = render(<Greeting />)

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv).toHaveClass('flex')
    expect(outerDiv).toHaveClass('justify-center')
    expect(outerDiv).toHaveClass('items-center')
  })
})
