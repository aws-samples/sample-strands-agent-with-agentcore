import { Amplify } from 'aws-amplify';

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
const isBuildTime = typeof window === 'undefined';

// Only run configuration on client side
if (!isBuildTime) {
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  console.log('🔍 Amplify Config Debug:', {
    userPoolId: userPoolId ? '***' : undefined,
    userPoolClientId: userPoolClientId ? '***' : undefined,
    region: process.env.NEXT_PUBLIC_AWS_REGION,
    isLocalDev,
    hostname: window.location.hostname
  });

  // Configure Amplify only if Cognito credentials are available and not in local dev
  if (userPoolId && userPoolClientId && !isLocalDev) {
    const amplifyConfig = {
      Auth: {
        Cognito: {
          region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2',
          userPoolId,
          userPoolClientId,
          signUpVerificationMethod: 'code' as const,
        },
      },
    };

    try {
      Amplify.configure(amplifyConfig);
      console.log('✅ Amplify configured with Cognito');
    } catch (error) {
      console.error('❌ Failed to configure Amplify:', error);
    }
  } else if (isLocalDev) {
    console.log('🔓 Running in local development mode - Cognito disabled');
  } else {
    console.warn('⚠️ No Cognito configuration found');
  }
}

export default {};