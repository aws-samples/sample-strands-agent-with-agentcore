import { useState, useEffect, useCallback } from 'react'
import {
  getCurrentUser,
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  fetchAuthSession,
  type SignInOutput,
  type SignUpOutput,
} from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  userEmail: string | null
  userId: string | null
}

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    try {
      const user = await getCurrentUser()
      const session = await fetchAuthSession()
      const idTokenPayload = session.tokens?.idToken?.payload
      const email = idTokenPayload?.email as string | undefined
      setStatus('authenticated')
      setUserId(user.userId)
      setUserEmail(email ?? null)
    } catch {
      setStatus('unauthenticated')
      setUserId(null)
      setUserEmail(null)
    }
  }, [])

  useEffect(() => {
    checkAuth()

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') {
        checkAuth()
      } else if (payload.event === 'signedOut') {
        setStatus('unauthenticated')
        setUserId(null)
        setUserEmail(null)
      }
    })

    return unsubscribe
  }, [checkAuth])

  const login = useCallback(
    async (email: string, password: string): Promise<SignInOutput> => {
      return signIn({ username: email, password })
    },
    [],
  )

  const register = useCallback(
    async (email: string, password: string): Promise<SignUpOutput> => {
      return signUp({
        username: email,
        password,
        options: { userAttributes: { email } },
      })
    },
    [],
  )

  const verify = useCallback(async (email: string, code: string) => {
    return confirmSignUp({ username: email, confirmationCode: code })
  }, [])

  const logout = useCallback(async () => {
    await signOut()
  }, [])

  const getIdToken = useCallback(async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession()
      return session.tokens?.idToken?.toString() ?? null
    } catch {
      return null
    }
  }, [])

  return { status, userEmail, userId, login, register, verify, logout, getIdToken, checkAuth }
}
