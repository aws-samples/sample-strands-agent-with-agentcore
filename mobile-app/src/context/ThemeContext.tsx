import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Color tokens ────────────────────────────────────────────────────────────

export interface ThemeColors {
  // Backgrounds
  bg: string
  bgSecondary: string
  bgTertiary: string
  bgInput: string

  // Surfaces (cards, bubbles)
  surface: string
  surfaceHover: string

  // Text
  text: string
  textSecondary: string
  textMuted: string
  textInverse: string

  // Borders
  border: string
  borderLight: string

  // Brand / accent
  primary: string
  primaryDark: string
  primaryLight: string
  primaryBg: string

  // User bubble
  userBubbleBg: string
  userBubbleText: string

  // Assistant bubble
  assistantBubbleBg: string
  assistantBubbleBorder: string

  // Semantic
  error: string
  errorBg: string
  errorBorder: string
  errorText: string
  warning: string
  warningBg: string
  warningBorder: string
  warningText: string
  success: string
  successBg: string
  successText: string

  // Code
  codeBg: string
  codeText: string
  codeInlineBg: string
  codeInlineText: string

  // Tool chip
  toolChipBg: string
  toolChipBorder: string
  toolChipRunningBg: string
  toolChipRunningBorder: string
  toolChipText: string

  // Shadow
  shadow: string
}

const lightColors: ThemeColors = {
  bg: '#ffffff',
  bgSecondary: '#f3f4f6',
  bgTertiary: '#f9fafb',
  bgInput: '#f3f4f6',

  surface: '#ffffff',
  surfaceHover: '#f9fafb',

  text: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  textInverse: '#ffffff',

  border: '#e5e7eb',
  borderLight: '#f3f4f6',

  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  primaryLight: '#60a5fa',
  primaryBg: '#eff6ff',

  userBubbleBg: '#2563eb',
  userBubbleText: '#ffffff',

  assistantBubbleBg: '#ffffff',
  assistantBubbleBorder: '#e5e7eb',

  error: '#dc2626',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  errorText: '#dc2626',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',
  warningText: '#92400e',
  success: '#22c55e',
  successBg: '#f0fdf4',
  successText: '#16a34a',

  codeBg: '#1e1e2e',
  codeText: '#cdd6f4',
  codeInlineBg: '#f0f0f0',
  codeInlineText: '#c7254e',

  toolChipBg: '#eef2ff',
  toolChipBorder: '#c7d2fe',
  toolChipRunningBg: '#faf5ff',
  toolChipRunningBorder: '#ddd6fe',
  toolChipText: '#4338ca',

  shadow: '#000000',
}

const darkColors: ThemeColors = {
  bg: '#0f0f0f',
  bgSecondary: '#1a1a1a',
  bgTertiary: '#252525',
  bgInput: '#1a1a1a',

  surface: '#1a1a1a',
  surfaceHover: '#252525',

  text: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0f0f0f',

  border: '#2a2a2a',
  borderLight: '#333333',

  primary: '#6366f1',
  primaryDark: '#4f52d6',
  primaryLight: '#818cf8',
  primaryBg: '#1e1b4b',

  userBubbleBg: '#4f46e5',
  userBubbleText: '#ffffff',

  assistantBubbleBg: '#1a1a1a',
  assistantBubbleBorder: '#2a2a2a',

  error: '#ef4444',
  errorBg: '#450a0a',
  errorBorder: '#991b1b',
  errorText: '#fca5a5',
  warning: '#f59e0b',
  warningBg: '#451a03',
  warningBorder: '#92400e',
  warningText: '#fde68a',
  success: '#22c55e',
  successBg: '#052e16',
  successText: '#86efac',

  codeBg: '#0d1117',
  codeText: '#e6edf3',
  codeInlineBg: '#2a2a2a',
  codeInlineText: '#f97583',

  toolChipBg: '#1e1b4b',
  toolChipBorder: '#3730a3',
  toolChipRunningBg: '#2e1065',
  toolChipRunningBorder: '#6d28d9',
  toolChipText: '#a5b4fc',

  shadow: '#000000',
}

// ─── Context ─────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system'
export type DisplayMode = 'minimal' | 'detailed'

const THEME_STORAGE_KEY = 'theme_mode'
const DISPLAY_STORAGE_KEY = 'display_mode'

interface ThemeContextValue {
  mode: ThemeMode
  isDark: boolean
  colors: ThemeColors
  setMode: (mode: ThemeMode) => void
  toggleTheme: () => void
  displayMode: DisplayMode
  setDisplayMode: (mode: DisplayMode) => void
  isDetailed: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [displayMode, setDisplayModeState] = useState<DisplayMode>('minimal')

  // Load persisted preferences
  useEffect(() => {
    AsyncStorage.multiGet([THEME_STORAGE_KEY, DISPLAY_STORAGE_KEY]).then(entries => {
      const [themeEntry, displayEntry] = entries
      const theme = themeEntry[1]
      const display = displayEntry[1]
      if (theme === 'light' || theme === 'dark' || theme === 'system') {
        setModeState(theme)
      }
      if (display === 'minimal' || display === 'detailed') {
        setDisplayModeState(display)
      }
    })
  }, [])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    AsyncStorage.setItem(THEME_STORAGE_KEY, m)
  }, [])

  const setDisplayMode = useCallback((m: DisplayMode) => {
    setDisplayModeState(m)
    AsyncStorage.setItem(DISPLAY_STORAGE_KEY, m)
  }, [])

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark'
  const colors = isDark ? darkColors : lightColors
  const isDetailed = displayMode === 'detailed'

  const toggleTheme = useCallback(() => {
    setMode(isDark ? 'light' : 'dark')
  }, [isDark, setMode])

  return (
    <ThemeContext.Provider value={{ mode, isDark, colors, setMode, toggleTheme, displayMode, setDisplayMode, isDetailed }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be called inside <ThemeProvider>')
  return ctx
}
