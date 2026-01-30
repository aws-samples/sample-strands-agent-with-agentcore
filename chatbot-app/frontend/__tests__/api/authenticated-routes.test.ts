/**
 * Tests for authenticated API routes
 * 
 * Tests cover:
 * - SSO header extraction in API routes
 * - User context propagation
 * - Error handling for unauthenticated requests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractUserFromRequest, isSSOEnabled } from '@/lib/auth-utils'

// Helper to create a mock Request with headers
function createMockRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null
    }
  } as unknown as Request
}

// Helper to create a mock JWT token
function createMockJWT(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64')
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64')
  const signature = 'mock-signature'
  return `${header}.${payloadStr}.${signature}`
}

describe('Authenticated API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('SSO Header Authentication', () => {
    it('should extract user from SSO headers in API routes', () => {
      const request = createMockRequest({
        'x-user-email': 'api-user@example.com',
        'x-user-sub': 'api-user-uuid',
        'x-user-name': 'API User',
      })

      const user = extractUserFromRequest(request)

      expect(user.userId).toBe('api-user-uuid')
      expect(user.email).toBe('api-user@example.com')
      expect(user.name).toBe('API User')
    })

    it('should handle API routes with groups', () => {
      const request = createMockRequest({
        'x-user-email': 'admin@example.com',
        'x-user-sub': 'admin-uuid',
        'x-user-groups': 'admin,api-users,developers',
      })

      const user = extractUserFromRequest(request)

      expect(user.groups).toEqual(['admin', 'api-users', 'developers'])
    })

    it('should return anonymous for API routes without auth headers', () => {
      const request = createMockRequest({})

      const user = extractUserFromRequest(request)

      expect(user.userId).toBe('anonymous')
    })
  })

  describe('JWT Token Authentication Fallback', () => {
    it('should fall back to JWT when SSO headers are missing', () => {
      const token = createMockJWT({
        sub: 'jwt-api-user',
        email: 'jwt@example.com',
        name: 'JWT User',
      })
      const request = createMockRequest({
        authorization: `Bearer ${token}`,
      })

      const user = extractUserFromRequest(request)

      expect(user.userId).toBe('jwt-api-user')
      expect(user.email).toBe('jwt@example.com')
    })

    it('should prioritize SSO headers over JWT in API routes', () => {
      const token = createMockJWT({
        sub: 'jwt-user',
        email: 'jwt@example.com',
      })
      const request = createMockRequest({
        'x-user-email': 'sso@example.com',
        'x-user-sub': 'sso-user',
        authorization: `Bearer ${token}`,
      })

      const user = extractUserFromRequest(request)

      // SSO headers should take precedence
      expect(user.userId).toBe('sso-user')
      expect(user.email).toBe('sso@example.com')
    })
  })

  describe('User Context in API Routes', () => {
    it('should provide complete user context for authenticated requests', () => {
      const request = createMockRequest({
        'x-user-email': 'complete@example.com',
        'x-user-sub': 'complete-user-uuid',
        'x-user-name': 'Complete User',
        'x-user-groups': 'users,premium',
      })

      const user = extractUserFromRequest(request)

      expect(user).toEqual({
        userId: 'complete-user-uuid',
        email: 'complete@example.com',
        username: 'complete@example.com',
        name: 'Complete User',
        groups: ['users', 'premium'],
      })
    })

    it('should use email as name when name header is missing', () => {
      const request = createMockRequest({
        'x-user-email': 'noname@example.com',
        'x-user-sub': 'noname-uuid',
      })

      const user = extractUserFromRequest(request)

      expect(user.name).toBe('noname@example.com')
    })
  })

  describe('Error Handling', () => {
    it('should handle malformed SSO headers gracefully', () => {
      const request = createMockRequest({
        'x-user-email': '', // Empty email
        'x-user-sub': 'user-uuid',
      })

      const user = extractUserFromRequest(request)

      // Should fall back to anonymous since email is required
      expect(user.userId).toBe('anonymous')
    })

    it('should handle missing sub header', () => {
      const request = createMockRequest({
        'x-user-email': 'email@example.com',
        // Missing x-user-sub
      })

      const user = extractUserFromRequest(request)

      expect(user.userId).toBe('anonymous')
    })
  })

  describe('SSO Configuration', () => {
    const originalEnv = process.env

    beforeEach(() => {
      vi.resetModules()
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should detect SSO enabled state', () => {
      process.env.NEXT_PUBLIC_SSO_ENABLED = 'true'
      expect(isSSOEnabled()).toBe(true)
    })

    it('should detect SSO disabled state', () => {
      process.env.NEXT_PUBLIC_SSO_ENABLED = 'false'
      expect(isSSOEnabled()).toBe(false)
    })
  })
})
