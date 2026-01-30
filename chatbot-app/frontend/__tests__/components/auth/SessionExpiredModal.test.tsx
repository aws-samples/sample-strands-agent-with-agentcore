/**
 * Tests for SessionExpiredModal component
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionExpiredModal } from '@/components/auth/SessionExpiredModal'

// Mock the sso-auth module
vi.mock('@/lib/sso-auth', () => ({
  getLoginUrl: vi.fn((returnUrl?: string) => 
    returnUrl ? `/login?return=${returnUrl}` : '/login'
  ),
}))

// Mock window.location
const mockLocation = {
  href: '',
  pathname: '/current-page',
}
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
})

describe('SessionExpiredModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocation.href = ''
    mockLocation.pathname = '/current-page'
  })

  it('should not render when isOpen is false', () => {
    render(<SessionExpiredModal isOpen={false} />)
    
    expect(screen.queryByText('Session Expired')).not.toBeInTheDocument()
  })

  it('should render when isOpen is true', () => {
    render(<SessionExpiredModal isOpen={true} />)
    
    expect(screen.getByText('Session Expired')).toBeInTheDocument()
  })

  it('should display default message', () => {
    render(<SessionExpiredModal isOpen={true} />)
    
    expect(screen.getByText(/Your session has expired/)).toBeInTheDocument()
  })

  it('should display custom message', () => {
    const customMessage = 'Custom expiration message'
    render(<SessionExpiredModal isOpen={true} message={customMessage} />)
    
    expect(screen.getByText(customMessage)).toBeInTheDocument()
  })

  it('should have a login button', () => {
    render(<SessionExpiredModal isOpen={true} />)
    
    expect(screen.getByRole('button', { name: /log in again/i })).toBeInTheDocument()
  })

  it('should redirect to login when button is clicked', () => {
    render(<SessionExpiredModal isOpen={true} />)
    
    const loginButton = screen.getByRole('button', { name: /log in again/i })
    fireEvent.click(loginButton)
    
    expect(mockLocation.href).toContain('/login')
  })

  it('should include return URL when provided', () => {
    render(<SessionExpiredModal isOpen={true} returnUrl="/dashboard" />)
    
    const loginButton = screen.getByRole('button', { name: /log in again/i })
    fireEvent.click(loginButton)
    
    expect(mockLocation.href).toContain('/dashboard')
  })

  it('should use current pathname as return URL when not provided', () => {
    mockLocation.pathname = '/my-page'
    render(<SessionExpiredModal isOpen={true} />)
    
    const loginButton = screen.getByRole('button', { name: /log in again/i })
    fireEvent.click(loginButton)
    
    expect(mockLocation.href).toContain('/my-page')
  })

  it('should have backdrop overlay', () => {
    render(<SessionExpiredModal isOpen={true} />)
    
    // Check for backdrop element
    const backdrop = document.querySelector('.bg-black\\/50')
    expect(backdrop).toBeInTheDocument()
  })
})
