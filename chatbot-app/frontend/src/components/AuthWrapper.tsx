'use client';

/**
 * AuthWrapper - SSO-Only Authentication
 * 
 * This wrapper no longer uses Amplify Authenticator since authentication
 * is handled entirely by:
 * 1. AWS IAM Identity Center (SSO)
 * 2. Cognito User Pool (as SAML SP)
 * 3. Lambda@Edge (JWT validation and header injection)
 * 
 * The wrapper now simply passes through children and optionally
 * initializes Amplify for API calls that need auth tokens.
 */

import { useEffect } from 'react';

export default function AuthWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize Amplify config for API calls (token management)
  // but don't block rendering or show any login UI
  useEffect(() => {
    const isLocalDev = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    // Only load Amplify config in production for token management
    if (!isLocalDev && process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID) {
      import('../lib/amplify-config').catch(() => {
        // Amplify config failed - non-critical for SSO flow
        console.warn('[AuthWrapper] Amplify config failed to load');
      });
    }
  }, []);

  // SSO authentication is handled by Lambda@Edge
  // Just render children directly - no login UI needed
  return <>{children}</>;
}