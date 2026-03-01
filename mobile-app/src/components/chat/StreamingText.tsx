import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import * as WebBrowser from 'expo-web-browser'
import { useTheme } from '../../context/ThemeContext'

interface Props {
  text: string
  isStreaming?: boolean
}

// Convert <cite source="X" url="Y">text</cite> → "text [↗ domain](url)"
// The custom link rule below renders these as chip badges.
function preprocessCitations(raw: string): string {
  return raw.replace(
    /<cite\s+(?:[^>]*?\s+)?url="([^"]*?)"[^>]*>([\s\S]*?)<\/cite>/g,
    (_, url: string, content: string) => {
      const domain = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
      return `${content} [↗ ${domain}](${url})`
    },
  )
}

function getDomain(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? url
}

export default function StreamingText({ text }: Props) {
  const { colors } = useTheme()

  if (!text) return null

  const processed = preprocessCitations(text)

  const markdownStyles = {
    body: { color: colors.text, fontSize: 15, lineHeight: 22 },
    code_inline: {
      backgroundColor: colors.codeInlineBg,
      fontFamily: 'Courier',
      fontSize: 13,
      paddingHorizontal: 4,
      borderRadius: 3,
      color: colors.codeInlineText,
    },
    fence: {
      backgroundColor: colors.codeBg,
      color: colors.codeText,
      fontFamily: 'Courier',
      fontSize: 12,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
    },
    code_block: {
      backgroundColor: colors.codeBg,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
      color: colors.codeText,
      fontFamily: 'Courier',
      fontSize: 12,
    },
    paragraph: { marginVertical: 2 },
    bullet_list: { marginLeft: 0 },
    ordered_list: { marginLeft: 0 },
    list_item: { marginVertical: 2 },
    // Headings slightly larger than body — avoids overwhelming the chat bubble
    heading1: { fontSize: 16, fontWeight: '700' as const, marginVertical: 4, color: colors.text },
    heading2: { fontSize: 15, fontWeight: '700' as const, marginVertical: 3, color: colors.text },
    heading3: { fontSize: 15, fontWeight: '600' as const, marginVertical: 2, color: colors.text },
    strong: { fontWeight: '600' as const },
    em: { fontStyle: 'italic' as const },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.textMuted,
      paddingLeft: 12,
      color: colors.textMuted,
      marginVertical: 6,
    },
    hr: { borderTopColor: colors.border, borderTopWidth: 1, marginVertical: 10 },
    // link style is overridden by custom rule below; keep as fallback
    link: { color: colors.primary },
  }

  // Custom inline chip for citation links (and regular links)
  const rules = {
    link: (node: any, children: any) => {
      const href: string = node.attributes?.href ?? ''
      const child = Array.isArray(children) ? children[0] : children
      const label = typeof child === 'string' ? child : String(child ?? '')

      // Citation link: starts with ↗ — render as chip badge
      if (label.startsWith('↗')) {
        const domain = getDomain(href)
        return (
          <Text
            key={node.key}
            onPress={() => WebBrowser.openBrowserAsync(href)}
            style={[
              styles.citationChip,
              {
                color: colors.primaryDark,
                backgroundColor: colors.primaryBg,
              },
            ]}
          >
            {' ↗ '}{domain}
          </Text>
        )
      }

      // Regular link — standard colored text
      return (
        <Text
          key={node.key}
          onPress={() => WebBrowser.openBrowserAsync(href)}
          style={{ color: colors.primary }}
        >
          {children}
        </Text>
      )
    },
  }

  return (
    <View style={styles.container}>
      <Markdown style={markdownStyles} rules={rules}>
        {processed}
      </Markdown>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flexShrink: 1 },
  citationChip: {
    fontSize: 11,
    fontWeight: '500',
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
})
