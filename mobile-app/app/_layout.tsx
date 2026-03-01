// react-native-get-random-values must be the very first import so that the
// crypto.getRandomValues polyfill is in place before any uuid / Amplify code runs.
import 'react-native-get-random-values';

// Hermes does not have DOMException — polyfill before anything uses AbortController
if (typeof globalThis.DOMException === 'undefined') {
  class DOMException extends Error {
    code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name ?? 'Error';
      this.code = 0;
    }
  }
  (globalThis as any).DOMException = DOMException;
}

import 'react-native-reanimated';
import 'react-native-gesture-handler';

import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureAmplify } from '@/config/amplify';
import { AuthProvider, useAuthContext } from '@/context/AuthContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';

// Bootstrap Amplify once — must happen before AuthProvider mounts so that
// Amplify.configure() is in place before any auth calls fire.
configureAmplify();

// ─── Auth gate ────────────────────────────────────────────────────────────────

/**
 * Renders a <Redirect> when the user is in the wrong route group for their
 * auth state. Returns null while auth is still loading.
 *
 * Lives inside <AuthProvider> so it can read from AuthContext.
 */
function AuthGate() {
  const { status } = useAuthContext();
  const segments = useSegments();

  // Still resolving — hold position
  if (status === 'loading') return null;

  const inAuthGroup = segments[0] === '(auth)';

  if (status === 'unauthenticated' && !inAuthGroup) {
    return <Redirect href="/(auth)/login" />;
  }
  if (status === 'authenticated' && inAuthGroup) {
    return <Redirect href="/(main)" />;
  }

  return null;
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

// ─── Root layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/*
         * AuthProvider must be inside SafeAreaProvider (in case any auth UI
         * needs insets) and outside Stack (so AuthGate can call useRouter).
         */}
        <ThemeProvider>
          <AuthProvider>
            <AuthGate />
            <ThemedStatusBar />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(main)" />
            </Stack>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
