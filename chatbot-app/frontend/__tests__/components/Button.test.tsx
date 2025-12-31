import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button Component', () => {
  describe('Rendering', () => {
    it('should render with children text', () => {
      render(<Button>Click me</Button>)

      expect(screen.getByRole('button')).toHaveTextContent('Click me')
    })

    it('should render as button element by default', () => {
      render(<Button>Test</Button>)

      expect(screen.getByRole('button').tagName).toBe('BUTTON')
    })

    it('should render with custom className', () => {
      render(<Button className="custom-class">Test</Button>)

      expect(screen.getByRole('button')).toHaveClass('custom-class')
    })
  })

  describe('Variants', () => {
    it('should apply default variant styles', () => {
      render(<Button>Default</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-primary')
      expect(button).toHaveClass('text-primary-foreground')
    })

    it('should apply destructive variant styles', () => {
      render(<Button variant="destructive">Destructive</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-destructive')
      expect(button).toHaveClass('text-destructive-foreground')
    })

    it('should apply outline variant styles', () => {
      render(<Button variant="outline">Outline</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('border')
      expect(button).toHaveClass('border-input')
      expect(button).toHaveClass('bg-background')
    })

    it('should apply secondary variant styles', () => {
      render(<Button variant="secondary">Secondary</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-secondary')
      expect(button).toHaveClass('text-secondary-foreground')
    })

    it('should apply ghost variant styles', () => {
      render(<Button variant="ghost">Ghost</Button>)

      const button = screen.getByRole('button')
      // Ghost has hover states, but base should not have bg-primary
      expect(button).not.toHaveClass('bg-primary')
    })

    it('should apply link variant styles', () => {
      render(<Button variant="link">Link</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-primary')
      expect(button).toHaveClass('underline-offset-4')
    })
  })

  describe('Sizes', () => {
    it('should apply default size', () => {
      render(<Button>Default Size</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-10')
      expect(button).toHaveClass('px-4')
      expect(button).toHaveClass('py-2')
    })

    it('should apply small size', () => {
      render(<Button size="sm">Small</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-9')
      expect(button).toHaveClass('px-3')
    })

    it('should apply large size', () => {
      render(<Button size="lg">Large</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-11')
      expect(button).toHaveClass('px-8')
    })

    it('should apply icon size', () => {
      render(<Button size="icon">🔍</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-10')
      expect(button).toHaveClass('w-10')
    })
  })

  describe('Interactions', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click</Button>)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick} disabled>Click</Button>)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('should apply disabled styles', () => {
      render(<Button disabled>Disabled</Button>)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('disabled:opacity-50')
      expect(button).toHaveClass('disabled:pointer-events-none')
    })
  })

  describe('Accessibility', () => {
    it('should support type attribute', () => {
      render(<Button type="submit">Submit</Button>)

      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('should support aria-label', () => {
      render(<Button aria-label="Close dialog">X</Button>)

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close dialog')
    })

    it('should have focus visible styles', () => {
      render(<Button>Focus Test</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('focus-visible:outline-none')
      expect(button).toHaveClass('focus-visible:ring-2')
      expect(button).toHaveClass('focus-visible:ring-ring')
    })
  })

  describe('asChild prop', () => {
    it('should render as slot when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      )

      // When asChild is true, the child element becomes the rendered element
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/test')
      expect(link).toHaveTextContent('Link Button')
    })
  })

  describe('Combined props', () => {
    it('should apply multiple variants and sizes together', () => {
      render(
        <Button variant="outline" size="lg" className="extra-class">
          Combined
        </Button>
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('border')
      expect(button).toHaveClass('h-11')
      expect(button).toHaveClass('extra-class')
    })
  })
})
