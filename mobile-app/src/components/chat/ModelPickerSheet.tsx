import React, { useCallback, useMemo, useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import { AVAILABLE_MODELS, type ModelInfo } from '../../lib/constants'

interface Props {
  selectedModelId: string
  onSelect: (modelId: string) => void
  onClose: () => void
}

// Group models by provider
function groupByProvider(models: ModelInfo[]): { provider: string; items: ModelInfo[] }[] {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const arr = map.get(m.provider) ?? []
    arr.push(m)
    map.set(m.provider, arr)
  }
  return Array.from(map.entries()).map(([provider, items]) => ({ provider, items }))
}

type ListItem =
  | { kind: 'header'; provider: string }
  | { kind: 'model'; model: ModelInfo }

export default function ModelPickerSheet({ selectedModelId, onSelect, onClose }: Props) {
  const { colors, isDark } = useTheme()
  const sheetRef = useRef<BottomSheet>(null)
  const snapPoints = useMemo(() => ['60%', '85%'], [])

  const listData = useMemo<ListItem[]>(() => {
    const groups = groupByProvider(AVAILABLE_MODELS)
    const items: ListItem[] = []
    for (const g of groups) {
      items.push({ kind: 'header', provider: g.provider })
      for (const m of g.items) {
        items.push({ kind: 'model', model: m })
      }
    }
    return items
  }, [])

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose()
    },
    [onClose],
  )

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'header') {
        return (
          <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
            {item.provider}
          </Text>
        )
      }
      const { model } = item
      const isSelected = model.id === selectedModelId
      return (
        <Pressable
          style={({ pressed }) => [
            styles.modelRow,
            {
              backgroundColor: pressed
                ? colors.bgSecondary
                : isSelected
                ? colors.primaryBg
                : 'transparent',
              borderColor: isSelected ? colors.primary : 'transparent',
            },
          ]}
          onPress={() => {
            onSelect(model.id)
            sheetRef.current?.close()
          }}
        >
          <View style={styles.modelInfo}>
            <Text style={[styles.modelName, { color: colors.text }]}>{model.name}</Text>
            <Text style={[styles.modelDesc, { color: colors.textMuted }]} numberOfLines={1}>
              {model.description}
            </Text>
          </View>
          {isSelected && (
            <Ionicons name="checkmark" size={18} color={colors.primary} />
          )}
        </Pressable>
      )
    },
    [selectedModelId, onSelect, colors],
  )

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={handleSheetChange}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.textMuted }}
    >
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>Select Model</Text>
      </View>
      <BottomSheetFlatList
        data={listData}
        keyExtractor={(item: ListItem) =>
          item.kind === 'header' ? `header-${item.provider}` : item.model.id
        }
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  sheetHeader: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  listContent: { paddingBottom: 32 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 8,
    borderWidth: 1,
    gap: 12,
  },
  modelInfo: { flex: 1, gap: 2 },
  modelName: { fontSize: 14, fontWeight: '600' },
  modelDesc: { fontSize: 12 },
})
