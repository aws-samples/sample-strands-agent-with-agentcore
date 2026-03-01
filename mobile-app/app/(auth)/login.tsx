import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useState } from 'react';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signIn, signUp, confirmSignUp } from 'aws-amplify/auth';
import { useAuthContext } from '@/context/AuthContext';

type Mode = 'signIn' | 'signUp' | 'confirm';

export default function LoginScreen() {
  const { status } = useAuthContext();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in — let the root AuthGate redirect, but short-circuit
  // to avoid any flash of the login form.
  if (status === 'authenticated') {
    return <Redirect href="/(main)" />;
  }

  const clearError = () => setError(null);

  function switchMode(next: Mode) {
    setError(null);
    setCode('');
    setMode(next);
  }

  async function handleSignIn() {
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    clearError();
    try {
      const result = await signIn({ username: email.trim(), password });
      if (!result.isSignedIn) {
        // Partial sign-in flows (e.g. MFA) not expected with this Cognito config
        setError('Sign-in incomplete. Please try again.');
      }
      // AuthProvider Hub listener will update status → AuthGate will redirect
    } catch (e: unknown) {
      console.error('[SignIn Error]', JSON.stringify(e, Object.getOwnPropertyNames(e as object), 2));
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    clearError();
    try {
      await signUp({
        username: email.trim(),
        password,
        options: { userAttributes: { email: email.trim() } },
      });
      switchMode('confirm');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-up failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!code.trim()) {
      setError('Please enter the verification code sent to your email.');
      return;
    }
    setLoading(true);
    clearError();
    try {
      await confirmSignUp({ username: email.trim(), confirmationCode: code.trim() });
      // Auto-sign-in after confirmation
      const result = await signIn({ username: email.trim(), password });
      if (!result.isSignedIn) {
        switchMode('signIn');
      }
      // AuthProvider will pick up the signed-in event via Hub
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  const titleMap: Record<Mode, string> = {
    signIn: 'Sign in',
    signUp: 'Create account',
    confirm: 'Verify email',
  };
  const title = titleMap[mode];

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Branding ── */}
          <View style={styles.brand}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>A</Text>
            </View>
            <Text style={styles.appName}>AgentCore Chat</Text>
            <Text style={styles.appTagline}>AI assistant at your fingertips</Text>
          </View>

          {/* ── Card ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>

            {/* Error banner */}
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Email — all modes */}
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, mode === 'confirm' && styles.inputDisabled]}
              placeholder="you@example.com"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={t => { setEmail(t); clearError(); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={mode !== 'confirm'}
              returnKeyType="next"
            />

            {/* Password — signIn + signUp */}
            {mode !== 'confirm' && (
              <>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder={mode === 'signUp' ? 'At least 8 characters' : 'Password'}
                  placeholderTextColor="#64748b"
                  value={password}
                  onChangeText={t => { setPassword(t); clearError(); }}
                  secureTextEntry
                  returnKeyType={mode === 'signUp' ? 'next' : 'done'}
                  onSubmitEditing={mode === 'signIn' ? handleSignIn : undefined}
                />
              </>
            )}

            {/* Confirm password — signUp only */}
            {mode === 'signUp' && (
              <>
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Repeat password"
                  placeholderTextColor="#64748b"
                  value={confirmPassword}
                  onChangeText={t => { setConfirmPassword(t); clearError(); }}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleSignUp}
                />
              </>
            )}

            {/* Verification code — confirm only */}
            {mode === 'confirm' && (
              <>
                <Text style={styles.label}>Verification code</Text>
                <Text style={styles.hint}>Check {email} for a 6-digit code.</Text>
                <TextInput
                  style={[styles.input, styles.inputCode]}
                  placeholder="123456"
                  placeholderTextColor="#64748b"
                  value={code}
                  onChangeText={t => { setCode(t); clearError(); }}
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleConfirm}
                />
              </>
            )}

            {/* Primary action */}
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={
                mode === 'signIn' ? handleSignIn :
                mode === 'signUp' ? handleSignUp :
                handleConfirm
              }
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{title}</Text>
              )}
            </TouchableOpacity>

            {/* Toggle links */}
            {mode === 'signIn' && (
              <TouchableOpacity onPress={() => switchMode('signUp')}>
                <Text style={styles.link}>No account? <Text style={styles.linkBold}>Create one</Text></Text>
              </TouchableOpacity>
            )}
            {mode === 'signUp' && (
              <TouchableOpacity onPress={() => switchMode('signIn')}>
                <Text style={styles.link}>Already have an account? <Text style={styles.linkBold}>Sign in</Text></Text>
              </TouchableOpacity>
            )}
            {mode === 'confirm' && (
              <TouchableOpacity onPress={() => switchMode('signIn')}>
                <Text style={styles.link}>Back to <Text style={styles.linkBold}>sign in</Text></Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },

  // ── Branding ──
  brand: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  logoText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  appName: { fontSize: 22, fontWeight: '800', color: '#f8fafc', letterSpacing: 0.3 },
  appTagline: { fontSize: 13, color: '#94a3b8', marginTop: 4 },

  // ── Card ──
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 20,
  },

  // ── Error ──
  errorBox: {
    backgroundColor: '#450a0a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#991b1b',
  },
  errorText: { color: '#fca5a5', fontSize: 13, lineHeight: 18 },

  // ── Form fields ──
  label: { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginBottom: 6, letterSpacing: 0.5 },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 8, marginTop: -2 },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#f1f5f9',
    marginBottom: 14,
  },
  inputDisabled: { opacity: 0.5 },
  inputCode: {
    letterSpacing: 8,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },

  // ── Button ──
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 18,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // ── Toggle links ──
  link: { color: '#94a3b8', textAlign: 'center', fontSize: 14 },
  linkBold: { color: '#60a5fa', fontWeight: '600' },
});
