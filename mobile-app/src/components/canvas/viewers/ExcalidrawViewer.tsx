import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/context/ThemeContext'
import type { ExcalidrawData } from '@/types/artifact'

interface Props {
  content: ExcalidrawData
}

export default function ExcalidrawViewer({ content }: Props) {
  const { colors } = useTheme()
  const elementCount = content.elements?.length ?? 0

  return (
    <View style={[styles.container, { backgroundColor: colors.bgSecondary }]}>
      <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Ionicons name="desktop-outline" size={36} color={colors.textMuted} />
        <Text style={[styles.title, { color: colors.text }]}>Excalidraw Diagram</Text>
        <Text style={[styles.desc, { color: colors.textMuted }]}>
          This diagram is available for preview on the web app.
        </Text>
        {elementCount > 0 && (
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {elementCount} element{elementCount !== 1 ? 's' : ''}
            {content.title ? ` · ${content.title}` : ''}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 10,
    width: '100%',
    maxWidth: 300,
  },
  title: { fontSize: 16, fontWeight: '600' },
  desc: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  meta: { fontSize: 12, marginTop: 4 },
})
