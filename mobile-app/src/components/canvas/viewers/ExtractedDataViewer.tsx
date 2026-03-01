import React from 'react'
import { ScrollView, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/context/ThemeContext'

interface Props {
  content: string
}

export default function ExtractedDataViewer({ content }: Props) {
  const { colors } = useTheme()

  let pretty = content
  try {
    pretty = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    // not JSON — show as-is
  }

  return (
    <ScrollView style={[styles.scroll, { backgroundColor: colors.codeBg }]} contentContainerStyle={styles.content}>
      <Text style={[styles.code, { color: colors.codeText }]}>{pretty}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
})
