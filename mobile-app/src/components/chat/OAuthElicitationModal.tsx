import React, { useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { openAuthSessionAsync } from 'expo-web-browser'
import type { PendingOAuth } from '../../types/chat'

interface Props {
  oauth: PendingOAuth | null
  onComplete: () => void
}

export default function OAuthElicitationModal({ oauth, onComplete }: Props) {
  useEffect(() => {
    if (!oauth) return

    let cancelled = false

    async function openBrowser() {
      if (!oauth) return
      try {
        await openAuthSessionAsync(oauth.authUrl)
      } catch {
        // user closed browser
      } finally {
        if (!cancelled) onComplete()
      }
    }

    openBrowser()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauth?.authUrl])

  if (!oauth) return null

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.title}>Authorization Required</Text>
        <Text style={styles.message}>{oauth.message}</Text>
        <Pressable style={styles.cancelBtn} onPress={onComplete}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    width: '80%',
    alignItems: 'center',
    gap: 14,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center' },
  message: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#374151' },
})
