import { useState, useEffect } from 'react';

interface BrowserSession {
  sessionId: string | null;
  browserId: string | null;
  liveViewUrl?: string; // Presigned WSS URL from tool metadata
}

interface ValidationResult {
  isValid: boolean;
  isLoading: boolean;
}

/**
 * Hook to validate browser session status
 *
 * Workflow:
 * 1. Receives browserSession from parent (already in React state)
 * 2. Validates with backend API that session is still READY
 * 3. Returns validation result
 *
 * @param chatSessionId - Current chat session ID
 * @param browserSession - Browser session from useChat state
 * @returns ValidationResult with isValid and isLoading
 */
export function useBrowserSessionValidation(
  chatSessionId: string | null,
  browserSession: BrowserSession | null
): ValidationResult {
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    async function validateSession() {
      // Don't reset state immediately - keep previous validation status until new result
      // This prevents button from flickering on/off during re-validation

      if (!chatSessionId || !browserSession) {
        setIsValid(false);
        return;
      }

      if (!browserSession.sessionId) {
        console.warn('[useBrowserSessionValidation] Invalid browser session - no sessionId:', browserSession);
        setIsValid(false);
        return;
      }

      // browserId is optional - AgentCore browser sessions may not have separate browserId
      // In that case, we use environment variable BROWSER_ID on the server side

      // Note: URL expiration check removed - BFF generates fresh URLs on-demand
      try {
        // Validate with backend API that session is still READY
        setIsLoading(true);

        // Build URL with optional browserId (only include if present)
        let validateUrl = `/api/browser/validate-session?sessionId=${encodeURIComponent(browserSession.sessionId)}`;
        if (browserSession.browserId) {
          validateUrl += `&browserId=${encodeURIComponent(browserSession.browserId)}`;
        }

        const response = await fetch(validateUrl);

        const data = await response.json();

        if (data.isValid) {
          // Session is READY and URL is fresh
          console.log('[useBrowserSessionValidation] Session is valid:', browserSession.sessionId);
          setIsValid(true);
        } else {
          // Session is not valid (TERMINATED or error)
          console.log('[useBrowserSessionValidation] Session not valid:', data.status || data.error);
          setIsValid(false);
        }
      } catch (error) {
        console.error('[useBrowserSessionValidation] Validation failed:', error);
        setIsValid(false);
      } finally {
        setIsLoading(false);
      }
    }

    validateSession();
  }, [chatSessionId, browserSession?.sessionId, browserSession?.browserId]);

  return { isValid, isLoading };
}
