import React, { useState, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useArtifactContext } from '@/context/ArtifactContext'
import { useSessionContext } from '@/context/SessionContext'
import { useTheme } from '@/context/ThemeContext'
import ArtifactCard from '@/components/canvas/ArtifactCard'
import ArtifactViewer from '@/components/canvas/ArtifactViewer'
import EmptyCanvas from '@/components/canvas/EmptyCanvas'
import type { Artifact } from '@/types/artifact'

export default function CanvasTab() {
  const { artifacts, clearUnread } = useArtifactContext()
  const { activeSessionId } = useSessionContext()
  const { colors } = useTheme()
  const [selected, setSelected] = useState<Artifact | null>(null)

  // Clear badge whenever this tab gains focus
  useFocusEffect(
    useCallback(() => {
      clearUnread()
    }, [clearUnread]),
  )

  const list = artifacts
    .filter(a => a.sessionId === activeSessionId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Canvas</Text>
        <Text style={[styles.headerCount, { color: colors.textMuted }]}>
          {list.length > 0 ? `${list.length} artifact${list.length !== 1 ? 's' : ''}` : ''}
        </Text>
      </View>

      {list.length === 0 ? (
        <EmptyCanvas />
      ) : (
        <FlatList
          data={list}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <ArtifactCard artifact={item} onPress={() => setSelected(item)} />
          )}
        />
      )}

      {selected && (
        <ArtifactViewer artifact={selected} onClose={() => setSelected(null)} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  headerCount: {
    fontSize: 13,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
})
