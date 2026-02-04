import { Amplify } from 'aws-amplify';

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
const isBuildTime = typeof window === 'undefined';

// Only run configuration on client side
if (!isBuildTime) {
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  console.log(' Amplify Config Debug:', {
    userPoolId: userPoolId ? `${userPoolId.substring(0, 10)}...` : 'NOT SET',
    userPoolClientId: userPoolClientId ? `${userPoolClientId.substring(0, 10)}...` : 'NOT SET',
    region: process.env.NEXT_PUBLIC_AWS_REGION || 'NOT SET',
    isLocalDev,
    hostname: window.location.hostname,
    allEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
  });

  // Configure Amplify if Cognito credentials are available
  if (userPoolId && userPoolClientId) {
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
      console.log(' Amplify configured with Cognito');
      console.log(' Configuration details:', {
        region: amplifyConfig.Auth.Cognito.region,
        userPoolId: amplifyConfig.Auth.Cognito.userPoolId,
        userPoolClientId: amplifyConfig.Auth.Cognito.userPoolClientId
      });
    } catch (error) {
      console.error(' Failed to configure Amplify:', error);
      throw error; // Re-throw to help with debugging
    }
  } else {
    if (isLocalDev) {
      console.log('🔓 Running in local development mode - Cognito disabled');
    } else {
      console.warn(' No Cognito configuration found');
    }
  }
}

export default {};