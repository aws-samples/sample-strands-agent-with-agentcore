import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'

interface Props {
  text: string
}

export default function ReasoningBlock({ text }: Props) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)

  if (!text) return null

  return (
    <View style={[styles.container, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
      >
        <Ionicons name="bulb-outline" size={14} color={colors.textMuted} />
        <Text style={[styles.headerLabel, { color: colors.textMuted }]}>Thinking</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
      </Pressable>

      {expanded && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          <Text style={[styles.text, { color: colors.textMuted }]}>{text}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  headerLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  body: {
    borderTopWidth: 1,
    padding: 12,
  },
  text: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
})
