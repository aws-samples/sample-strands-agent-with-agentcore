'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useEffect, useState } from 'react';

const HAS_COGNITO_CONFIG = !!(
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID &&
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID
);

export default function AuthWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isClient, setIsClient] = useState(false);
  const [isLocalDev, setIsLocalDev] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  // Hydration-safe: Run after mount
  useEffect(() => {
    setIsClient(true);

    // Check if we're in local development
    const localDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';
    setIsLocalDev(localDev);

    // Only initialize Amplify if we need authentication (not local dev, has Cognito config)
    if (!localDev && HAS_COGNITO_CONFIG) {
      import('../lib/amplify-config').then(() => {
        setIsConfigured(true);
      });
    } else {
      setIsConfigured(true);
    }
  }, []);

  // Wait for client-side hydration
  if (!isClient) {
    return <>{children}</>;
  }

  // In local development or without Cognito config, skip authentication
  if (isLocalDev || !HAS_COGNITO_CONFIG) {
    return <>{children}</>;
  }

  // Wait for Amplify config to load
  if (!isConfigured) {
    return <>{children}</>; // Show content while loading auth
  }

  // In production with Cognito config, use Authenticator
  return (
    <Authenticator
      variation="modal"
      components={{
        Header() {
          return (
            <div className="text-center p-4">
              <h1 className="text-display font-bold text-gray-900 dark:text-white">
                Strands Chatbot
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Sign in to access your AI assistant
              </p>
            </div>
          );
        },
      }}
    >
      {children}
    </Authenticator>
  );
}