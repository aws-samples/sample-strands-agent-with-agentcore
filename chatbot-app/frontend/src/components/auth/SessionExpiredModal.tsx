'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, LogIn } from 'lucide-react'
import { getLoginUrl } from '@/lib/sso-auth'

interface SessionExpiredModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Message to display */
  message?: string
  /** Return URL after login */
  returnUrl?: string
}

/**
 * Modal displayed when the user's session has expired.
 * Prompts the user to log in again.
 */
export function SessionExpiredModal({
  isOpen,
  message = 'Your session has expired. Please log in again to continue.',
  returnUrl,
}: SessionExpiredModalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || !isOpen) {
    return null
  }

  const handleLogin = () => {
    const url = returnUrl || window.location.pathname
    window.location.href = getLoginUrl(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex flex-col items-center text-center">
          {/* Icon */}
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          
          {/* Title */}
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Session Expired
          </h2>
          
          {/* Message */}
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {message}
          </p>
          
          {/* Login Button */}
          <button
            onClick={handleLogin}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Log In Again
          </button>
        </div>
      </div>
    </div>
  )
}

export default SessionExpiredModal
