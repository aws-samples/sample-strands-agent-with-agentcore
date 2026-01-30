'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * OAuth2 ID Provider Response Handler
 * 
 * Handles both OAuth2 flows from Cognito:
 * 1. Authorization Code Flow: /oauth2/idpresponse?code=xxx&state=xxx
 * 2. Implicit Flow: /oauth2/idpresponse#id_token=xxx&access_token=xxx
 */

const COGNITO_DOMAIN = 'chatbot-dev-53882568.auth.eu-west-1.amazoncognito.com';
const CLIENT_ID = '37osr3ctqscb4m33gqqdlc8i4v';
const REDIRECT_URI = 'https://d1ystqalgm445b.cloudfront.net/oauth2/idpresponse';

export default function OAuth2IdpResponse() {
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const processAuth = async () => {
      try {
        // Get query params from window.location (client-side only)
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        
        console.log('OAuth callback - code:', code ? 'present' : 'missing');
        console.log('OAuth callback - search:', window.location.search);
        console.log('OAuth callback - hash:', window.location.hash);
        
        if (code) {
          await exchangeCodeForTokens(code, state);
          return;
        }

        // Check for tokens in URL fragment (implicit flow)
        const hash = window.location.hash.substring(1);
        if (hash) {
          processImplicitFlowTokens(hash);
          return;
        }

        setStatus('error');
        setErrorMessage('No authentication data received');
      } catch (err) {
        console.error('Error processing OAuth:', err);
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Authentication failed');
      }
    };

    async function exchangeCodeForTokens(code: string, state: string | null) {
      console.log('Exchanging code for tokens...');
      const tokenEndpoint = `https://${COGNITO_DOMAIN}/oauth2/token`;
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: code,
        redirect_uri: REDIRECT_URI,
      });

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      console.log('Token response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange error:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        throw new Error(errorData.error_description || errorData.error || 'Token exchange failed');
      }

      const tokens = await response.json();
      console.log('Tokens received successfully');
      storeTokens(tokens.id_token, tokens.access_token, tokens.expires_in || 3600);
      setStatus('success');
      
      const redirectPath = state ? decodeURIComponent(state) : '/';
      setTimeout(() => router.push(redirectPath), 500);
    }

    function processImplicitFlowTokens(hash: string) {
      const params = new URLSearchParams(hash);
      const error = params.get('error');
      if (error) {
        setStatus('error');
        setErrorMessage(params.get('error_description') || error);
        return;
      }

      const idToken = params.get('id_token');
      if (!idToken) {
        setStatus('error');
        setErrorMessage('No ID token received');
        return;
      }

      const expiresIn = params.get('expires_in');
      storeTokens(idToken, params.get('access_token'), expiresIn ? parseInt(expiresIn) : 3600);
      setStatus('success');
      
      const state = params.get('state');
      setTimeout(() => router.push(state ? decodeURIComponent(state) : '/'), 500);
    }

    function storeTokens(idToken: string, accessToken: string | null, expiresIn: number) {
      const expires = new Date(Date.now() + expiresIn * 1000).toUTCString();
      document.cookie = `id_token=${idToken}; path=/; expires=${expires}; SameSite=Lax; Secure`;
      if (accessToken) {
        document.cookie = `access_token=${accessToken}; path=/; expires=${expires}; SameSite=Lax; Secure`;
      }
    }

    processAuth();
  }, [mounted, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          {status === 'processing' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Completing sign in...</h2>
              <p className="mt-2 text-gray-600 dark:text-gray-400">Please wait while we complete your authentication.</p>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-4">
                <svg className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Sign in successful!</h2>
              <p className="mt-2 text-gray-600 dark:text-gray-400">Redirecting you now...</p>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto mb-4">
                <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Sign in failed</h2>
              <p className="mt-2 text-gray-600 dark:text-gray-400">{errorMessage}</p>
              <button onClick={() => window.location.href = '/'} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Try again</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
