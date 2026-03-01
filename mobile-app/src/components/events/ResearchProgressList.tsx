import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { ProgressStep } from '../../types/chat'

interface Props {
  steps: ProgressStep[]
}

export default function ResearchProgressList({ steps }: Props) {
  const { colors } = useTheme()
  const [showAll, setShowAll] = useState(false)

  if (steps.length === 0) return null

  const visible = showAll ? steps : steps.slice(-3)
  const hiddenCount = steps.length - visible.length

  return (
    <View style={[styles.container, { backgroundColor: colors.successBg, borderColor: colors.success }]}>
      <View style={styles.header}>
        <Ionicons name="flask-outline" size={14} color={colors.successText} />
        <Text style={[styles.label, { color: colors.successText }]}>Research steps</Text>
        <View style={[styles.countBadge, { backgroundColor: colors.successBg }]}>
          <Text style={[styles.count, { color: colors.successText }]}>{steps.length}</Text>
        </View>
      </View>

      <ScrollView style={styles.list} nestedScrollEnabled>
        {hiddenCount > 0 && !showAll && (
          <Pressable onPress={() => setShowAll(true)} style={styles.moreBtn}>
            <Text style={[styles.moreText, { color: colors.successText }]}>+ {hiddenCount} earlier step{hiddenCount !== 1 ? 's' : ''}</Text>
          </Pressable>
        )}

        {visible.map((step, i) => {
          const isLatest = i === visible.length - 1
          return (
            <View key={step.stepNumber} style={styles.row}>
              <View style={[styles.bullet, { backgroundColor: colors.success }, isLatest && { width: 8, height: 8 }]} />
              <View style={styles.rowContent}>
                <Text style={[styles.stepNum, { color: colors.success }, isLatest && { color: colors.successText }]}>
                  Step {step.stepNumber}
                </Text>
                <Text style={[styles.stepText, { color: colors.text }]}>{step.content}</Text>
              </View>
            </View>
          )
        })}
      </ScrollView>

      {showAll && steps.length > 3 && (
        <Pressable onPress={() => setShowAll(false)} style={styles.moreBtn}>
          <Text style={[styles.moreText, { color: colors.successText }]}>Show fewer</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    padding: 10,
    marginVertical: 4,
    borderWidth: 1,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  label: { flex: 1, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  countBadge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  count: { fontSize: 11, fontWeight: '600' },
  list: { maxHeight: 200 },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 5,
    flexShrink: 0,
  },
  rowContent: { flex: 1, gap: 1 },
  stepNum: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  stepText: { fontSize: 12, lineHeight: 17 },
  moreBtn: { paddingVertical: 4 },
  moreText: { fontSize: 11, fontWeight: '600' },
})
