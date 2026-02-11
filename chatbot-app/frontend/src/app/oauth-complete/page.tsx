'use client'

import { useEffect, useState, useRef } from 'react'

/**
 * OAuth Completion Page
 *
 * This page handles the callback after a user completes Google OAuth consent.
 * AgentCore redirects here with a session_id query parameter that we need to
 * use to complete the 3LO flow by calling CompleteResourceTokenAuth.
 *
 * Without this step, the token is never stored in Token Vault, causing an
 * infinite loop where the user is repeatedly asked for consent.
 */
export default function OAuthCompletePage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('Completing authorization...')
  const hasRun = useRef(false)

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    if (hasRun.current) return
    hasRun.current = true

    const completeOAuth = async () => {
      // Use window.location.search directly to avoid useSearchParams hydration issues
      const urlParams = new URLSearchParams(window.location.search)
      const sessionId = urlParams.get('session_id')

      console.log(`[OAuth] URL: ${window.location.href}`)
      console.log(`[OAuth] session_id: ${sessionId}`)

      if (!sessionId) {
        console.log('[OAuth] No session_id in URL')
        setStatus('error')
        setMessage('No session_id found in URL. Please try the authorization again.')
        return
      }

      // Check if this session_id was already processed (prevents duplicate API calls)
      const processedKey = `oauth_processed_${sessionId}`
      if (sessionStorage.getItem(processedKey)) {
        console.log('[OAuth] Session already processed, showing success')
        setStatus('success')
        setMessage('Authorization completed! This window will close automatically.')
        // Notify parent window
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(
              { type: 'oauth_elicitation_complete', sessionId },
              window.location.origin
            )
            window.opener.postMessage(
              { type: 'oauth_complete', sessionId, success: true },
              window.location.origin
            )
          } catch (e) {
            console.warn('[OAuth] Could not notify parent window:', e)
          }
        }
        setTimeout(() => window.close(), 2000)
        return
      }

      console.log(`[OAuth] Completing 3LO flow with session_id: ${sessionId}`)

      try {
        // Get auth token from localStorage (Cognito stores with complex key pattern)
        // Pattern: CognitoIdentityServiceProvider.{clientId}.{userId}.idToken
        let authToken = localStorage.getItem('authToken') || ''

        if (!authToken) {
          // Search for Cognito idToken in localStorage
          const cognitoTokenKey = Object.keys(localStorage).find(key => key.endsWith('.idToken'))
          if (cognitoTokenKey) {
            authToken = localStorage.getItem(cognitoTokenKey) || ''
            console.log(`[OAuth] Found Cognito token with key: ${cognitoTokenKey}`)
          }
        }
        console.log(`[OAuth] Auth token present: ${!!authToken}, length: ${authToken.length}`)

        const response = await fetch('/api/oauth/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authToken ? `Bearer ${authToken}` : ''
          },
          body: JSON.stringify({ session_id: sessionId })
        })

        console.log(`[OAuth] API response status: ${response.status}`)

        if (!response.ok) {
          const error = await response.json()
          console.error('[OAuth] API error:', error)
          throw new Error(error.details || error.error || 'Unknown error')
        }

        const result = await response.json()
        console.log('[OAuth] Flow completed successfully:', result)

        // Mark this session as processed to prevent duplicate calls
        sessionStorage.setItem(processedKey, 'true')

        setStatus('success')
        setMessage(result.message || 'Authorization completed! This window will close automatically.')

        // Notify parent window that OAuth is complete
        if (window.opener && !window.opener.closed) {
          try {
            // Signal elicitation-based flow (MCP elicit_url protocol)
            window.opener.postMessage(
              { type: 'oauth_elicitation_complete', sessionId },
              window.location.origin
            )
            // Also signal legacy flow for backward compatibility
            window.opener.postMessage(
              { type: 'oauth_elicitation_complete', sessionId },
              window.location.origin
            )
            window.opener.postMessage(
              { type: 'oauth_complete', sessionId, success: true },
              window.location.origin
            )
            console.log('[OAuth] Notified parent window of success (elicitation + legacy)')
          } catch (e) {
            console.warn('[OAuth] Could not notify parent window:', e)
          }
        }

        // Auto-close after a short delay
        setTimeout(() => {
          window.close()
        }, 2000)

      } catch (error) {
        console.error('[OAuth] Error completing flow:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)

        // "Invalid request" often means the session was already processed successfully
        // This can happen due to page refresh or double navigation
        if (errorMessage.includes('Invalid request') || errorMessage.includes('Invalid or expired session')) {
          console.log('[OAuth] Session likely already processed, treating as success')
          sessionStorage.setItem(processedKey, 'true')
          setStatus('success')
          setMessage('Authorization completed! This window will close automatically.')
          // Notify parent window
          if (window.opener && !window.opener.closed) {
            try {
              window.opener.postMessage(
                { type: 'oauth_complete', sessionId, success: true },
                window.location.origin
              )
            } catch (e) {
              console.warn('[OAuth] Could not notify parent window:', e)
            }
          }
          setTimeout(() => window.close(), 2000)
          return
        }

        setStatus('error')
        setMessage(`Authorization failed: ${errorMessage}`)
      }
    }

    completeOAuth()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-center">
        {status === 'loading' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Completing Authorization
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Please wait while we complete the connection to your Google account...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Authorization Successful
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {message}
            </p>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Your request will continue automatically.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              This window will close automatically...
            </p>
            <button
              onClick={() => window.close()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Close Window
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-red-500 text-5xl mb-4">✕</div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Authorization Failed
            </h1>
            <p className="text-red-600 dark:text-red-400 mb-4">
              {message}
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
              Please close this window and try again. If the problem persists, contact support.
            </p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  )
}
