'use client'

import { useSearchParams } from 'next/navigation'
import { ShieldX, Home, Mail, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Access Denied Page
 * 
 * Displayed when a user doesn't have permission to access a resource.
 * Provides guidance on how to request access.
 */
export default function AccessDeniedPage() {
  const searchParams = useSearchParams()
  const resource = searchParams.get('resource')
  const requiredRole = searchParams.get('role')

  const handleGoBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = '/'
    }
  }

  const handleGoHome = () => {
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4">
            <ShieldX className="h-12 w-12 text-red-600 dark:text-red-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Access Denied
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            You don't have permission to access this resource.
          </p>
        </div>

        {(resource || requiredRole) && (
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-left">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Details
            </h3>
            <dl className="text-sm space-y-1">
              {resource && (
                <div className="flex">
                  <dt className="text-gray-500 dark:text-gray-400 w-24">Resource:</dt>
                  <dd className="text-gray-900 dark:text-white font-mono text-xs">
                    {resource}
                  </dd>
                </div>
              )}
              {requiredRole && (
                <div className="flex">
                  <dt className="text-gray-500 dark:text-gray-400 w-24">Required:</dt>
                  <dd className="text-gray-900 dark:text-white">{requiredRole}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            If you believe you should have access, please contact your administrator
            to request the necessary permissions.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button variant="outline" onClick={handleGoBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          <Button onClick={handleGoHome} className="gap-2">
            <Home className="h-4 w-4" />
            Go Home
          </Button>
        </div>

        <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Need access?{' '}
            <a
              href="mailto:support@example.com?subject=Access%20Request"
              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              <Mail className="h-3 w-3" />
              Request Access
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
