import { fetchAuthSession } from 'aws-amplify/auth'
import { API_BASE_URL } from './constants'

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    let session = await fetchAuthSession()
    let idToken = session.tokens?.idToken?.toString()

    if (!idToken) {
      session = await fetchAuthSession({ forceRefresh: true })
      idToken = session.tokens?.idToken?.toString()
    }

    if (idToken) return { Authorization: `Bearer ${idToken}` }
  } catch {
    // Not authenticated — return empty headers (BFF will 401)
  }
  return {}
}

export async function apiGet<T>(path: string, extra?: Record<string, string>): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...(extra ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET ${path} → ${res.status}${text ? ': ' + text : ''}`)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  extra?: Record<string, string>,
): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(extra ?? {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST ${path} → ${res.status}${text ? ': ' + text : ''}`)
  }
  return res.json() as Promise<T>
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PUT ${path} → ${res.status}${text ? ': ' + text : ''}`)
  }
  return res.json() as Promise<T>
}

export async function apiDelete<T>(path: string): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
  })
  if (!res.ok) {
    throw new Error(`DELETE ${path} → ${res.status}`)
  }
  return res.json() as Promise<T>
}

/**
 * Opens a POST SSE stream. Returns the raw Response so the caller
 * can call response.body and pass it to parseSSEStream().
 */
export async function apiStreamPost(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders,
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`STREAM ${path} → ${res.status}${text ? ': ' + text : ''}`)
  }
  return res
}
