import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/context/ThemeContext'
import type { Artifact, ArtifactType } from '@/types/artifact'

interface Props {
  artifact: Artifact
  onPress: () => void
}

const TYPE_ICON: Record<ArtifactType, string> = {
  markdown: 'document-text-outline',
  code: 'code-slash-outline',
  research: 'library-outline',
  compose: 'create-outline',
  image: 'image-outline',
  word_document: 'document-text-outline',
  excel_spreadsheet: 'grid-outline',
  powerpoint_presentation: 'easel-outline',
  excalidraw: 'color-wand-outline',
  extracted_data: 'analytics-outline',
}

const TYPE_LABEL: Record<ArtifactType, string> = {
  markdown: 'Markdown',
  code: 'Code',
  research: 'Research',
  compose: 'Document',
  image: 'Image',
  word_document: 'Word',
  excel_spreadsheet: 'Excel',
  powerpoint_presentation: 'PowerPoint',
  excalidraw: 'Diagram',
  extracted_data: 'Data',
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}

export default function ArtifactCard({ artifact, onPress }: Props) {
  const { colors } = useTheme()
  const iconName = TYPE_ICON[artifact.type] ?? 'document-outline'
  const label = TYPE_LABEL[artifact.type] ?? artifact.type

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryBg }]}>
        <Ionicons name={iconName as any} size={22} color={colors.primary} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {artifact.title}
        </Text>
        {artifact.description && (
          <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={1}>
            {artifact.description}
          </Text>
        )}
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {label} · {formatTimestamp(artifact.timestamp)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 13 },
  meta: { fontSize: 12 },
})
