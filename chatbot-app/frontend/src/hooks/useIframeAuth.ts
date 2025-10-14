import { useEffect, useState } from 'react';
import { getCurrentUser, AuthUser } from 'aws-amplify/auth';

// Check if Cognito is configured
const hasCognitoConfig = !!(process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID &&
                           process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID);

// Check if we're in local development
const isLocalDev = typeof window !== 'undefined' && 
  (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1');

interface IframeAuthState {
  isInIframe: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Custom hook to handle authentication state in iframe context
 * Provides additional checks and handling for embedded scenarios
 */
export function useIframeAuth(): IframeAuthState {
  const [state, setState] = useState<IframeAuthState>({
    isInIframe: false,
    isAuthenticated: false,
    user: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    const checkAuthState = async () => {
      try {
        // Check if we're in an iframe - only on client side
        const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
        
        // Check if we're in local development (client-side check)
        const localDev = typeof window !== 'undefined' && 
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        
        let user = null;
        let isAuthenticated = false;
        
        // Only try to get current user if Cognito is configured and not in local dev
        if (hasCognitoConfig && !localDev) {
          try {
            user = await getCurrentUser();
            isAuthenticated = !!user;
          } catch (authError) {
            // Authentication failed, but that's okay - user is just not logged in
            console.log('User not authenticated:', authError);
            isAuthenticated = false;
            user = null;
          }
        } else {
          // In local dev or without Cognito config, consider user as "authenticated" for testing
          isAuthenticated = localDev;
        }
        
        if (mounted) {
          setState({
            isInIframe,
            isAuthenticated,
            user,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        if (mounted) {
          // Ensure we still update isInIframe even on error
          const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
          setState(prev => ({
            ...prev,
            isInIframe,
            isAuthenticated: false,
            user: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Authentication error',
          }));
        }
      }
    };

    // Only run on client side to avoid hydration mismatch
    checkAuthState();

    // Set up periodic auth state checks for iframe context
    const interval = setInterval(checkAuthState, 30000); // Check every 30 seconds

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}

/**
 * Utility function to post authentication status to parent window
 * Useful for parent pages that need to know about auth state
 */
export function postAuthStatusToParent(isAuthenticated: boolean, user?: AuthUser | null) {
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({
        type: 'CHATBOT_AUTH_STATUS',
        payload: {
          isAuthenticated,
          userId: user?.userId || null,
          timestamp: Date.now(),
        }
      }, '*');
    } catch (error) {
      console.warn('Failed to post auth status to parent:', error);
    }
  }
}

/**
 * Utility function to handle authentication errors in iframe context
 */
export function handleIframeAuthError(error: Error): void {
  console.error('Iframe authentication error:', error);
  
  // Post error to parent window if available
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({
        type: 'CHATBOT_AUTH_ERROR',
        payload: {
          error: error.message,
          timestamp: Date.now(),
        }
      }, '*');
    } catch (postError) {
      console.warn('Failed to post auth error to parent:', postError);
    }
  }
}