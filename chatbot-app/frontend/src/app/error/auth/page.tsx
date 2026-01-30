'use client'

import { useSearchParams } from 'next/navigation'
import { AlertCircle, RefreshCw, Home, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getLoginUrl } from '@/lib/sso-auth'

/**
 * Authentication Error Page
 * 
 * Displays user-friendly error messages for authentication failures.
 * Provides options to retry login or contact support.
 */
export default function AuthErrorPage() {
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('code') || 'UNKNOWN_ERROR'
  const errorMessage = searchParams.get('message')

  const errorDetails = getErrorDetails(errorCode)

  const handleRetryLogin = () => {
    window.location.href = getLoginUrl()
  }

  const handleGoHome = () => {
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {errorDetails.title}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {errorMessage || errorDetails.description}
          </p>
        </div>

        {errorDetails.suggestion && (
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {errorDetails.suggestion}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button onClick={handleRetryLogin} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
          <Button variant="outline" onClick={handleGoHome} className="gap-2">
            <Home className="h-4 w-4" />
            Go Home
          </Button>
        </div>

        <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Need help?{' '}
            <a
              href="mailto:support@example.com"
              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              <Mail className="h-3 w-3" />
              Contact Support
            </a>
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">
            Error Code: {errorCode}
          </p>
        </div>
      </div>
    </div>
  )
}

interface ErrorDetails {
  title: string
  description: string
  suggestion?: string
}

function getErrorDetails(code: string): ErrorDetails {
  const errors: Record<string, ErrorDetails> = {
    AUTHENTICATION_FAILED: {
      title: 'Authentication Failed',
      description: 'We couldn\'t verify your identity. Please try signing in again.',
      suggestion: 'If this problem persists, contact your administrator.',
    },
    TOKEN_EXPIRED: {
      title: 'Session Expired',
      description: 'Your session has expired. Please sign in again to continue.',
    },
    INVALID_TOKEN: {
      title: 'Invalid Session',
      description: 'Your session is invalid. Please sign in again.',
      suggestion: 'Try clearing your browser cookies and signing in again.',
    },
    MISSING_AUTH_HEADERS: {
      title: 'Authentication Required',
      description: 'You need to sign in to access this page.',
    },
    SSO_ERROR: {
      title: 'SSO Error',
      description: 'There was a problem with single sign-on authentication.',
      suggestion: 'Please try again or contact your IT administrator.',
    },
    SAML_ERROR: {
      title: 'SAML Authentication Error',
      description: 'There was a problem processing your SAML authentication.',
      suggestion: 'Please try again or contact your IT administrator.',
    },
    UNKNOWN_ERROR: {
      title: 'Authentication Error',
      description: 'An unexpected error occurred during authentication.',
      suggestion: 'Please try again. If the problem persists, contact support.',
    },
  }

  return errors[code] || errors.UNKNOWN_ERROR
}
