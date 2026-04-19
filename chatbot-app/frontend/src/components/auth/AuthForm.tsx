'use client'

import { useState } from 'react'
import { signIn, signUp, confirmSignUp, resetPassword, confirmResetPassword } from 'aws-amplify/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AuthView = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword' | 'confirmReset'

interface AuthFormProps {
  onSuccess: () => void
}

export function AuthForm({ onSuccess }: AuthFormProps) {
  const [view, setView] = useState<AuthView>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await signIn({ username: email, password })
      if (result.isSignedIn) {
        onSuccess()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in')
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: { email }
        }
      })
      setView('confirmSignUp')
    } catch (err: any) {
      setError(err.message || 'Failed to sign up')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await confirmSignUp({ username: email, confirmationCode: code })
      // Auto sign in after confirmation
      await signIn({ username: email, password })
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to confirm sign up')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await resetPassword({ username: email })
      setView('confirmReset')
    } catch (err: any) {
      setError(err.message || 'Failed to send reset code')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword: password })
      setView('signIn')
      setPassword('')
      setConfirmPassword('')
      setCode('')
    } catch (err: any) {
      setError(err.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setError('')
    setPassword('')
    setConfirmPassword('')
    setCode('')
  }

  // Sign In View
  if (view === 'signIn') {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 h-12 w-12 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Sign in to continue</p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-sm">
          <form onSubmit={handleSignIn}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center">
                  <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Password</Label>
                  <button
                    type="button"
                    onClick={() => { resetForm(); setView('forgotPassword') }}
                    className="ml-auto text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <div className="text-sm px-3 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full h-11 mt-1 gradient-primary text-white font-medium shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Signing in...
                  </span>
                ) : 'Sign In'}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Don&apos;t have an account?{' '}
          <button
            onClick={() => { resetForm(); setView('signUp') }}
            className="text-primary font-medium hover:underline transition-colors"
          >
            Sign up
          </button>
        </p>
      </div>
    )
  }

  // Sign Up View
  if (view === 'signUp') {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 h-12 w-12 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Create account</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Enter your details to get started</p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-sm">
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirmPassword" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <div className="text-sm px-3 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full h-11 mt-1 gradient-primary text-white font-medium shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Creating account...
                  </span>
                ) : 'Sign Up'}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{' '}
          <button
            onClick={() => { resetForm(); setView('signIn') }}
            className="text-primary font-medium hover:underline transition-colors"
          >
            Sign in
          </button>
        </p>
      </div>
    )
  }

  // Confirm Sign Up View (Email Verification)
  if (view === 'confirmSignUp') {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 h-12 w-12 rounded-xl bg-secondary/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Verify email</h1>
          <p className="text-sm text-muted-foreground mt-1.5">We sent a code to {email}</p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-sm">
          <form onSubmit={handleConfirmSignUp}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="code" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Verification Code</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="h-11 text-center text-lg tracking-widest"
                />
              </div>
              {error && (
                <div className="text-sm px-3 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full h-11 mt-1 gradient-primary text-white font-medium shadow-md shadow-primary/20 transition-all" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Verifying...
                  </span>
                ) : 'Verify'}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          <button
            onClick={() => { resetForm(); setView('signIn') }}
            className="text-primary font-medium hover:underline transition-colors"
          >
            Back to sign in
          </button>
        </p>
      </div>
    )
  }

  // Forgot Password View
  if (view === 'forgotPassword') {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 h-12 w-12 rounded-xl bg-secondary/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Reset password</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Enter your email to receive a reset code</p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-sm">
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <div className="text-sm px-3 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full h-11 mt-1 gradient-primary text-white font-medium shadow-md shadow-primary/20 transition-all" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Sending...
                  </span>
                ) : 'Send Reset Code'}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          <button
            onClick={() => { resetForm(); setView('signIn') }}
            className="text-primary font-medium hover:underline transition-colors"
          >
            Back to sign in
          </button>
        </p>
      </div>
    )
  }

  // Confirm Reset Password View
  if (view === 'confirmReset') {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 h-12 w-12 rounded-xl bg-secondary/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Set new password</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Enter the code sent to {email}</p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-sm">
          <form onSubmit={handleConfirmReset}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="code" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reset Code</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="h-11 text-center text-lg tracking-widest"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirmPassword" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <div className="text-sm px-3 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full h-11 mt-1 gradient-primary text-white font-medium shadow-md shadow-primary/20 transition-all" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Resetting...
                  </span>
                ) : 'Reset Password'}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          <button
            onClick={() => { resetForm(); setView('signIn') }}
            className="text-primary font-medium hover:underline transition-colors"
          >
            Back to sign in
          </button>
        </p>
      </div>
    )
  }

  return null
}
