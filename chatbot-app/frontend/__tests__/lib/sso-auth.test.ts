/**
 * Tests for SSO authentication utilities
 */

import { NextRequest } from 'next/server'
import {
  getAuthenticatedUser,
  requireAuth,
  isPublicPath,
  getCorrelationId,
  AuthenticationError,
  withAuth,
  isSSOEnabled,
} from '@/lib/sso-auth'

// Helper to create mock NextRequest
function createMockRequest(
  headers: Record<string, string> = {},
  path: string = '/api/test'
): NextRequest {
  const url = new URL(path, 'http://localhost:3000')
  const request = new NextRequest(url, {
    headers: new Headers(headers),
  })
  return request
}

describe('getAuthenticatedUser', () => {
  it('should return user when all required headers are present', () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
      'X-User-Sub': 'user-123',
      'X-User-Name': 'Test User',
    })

    const user = getAuthenticatedUser(request)

    expect(user).not.toBeNull()
    expect(user?.email).toBe('test@example.com')
    expect(user?.sub).toBe('user-123')
    expect(user?.name).toBe('Test User')
  })

  it('should return null when email header is missing', () => {
    const request = createMockRequest({
      'X-User-Sub': 'user-123',
    })

    const user = getAuthenticatedUser(request)

    expect(user).toBeNull()
  })

  it('should return null when sub header is missing', () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
    })

    const user = getAuthenticatedUser(request)

    expect(user).toBeNull()
  })

  it('should use email as name when name header is missing', () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
      'X-User-Sub': 'user-123',
    })

    const user = getAuthenticatedUser(request)

    expect(user?.name).toBe('test@example.com')
  })

  it('should parse groups from header', () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
      'X-User-Sub': 'user-123',
      'X-User-Groups': 'admin, users, developers',
    })

    const user = getAuthenticatedUser(request)

    expect(user?.groups).toEqual(['admin', 'users', 'developers'])
  })

  it('should return undefined groups when header is missing', () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
      'X-User-Sub': 'user-123',
    })

    const user = getAuthenticatedUser(request)

    expect(user?.groups).toBeUndefined()
  })
})

describe('requireAuth', () => {
  it('should return user when authenticated', () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
      'X-User-Sub': 'user-123',
    })

    const user = requireAuth(request)

    expect(user.email).toBe('test@example.com')
    expect(user.sub).toBe('user-123')
  })

  it('should throw AuthenticationError when not authenticated', () => {
    const request = createMockRequest({})

    expect(() => requireAuth(request)).toThrow(AuthenticationError)
  })

  it('should throw with correct error code', () => {
    const request = createMockRequest({})

    try {
      requireAuth(request)
      fail('Expected AuthenticationError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AuthenticationError)
      expect((error as AuthenticationError).code).toBe('MISSING_AUTH_HEADERS')
      expect((error as AuthenticationError).statusCode).toBe(401)
    }
  })
})

describe('isPublicPath', () => {
  it('should return true for health endpoint', () => {
    expect(isPublicPath('/health')).toBe(true)
    expect(isPublicPath('/api/health')).toBe(true)
  })

  it('should return true for Next.js static files', () => {
    expect(isPublicPath('/_next/static/chunks/main.js')).toBe(true)
    expect(isPublicPath('/_next/image')).toBe(true)
  })

  it('should return true for favicon', () => {
    expect(isPublicPath('/favicon.ico')).toBe(true)
    expect(isPublicPath('/favicon.png')).toBe(true)
  })

  it('should return false for protected paths', () => {
    expect(isPublicPath('/api/chat')).toBe(false)
    expect(isPublicPath('/dashboard')).toBe(false)
    expect(isPublicPath('/')).toBe(false)
  })
})

describe('getCorrelationId', () => {
  it('should return existing correlation ID from header', () => {
    const request = createMockRequest({
      'X-Correlation-ID': 'existing-id-123',
    })

    const correlationId = getCorrelationId(request)

    expect(correlationId).toBe('existing-id-123')
  })

  it('should generate new correlation ID when header is missing', () => {
    const request = createMockRequest({})

    const correlationId = getCorrelationId(request)

    expect(correlationId).toBeDefined()
    expect(correlationId.length).toBeGreaterThan(0)
    // UUID format check
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })
})

describe('withAuth', () => {
  it('should call handler with user when authenticated', async () => {
    const request = createMockRequest({
      'X-User-Email': 'test@example.com',
      'X-User-Sub': 'user-123',
    })

    const handler = vi.fn().mockResolvedValue(Response.json({ success: true }))
    const wrappedHandler = withAuth(handler)

    await wrappedHandler(request)

    expect(handler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        email: 'test@example.com',
        sub: 'user-123',
      })
    )
  })

  it('should return 401 response when not authenticated', async () => {
    const request = createMockRequest({})

    const handler = vi.fn()
    const wrappedHandler = withAuth(handler)

    const response = await wrappedHandler(request)

    expect(handler).not.toHaveBeenCalled()
    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(401)
  })
})

describe('AuthenticationError', () => {
  it('should have correct properties', () => {
    const error = new AuthenticationError('Test error', 'TEST_CODE', 403)

    expect(error.message).toBe('Test error')
    expect(error.code).toBe('TEST_CODE')
    expect(error.statusCode).toBe(403)
    expect(error.name).toBe('AuthenticationError')
  })

  it('should use default values', () => {
    const error = new AuthenticationError('Test error')

    expect(error.code).toBe('AUTHENTICATION_FAILED')
    expect(error.statusCode).toBe(401)
  })
})

describe('isSSOEnabled', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('should return true when SSO is enabled', () => {
    process.env.NEXT_PUBLIC_SSO_ENABLED = 'true'
    expect(isSSOEnabled()).toBe(true)
  })

  it('should return false when SSO is disabled', () => {
    process.env.NEXT_PUBLIC_SSO_ENABLED = 'false'
    expect(isSSOEnabled()).toBe(false)
  })

  it('should return false when env var is not set', () => {
    delete process.env.NEXT_PUBLIC_SSO_ENABLED
    expect(isSSOEnabled()).toBe(false)
  })
})
