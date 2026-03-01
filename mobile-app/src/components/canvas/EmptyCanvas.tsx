import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/context/ThemeContext'

export default function EmptyCanvas() {
  const { colors } = useTheme()
  return (
    <View style={styles.container}>
      <Ionicons name="albums-outline" size={56} color={colors.textMuted} />
      <Text style={[styles.title, { color: colors.text }]}>No artifacts yet</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Documents, diagrams, and images created by the agent will appear here.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
})
