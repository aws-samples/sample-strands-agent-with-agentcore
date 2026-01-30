'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthenticationError } from '@/lib/sso-auth'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  isAuthError: boolean
}

/**
 * Error Boundary for Authentication Errors
 * 
 * Catches authentication-related errors and displays a user-friendly
 * error page with options to retry or navigate away.
 */
export class AuthErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      isAuthError: false,
    }
  }

  static getDerivedStateFromError(error: Error): State {
    const isAuthError = error instanceof AuthenticationError ||
      error.name === 'AuthenticationError' ||
      error.message.toLowerCase().includes('authentication') ||
      error.message.toLowerCase().includes('unauthorized')

    return {
      hasError: true,
      error,
      isAuthError,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AuthErrorBoundary] Caught error:', error, errorInfo)

    // Log to monitoring service if available
    if (typeof window !== 'undefined' && (window as any).errorReporter) {
      (window as any).errorReporter.captureException(error, {
        extra: {
          componentStack: errorInfo.componentStack,
          isAuthError: this.state.isAuthError,
        },
      })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, isAuthError: false })
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  handleLogin = () => {
    // Redirect to login page
    window.location.href = '/api/auth/login'
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, isAuthError } = this.state

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <div className="max-w-md w-full space-y-6 text-center">
            <div className="flex justify-center">
              <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-3">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {isAuthError ? 'Authentication Error' : 'Something went wrong'}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                {isAuthError
                  ? 'There was a problem with your authentication. Please try signing in again.'
                  : 'An unexpected error occurred. Please try again.'}
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && error && (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-left">
                <p className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                  {error.message}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              {isAuthError ? (
                <Button onClick={this.handleLogin} className="gap-2">
                  Sign In
                </Button>
              ) : (
                <Button onClick={this.handleRetry} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
              )}
              <Button variant="outline" onClick={this.handleGoHome} className="gap-2">
                <Home className="h-4 w-4" />
                Go Home
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default AuthErrorBoundary
