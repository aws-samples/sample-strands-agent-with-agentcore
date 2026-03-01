import { Amplify } from 'aws-amplify';

let configured = false;

/**
 * Initialise Amplify with Cognito config sourced from environment variables.
 * Safe to call multiple times — only runs once.
 *
 * Required env vars (set in .env, copied from .env.example):
 *   EXPO_PUBLIC_COGNITO_REGION
 *   EXPO_PUBLIC_USER_POOL_ID
 *   EXPO_PUBLIC_USER_POOL_CLIENT_ID
 */
export function configureAmplify(): void {
  if (configured) return;
  configured = true;

  // Region is encoded in the user pool ID (e.g. "us-east-1_XXXXXXXXX")
  // Amplify v6 does NOT accept a separate `region` key in CognitoUserPoolConfig.
  const userPoolId = process.env.EXPO_PUBLIC_USER_POOL_ID ?? '';
  const userPoolClientId = process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID ?? '';

  if (!userPoolId || !userPoolClientId) {
    console.warn(
      '[Amplify] Cognito env vars are not set. ' +
        'Copy .env.example → .env and fill in your pool values.',
    );
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        signUpVerificationMethod: 'code',
      },
    },
  });
}
