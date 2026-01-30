'use client'

import { Clock, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getLoginUrl } from '@/lib/sso-auth'

/**
 * Session Expired Page
 * 
 * Displayed when a user's session has timed out.
 * Provides a clear path to re-authenticate.
 */
export default function SessionExpiredPage() {
  const handleSignIn = () => {
    // Store current URL to redirect back after login
    const returnUrl = typeof window !== 'undefined' ? window.location.pathname : '/'
    window.location.href = getLoginUrl(returnUrl)
  }

  const handleGoHome = () => {
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-4">
            <Clock className="h-12 w-12 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Session Expired
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Your session has expired due to inactivity. Please sign in again to continue.
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            For your security, sessions automatically expire after a period of inactivity.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button onClick={handleSignIn} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Sign In Again
          </Button>
          <Button variant="outline" onClick={handleGoHome} className="gap-2">
            <Home className="h-4 w-4" />
            Go Home
          </Button>
        </div>
      </div>
    </div>
  )
}
