import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { InterruptData } from '../../types/events'

interface Props {
  interrupts: InterruptData[]
  onApprove: () => void
  onReject: () => void
}

export default function InterruptCard({ interrupts, onApprove, onReject }: Props) {
  const { colors } = useTheme()
  const first = interrupts[0]
  if (!first) return null

  const reason = first.reason
  const description =
    reason?.plan_preview ??
    reason?.plan ??
    reason?.tool_name ??
    first.name ??
    'The agent needs your approval to continue.'

  return (
    <View style={[styles.card, { backgroundColor: colors.warningBg, borderColor: colors.warningBorder }]}>
      <View style={styles.topRow}>
        <Ionicons name="alert-circle" size={20} color={colors.warningText} />
        <Text style={[styles.title, { color: colors.warningText }]}>Approval Required</Text>
      </View>

      <Text style={[styles.description, { color: colors.warningText }]}>{description}</Text>

      {first.name && first.name !== description && (
        <View style={[styles.namePill, { backgroundColor: colors.warningBg, borderColor: colors.warningBorder }]}>
          <Text style={[styles.namePillText, { color: colors.warningText }]}>{first.name}</Text>
        </View>
      )}

      {reason?.tool_name && reason.tool_name !== description && (
        <Text style={[styles.toolHint, { color: colors.warningText }]}>Tool: {reason.tool_name}</Text>
      )}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.btn, { backgroundColor: colors.errorBg, borderWidth: 1, borderColor: colors.errorBorder }]}
          onPress={onReject}
          accessibilityRole="button"
          accessibilityLabel="Reject"
        >
          <Text style={[styles.rejectText, { color: colors.error }]}>✕  Reject</Text>
        </Pressable>

        <Pressable
          style={[styles.btn, { backgroundColor: colors.success }]}
          onPress={onApprove}
          accessibilityRole="button"
          accessibilityLabel="Approve"
        >
          <Text style={styles.approveText}>✓  Approve</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  description: { fontSize: 14, lineHeight: 20 },
  namePill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
  namePillText: { fontSize: 12, fontWeight: '500' },
  toolHint: { fontSize: 12, fontStyle: 'italic' },
  buttons: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectText: { fontSize: 14, fontWeight: '700' },
  approveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
})
