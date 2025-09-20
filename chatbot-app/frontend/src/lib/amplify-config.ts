import { Amplify } from 'aws-amplify';

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
const isLocalDev = process.env.NODE_ENV === 'development' || typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const isBuildTime = typeof window === 'undefined';

console.log('🔍 Amplify Config Debug:', {
  userPoolId,
  userPoolClientId,
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  isLocalDev,
  isBuildTime,
  hostname: typeof window !== 'undefined' ? window.location.hostname : 'server'
});

// Skip Cognito validation during build time (SSG) or in local dev
if (!isBuildTime && !isLocalDev && (!userPoolId || !userPoolClientId)) {
  console.error('❌ Missing Cognito configuration in production:', { userPoolId, userPoolClientId });
  throw new Error('Cognito configuration is missing in production environment');
}

// Configure Amplify only if Cognito credentials are available
let amplifyConfig = {};

if (userPoolId && userPoolClientId) {
  amplifyConfig = {
    Auth: {
      Cognito: {
        region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2',
        userPoolId,
        userPoolClientId,
        signUpVerificationMethod: 'code' as const,
      },
    },
  };

  Amplify.configure(amplifyConfig);
  console.log('✅ Amplify configured with Cognito');
} else if (isLocalDev) {
  console.log('🔓 Running in local development mode - Cognito disabled');
} else {
  console.warn('⚠️ No Cognito configuration found');
}

export default amplifyConfig;