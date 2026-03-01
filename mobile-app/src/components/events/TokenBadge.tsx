import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'
import type { TokenUsage } from '../../types/events'

interface Props {
  usage: TokenUsage
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default function TokenBadge({ usage }: Props) {
  const { colors } = useTheme()

  return (
    <View style={[styles.pill, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]} accessibilityLabel={`${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens`}>
      <Text style={[styles.text, { color: colors.textMuted }]}>
        ↑ {fmt(usage.inputTokens)}{'  '}↓ {fmt(usage.outputTokens)}
        {'  '}tokens
      </Text>
      {(usage.cacheReadInputTokens ?? 0) > 0 && (
        <Text style={[styles.cacheText, { color: colors.textMuted }]}>
          {' '}· {fmt(usage.cacheReadInputTokens!)} cached
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 6,
    borderWidth: 1,
  },
  text: { fontSize: 11, fontVariant: ['tabular-nums'] },
  cacheText: { fontSize: 11 },
})
