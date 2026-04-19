'use client'

import { useEffect, useState } from 'react'
import { getCurrentUser, signOut } from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'
import { AuthForm } from '@/components/auth/AuthForm'

const HAS_COGNITO_CONFIG = !!(
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID &&
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID
)

export default function AuthWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  const [isClient, setIsClient] = useState(false)
  const [isLocalDev, setIsLocalDev] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)

  // Check authentication status
  const checkAuth = async () => {
    try {
      await getCurrentUser()
      setIsAuthenticated(true)
    } catch {
      setIsAuthenticated(false)
    }
  }

  // Hydration-safe: Run after mount
  useEffect(() => {
    setIsClient(true)

    // Check if we're in local development
    const localDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1'
    setIsLocalDev(localDev)

    // Only initialize Amplify if we need authentication (not local dev, has Cognito config)
    if (!localDev && HAS_COGNITO_CONFIG) {
      import('../lib/amplify-config').then(() => {
        setIsConfigured(true)
        checkAuth()
      })
    } else {
      setIsConfigured(true)
      setIsAuthenticated(true) // Skip auth in local dev
    }
  }, [])

  // Listen for auth events
  useEffect(() => {
    if (!isConfigured || isLocalDev || !HAS_COGNITO_CONFIG) return

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
          setIsAuthenticated(true)
          break
        case 'signedOut':
          setIsAuthenticated(false)
          break
      }
    })

    return () => unsubscribe()
  }, [isConfigured, isLocalDev])

  // Wait for client-side hydration
  if (!isClient) {
    return <>{children}</>
  }

  // In local development or without Cognito config, skip authentication
  if (isLocalDev || !HAS_COGNITO_CONFIG) {
    return <>{children}</>
  }

  // Wait for Amplify config to load and auth check
  if (!isConfigured || isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-subtle">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
          <span className="text-sm text-muted-foreground tracking-wide">Loading...</span>
        </div>
      </div>
    )
  }

  // Not authenticated - show login form
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-subtle p-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-1/4 -right-1/4 w-[600px] h-[600px] rounded-full bg-primary/[0.04] blur-3xl" />
          <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-secondary/[0.04] blur-3xl" />
        </div>
        <div className="relative z-10 animate-fade-in">
          <AuthForm onSuccess={() => setIsAuthenticated(true)} />
        </div>
      </div>
    )
  }

  // Authenticated - show app
  return <>{children}</>
}

// Export signOut for use in other components
export { signOut }
