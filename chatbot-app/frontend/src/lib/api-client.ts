/**
 * API Client - Centralized fetch wrapper with automatic authentication
 * Automatically adds Authorization header from Cognito session
 */

import { fetchAuthSession } from 'aws-amplify/auth'
import { getApiUrl } from '@/config/environment'

/**
 * Get Authorization header with Cognito JWT token
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession()
    const token = session.tokens?.accessToken?.toString()

    if (token) {
      return { 'Authorization': `Bearer ${token}` }
    }
  } catch (error) {
    // No auth session available (local dev or not authenticated)
    console.log('[API Client] No auth session available')
  }
  return {}
}

/**
 * Fetch wrapper with automatic authentication
 * Usage: apiFetch('tools', { method: 'GET' })
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get auth headers
  const authHeaders = await getAuthHeaders()

  // Merge headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
    ...(options.headers as Record<string, string> || {}),
  }

  // Build full URL
  const url = getApiUrl(endpoint)

  // Make request
  const response = await fetch(url, {
    ...options,
    headers,
  })

  return response
}

/**
 * Fetch JSON with automatic authentication
 * Usage: const data = await apiFetchJson('tools')
 */
export async function apiFetchJson<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiFetch(endpoint, options)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API request failed (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * POST JSON with automatic authentication
 * Usage: const data = await apiPost('tools/toggle', { toolId: 'calculator' })
 */
export async function apiPost<T = any>(
  endpoint: string,
  body?: any,
  options: RequestInit = {}
): Promise<T> {
  return apiFetchJson<T>(endpoint, {
    ...options,
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * PUT JSON with automatic authentication
 */
export async function apiPut<T = any>(
  endpoint: string,
  body?: any,
  options: RequestInit = {}
): Promise<T> {
  return apiFetchJson<T>(endpoint, {
    ...options,
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * DELETE with automatic authentication
 */
export async function apiDelete<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return apiFetchJson<T>(endpoint, {
    ...options,
    method: 'DELETE',
  })
}

/**
 * GET JSON with automatic authentication
 * Usage: const data = await apiGet<Tool[]>('tools')
 */
export async function apiGet<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return apiFetchJson<T>(endpoint, {
    ...options,
    method: 'GET',
  })
}
