import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Greeting, PromptSuggestions } from '@/components/Greeting'

describe('Greeting Component', () => {
  it('should render the greeting text', () => {
    render(<Greeting />)
    expect(screen.getByText('What can I help you build?')).toBeInTheDocument()
  })

  it('should have proper styling classes', () => {
    render(<Greeting />)

    const greetingElement = screen.getByText('What can I help you build?')
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

describe('PromptSuggestions Component', () => {
  it('should render all category chips', () => {
    render(<PromptSuggestions />)
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Automate')).toBeInTheDocument()
    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Manage')).toBeInTheDocument()
    expect(screen.getByText('Code')).toBeInTheDocument()
  })

  it('should show prompts panel when category is clicked', () => {
    render(<PromptSuggestions />)
    fireEvent.click(screen.getByText('Search'))
    expect(screen.getByText('Search the web for the latest AI news and summarize key highlights')).toBeInTheDocument()
  })

  it('should hide prompts panel when same category is clicked again', () => {
    render(<PromptSuggestions />)
    const searchButton = screen.getByRole('button', { name: /Search/i })
    fireEvent.click(searchButton)
    fireEvent.click(searchButton)
    expect(screen.queryByText('Search the web for the latest AI news and summarize key highlights')).not.toBeInTheDocument()
  })

  it('should call onSelectPrompt when a prompt is clicked', () => {
    const onSelectPrompt = vi.fn()
    render(<PromptSuggestions onSelectPrompt={onSelectPrompt} />)
    fireEvent.click(screen.getByText('Code'))
    fireEvent.click(screen.getByText('Build a To-Do web app with React and Tailwind CSS'))
    expect(onSelectPrompt).toHaveBeenCalledWith('Build a To-Do web app with React and Tailwind CSS')
  })
})
