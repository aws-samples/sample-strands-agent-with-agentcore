import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImageRenderer } from '@/components/canvas/ImageRenderer'

describe('ImageRenderer Component', () => {
  describe('Image Path Generation', () => {
    it('should use backend API path when sessionId and toolUseId are provided', () => {
      render(
        <ImageRenderer
          imageId="test-image.png"
          sessionId="session-123"
          toolUseId="tool-456"
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute(
        'src',
        '/api/files/images/session-123/tool-456/test-image.png'
      )
    })

    it('should use fallback path when sessionId is missing', () => {
      render(
        <ImageRenderer
          imageId="test-image.png"
          toolUseId="tool-456"
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', '/output/test-image.png')
    })

    it('should use fallback path when toolUseId is missing', () => {
      render(
        <ImageRenderer
          imageId="test-image.png"
          sessionId="session-123"
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', '/output/test-image.png')
    })

    it('should use fallback path when both sessionId and toolUseId are missing', () => {
      render(<ImageRenderer imageId="test-image.png" />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', '/output/test-image.png')
    })
  })

  describe('Alt Text', () => {
    it('should use default alt text when not provided', () => {
      render(<ImageRenderer imageId="test-image.png" />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('alt', 'Generated Image')
    })

    it('should use provided alt text', () => {
      render(
        <ImageRenderer
          imageId="test-image.png"
          altText="Custom description"
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('alt', 'Custom description')
    })
  })

  describe('Loading State', () => {
    it('should show loading spinner initially', () => {
      render(<ImageRenderer imageId="test-image.png" />)

      expect(screen.getByText('Loading image...')).toBeInTheDocument()
    })

    it('should hide image while loading', () => {
      render(<ImageRenderer imageId="test-image.png" />)

      const img = screen.getByRole('img')
      expect(img).toHaveClass('hidden')
    })

    it('should show image after load', async () => {
      render(<ImageRenderer imageId="test-image.png" />)

      const img = screen.getByRole('img')
      fireEvent.load(img)

      await waitFor(() => {
        expect(img).toHaveClass('block')
        expect(img).not.toHaveClass('hidden')
      })
    })

    it('should hide loading spinner after image loads', async () => {
      render(<ImageRenderer imageId="test-image.png" />)

      const img = screen.getByRole('img')
      fireEvent.load(img)

      await waitFor(() => {
        expect(screen.queryByText('Loading image...')).not.toBeInTheDocument()
      })
    })

    it('should show caption after image loads', async () => {
      render(
        <ImageRenderer
          imageId="test-image.png"
          altText="Beautiful sunset"
        />
      )

      const img = screen.getByRole('img')
      fireEvent.load(img)

      await waitFor(() => {
        // Caption is shown as italic text after the image
        const caption = screen.getByText('Beautiful sunset')
        expect(caption).toHaveClass('italic')
      })
    })
  })

  describe('Error State', () => {
    it('should show error state when image fails to load', async () => {
      render(<ImageRenderer imageId="nonexistent.png" />)

      const img = screen.getByRole('img')
      fireEvent.error(img)

      await waitFor(() => {
        expect(screen.getByText('Image not available')).toBeInTheDocument()
      })
    })

    it('should show alt text in error state', async () => {
      render(
        <ImageRenderer
          imageId="nonexistent.png"
          altText="Failed image description"
        />
      )

      const img = screen.getByRole('img')
      fireEvent.error(img)

      await waitFor(() => {
        expect(screen.getByText('Failed image description')).toBeInTheDocument()
      })
    })

    it('should show image path in error state', async () => {
      render(
        <ImageRenderer
          imageId="missing.png"
          sessionId="session-abc"
          toolUseId="tool-xyz"
        />
      )

      const img = screen.getByRole('img')
      fireEvent.error(img)

      await waitFor(() => {
        expect(
          screen.getByText('Path: /api/files/images/session-abc/tool-xyz/missing.png')
        ).toBeInTheDocument()
      })
    })

    it('should not show loading spinner in error state', async () => {
      render(<ImageRenderer imageId="missing.png" />)

      const img = screen.getByRole('img')
      fireEvent.error(img)

      await waitFor(() => {
        expect(screen.queryByText('Loading image...')).not.toBeInTheDocument()
      })
    })
  })

  describe('Styling', () => {
    it('should have proper image styling', () => {
      render(<ImageRenderer imageId="test.png" />)

      const img = screen.getByRole('img')
      expect(img).toHaveClass('rounded-lg')
      expect(img).toHaveClass('shadow-md')
      expect(img).toHaveStyle({ maxHeight: '400px' })
    })

    it('should be centered in container', () => {
      const { container } = render(<ImageRenderer imageId="test.png" />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('text-center')
    })
  })
})
