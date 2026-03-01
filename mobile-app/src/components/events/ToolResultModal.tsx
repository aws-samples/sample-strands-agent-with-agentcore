import React, { useMemo, useState } from 'react'
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { ToolExecution } from '../../types/chat'
import type { IconEntry } from '../../config/tool-icons'
import ToolIcon from './ToolIcon'
import ToolResultCard from './ToolResultCard'
import MapCard from './MapCard'
import ChartCard from './ChartCard'
import { resolveDisplayName } from './ToolIconRow'
import { parseVisualizationResult } from '../../lib/visualization-utils'

interface Props {
  visible: boolean
  executions: ToolExecution[]
  iconEntry: IconEntry | null
  onClose: () => void
}

const SHEET_MAX = Dimensions.get('window').height * 0.7

export default function ToolResultModal({ visible, executions, iconEntry, onClose }: Props) {
  const { colors } = useTheme()
  const [index, setIndex] = useState(0)

  const total = executions.length
  const safeIndex = total > 0 ? Math.min(index, total - 1) : 0
  const tool = total > 0 ? executions[safeIndex] : null

  const viz = useMemo(
    () => (tool?.toolResult ? parseVisualizationResult(tool.toolResult) : null),
    [tool?.toolResult],
  )

  if (!tool) return null

  const hasPrev = index > 0
  const hasNext = index < total - 1

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Background tap to close — sibling of sheet, not parent */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Bottom sheet */}
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: SHEET_MAX }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.titleRow}>
              <View style={[styles.iconWrap, { backgroundColor: colors.toolChipBorder }]}>
                <ToolIcon entry={iconEntry} size={16} color={colors.toolChipText} />
              </View>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {resolveDisplayName(tool.toolName, tool.toolInput)}
              </Text>
              {total > 1 && (
                <Text style={[styles.counter, { color: colors.textMuted }]}>
                  {safeIndex + 1}/{total}
                </Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Scrollable result content */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator
            bounces
            nestedScrollEnabled
          >
            {viz?.mapData ? (
              <MapCard mapData={viz.mapData} />
            ) : viz?.chartData ? (
              <ChartCard chartData={viz.chartData} />
            ) : (
              <ToolResultCard
                result={tool.toolResult ?? ''}
                images={tool.images}
                status={tool.resultStatus}
                codeSteps={tool.codeSteps}
                codeTodos={tool.codeTodos}
                codeResultMeta={tool.codeResultMeta}
              />
            )}
          </ScrollView>

          {/* Pagination */}
          {total > 1 && (
            <View style={[styles.pagination, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={() => setIndex(i => i - 1)}
                disabled={!hasPrev}
                style={[styles.pageBtn, { opacity: hasPrev ? 1 : 0.3 }]}
                hitSlop={8}
              >
                <Ionicons name="chevron-back" size={18} color={colors.text} />
                <Text style={[styles.pageBtnText, { color: colors.text }]}>Prev</Text>
              </Pressable>
              <Pressable
                onPress={() => setIndex(i => i + 1)}
                disabled={!hasNext}
                style={[styles.pageBtn, { opacity: hasNext ? 1 : 0.3 }]}
                hitSlop={8}
              >
                <Text style={[styles.pageBtnText, { color: colors.text }]}>Next</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.text} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  counter: { fontSize: 12, fontWeight: '500' },
  body: { flexShrink: 1 },
  bodyContent: { padding: 16 },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  pageBtnText: { fontSize: 13, fontWeight: '500' },
})
