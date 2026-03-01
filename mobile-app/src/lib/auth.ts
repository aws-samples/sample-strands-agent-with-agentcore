/**
 * src/lib/auth.ts
 *
 * Centralised Amplify v6 auth helpers.
 *
 * Design notes:
 *  - `configureAmplify` is re-exported from src/config/amplify so the
 *    single-configure guard lives in one place — safe to call from both
 *    this module and the legacy import path in app/_layout.tsx.
 *  - All functions are plain async helpers (not React hooks) so they can be
 *    called from non-component code (e.g. sse-client.ts, api-client.ts).
 *  - Env vars use the naming from .env.example:
 *      EXPO_PUBLIC_USER_POOL_ID
 *      EXPO_PUBLIC_USER_POOL_CLIENT_ID
 *      EXPO_PUBLIC_AWS_REGION  (falls back to region encoded in pool ID)
 */

// Re-export the idempotent configure helper so callers can import from one place.
export { configureAmplify } from '../config/amplify';

import {
  signIn,
  signOut,
  signUp,
  confirmSignUp,
  getCurrentUser,
  fetchAuthSession,
  type SignInOutput,
  type SignUpOutput,
  type ConfirmSignUpOutput,
} from 'aws-amplify/auth';

// ─── Sign-in / Sign-up ────────────────────────────────────────────────────────

/**
 * Sign in with email + password.
 * Returns the Amplify SignInOutput so callers can inspect `isSignedIn` and
 * `nextStep` (e.g. for NEW_PASSWORD_REQUIRED or MFA challenges).
 */
export async function signInUser(
  email: string,
  password: string,
): Promise<SignInOutput> {
  return signIn({ username: email.trim().toLowerCase(), password });
}

/**
 * Register a new user with email + password.
 * On success Amplify sends a verification code to the user's email.
 */
export async function signUpUser(
  email: string,
  password: string,
): Promise<SignUpOutput> {
  return signUp({
    username: email.trim().toLowerCase(),
    password,
    options: {
      userAttributes: { email: email.trim().toLowerCase() },
    },
  });
}

/**
 * Confirm a sign-up with the emailed verification code.
 * After confirmation callers should call `signInUser` to obtain tokens.
 */
export async function confirmSignUpUser(
  email: string,
  code: string,
): Promise<ConfirmSignUpOutput> {
  return confirmSignUp({
    username: email.trim().toLowerCase(),
    confirmationCode: code.trim(),
  });
}

/**
 * Sign out the current user globally (invalidates refresh token server-side).
 */
export async function signOutUser(): Promise<void> {
  await signOut({ global: false });
}

// ─── Token helpers ────────────────────────────────────────────────────────────

/**
 * Return the current Cognito **ID token** string, auto-refreshing via the
 * stored refresh token when it is close to expiry.
 *
 * Returns `null` when no user is signed in or the token cannot be refreshed.
 *
 * The BFF validates this JWT on every request.
 */
export async function getIdToken(): Promise<string | null> {
  try {
    // First attempt — use cached tokens
    let session = await fetchAuthSession();
    let token = session.tokens?.idToken?.toString();

    if (!token) {
      // Force a refresh in case the cached session is stale
      session = await fetchAuthSession({ forceRefresh: true });
      token = session.tokens?.idToken?.toString();
    }

    return token ?? null;
  } catch {
    return null;
  }
}

// ─── User info ────────────────────────────────────────────────────────────────

export interface AuthUserInfo {
  /** Cognito `sub` — stable unique identifier. */
  userId: string;
  /** Email attribute from the ID token payload. */
  email: string | null;
}

/**
 * Return basic user info from the current session.
 * Returns `null` when no user is signed in.
 */
export async function getCurrentAuthUser(): Promise<AuthUserInfo | null> {
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    const email =
      (session.tokens?.idToken?.payload?.email as string | undefined) ?? null;
    return { userId: user.userId, email };
  } catch {
    return null;
  }
}

/**
 * Generate a session ID that satisfies the AgentCore Runtime minimum-length
 * constraint (≥ 33 characters).
 *
 * Format: `{userPrefix8}_{timestampBase36}_{randomHex16}`
 * Example: `ab12ef78_lzf3k2a_4d9c1b7e3f2a0c8d`
 */
export function generateSessionId(userId: string): string {
  const prefix = userId.slice(0, 8).replace(/[^a-zA-Z0-9]/g, 'x');
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${prefix}_${ts}_${rand}`.slice(0, 52);
}
