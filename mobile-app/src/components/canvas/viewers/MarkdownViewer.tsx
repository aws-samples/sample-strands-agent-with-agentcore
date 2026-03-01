import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useTheme } from '@/context/ThemeContext'

interface Props {
  content: string
}

export default function MarkdownViewer({ content }: Props) {
  const { colors, isDark } = useTheme()

  const markdownStyles = {
    body: { color: colors.text, fontSize: 15, lineHeight: 22 },
    heading1: { color: colors.text, fontSize: 22, fontWeight: '700' as const, marginBottom: 8 },
    heading2: { color: colors.text, fontSize: 18, fontWeight: '600' as const, marginBottom: 6 },
    heading3: { color: colors.text, fontSize: 16, fontWeight: '600' as const, marginBottom: 4 },
    paragraph: { color: colors.text, marginBottom: 8 },
    strong: { color: colors.text, fontWeight: '700' as const },
    em: { color: colors.text, fontStyle: 'italic' as const },
    code_block: {
      backgroundColor: colors.codeBg,
      color: colors.codeText,
      padding: 12,
      borderRadius: 8,
      fontFamily: 'monospace',
      fontSize: 13,
    },
    code_inline: {
      backgroundColor: colors.codeInlineBg,
      color: colors.codeInlineText,
      paddingHorizontal: 4,
      borderRadius: 3,
      fontFamily: 'monospace',
      fontSize: 13,
    },
    blockquote: {
      backgroundColor: isDark ? '#1a1a2e' : '#f0f4ff',
      borderLeftColor: colors.primary,
      borderLeftWidth: 4,
      paddingLeft: 12,
      paddingVertical: 4,
    },
    bullet_list_icon: { color: colors.primary },
    ordered_list_icon: { color: colors.primary },
    link: { color: colors.primary },
    hr: { backgroundColor: colors.border },
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Markdown style={markdownStyles}>{content}</Markdown>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
})
