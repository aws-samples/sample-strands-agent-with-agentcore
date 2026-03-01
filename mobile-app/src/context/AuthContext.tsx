/**
 * src/context/AuthContext.tsx
 *
 * React context that holds the current Cognito auth state and makes it
 * available to every component in the tree via `useAuthContext()`.
 *
 * Design choices:
 *  - The context owns the single source of truth for auth status so the
 *    root layout's auth-gate and any screen that needs user info both read
 *    from the same subscription.
 *  - We subscribe to Amplify's Hub 'auth' channel so the context updates
 *    automatically when Amplify fires 'signedIn' or 'signedOut' — including
 *    sign-ins that happen in the (auth)/login screen.
 *  - `getIdToken` is a stable async function (never changes identity) so it
 *    can be passed to api-client or sse-client without triggering re-renders.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { signOutUser, getIdToken as getIdTokenHelper } from '../lib/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  /** Cognito `sub` — never changes for a given user. */
  userId: string;
  /** Email from the ID token payload, or null if not present. */
  email: string | null;
}

export interface AuthContextValue {
  status: AuthStatus;
  /** Populated when `status === 'authenticated'`, null otherwise. */
  user: AuthUser | null;
  /**
   * Returns the current Cognito ID token string.
   * Automatically refreshes when the cached token is expired.
   * Returns null when no user is signed in.
   */
  getIdToken: () => Promise<string | null>;
  /** Sign out the current user globally and clear local state. */
  signOut: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  /**
   * Query Amplify for the current session. Updates status + user state.
   * Safe to call multiple times — idempotent as long as the session doesn't
   * change between calls.
   */
  const refreshSession = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();
      const email =
        (session.tokens?.idToken?.payload?.email as string | undefined) ?? null;

      setUser({ userId: currentUser.userId, email });
      setStatus('authenticated');
    } catch {
      // getCurrentUser throws when no user is signed in
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  // Initial check + Hub subscription
  useEffect(() => {
    refreshSession();

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
          // Amplify has set tokens — re-query to populate user info
          void refreshSession();
          break;
        case 'signedOut':
        case 'tokenRefresh_failure':
          setUser(null);
          setStatus('unauthenticated');
          break;
        case 'tokenRefresh':
          // Tokens rotated — re-query to keep user info current
          void refreshSession();
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    await signOutUser();
    // Hub will fire 'signedOut' → state updates happen via the listener above
  }, []);

  // Stable reference: getIdTokenHelper never changes
  const getIdToken = useCallback(() => getIdTokenHelper(), []);

  const value: AuthContextValue = { status, user, getIdToken, signOut };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the current auth context value.
 * Must be called from a component inside `<AuthProvider>`.
 */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be called inside <AuthProvider>');
  }
  return ctx;
}
