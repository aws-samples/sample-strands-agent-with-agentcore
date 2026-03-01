import React from 'react'
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/context/ThemeContext'
import type { Artifact } from '@/types/artifact'
import MarkdownViewer from './viewers/MarkdownViewer'
import CodeViewer from './viewers/CodeViewer'
import ImageViewer from './viewers/ImageViewer'
import ExcalidrawViewer from './viewers/ExcalidrawViewer'
import OfficeViewer from './viewers/OfficeViewer'
import ExtractedDataViewer from './viewers/ExtractedDataViewer'
import type { ExcalidrawData } from '@/types/artifact'

interface Props {
  artifact: Artifact
  onClose: () => void
}

function ViewerBody({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case 'markdown':
    case 'research':
    case 'compose':
      return <MarkdownViewer content={typeof artifact.content === 'string' ? artifact.content : ''} />
    case 'code':
      return (
        <CodeViewer
          content={typeof artifact.content === 'string' ? artifact.content : ''}
          title={artifact.title}
        />
      )
    case 'image':
      return <ImageViewer content={typeof artifact.content === 'string' ? artifact.content : ''} />
    case 'excalidraw':
      return (
        <ExcalidrawViewer
          content={typeof artifact.content === 'object' ? (artifact.content as ExcalidrawData) : {}}
        />
      )
    case 'word_document':
    case 'excel_spreadsheet':
    case 'powerpoint_presentation':
      return <OfficeViewer artifact={artifact} />
    case 'extracted_data':
      return (
        <ExtractedDataViewer
          content={typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content)}
        />
      )
    default:
      return <MarkdownViewer content={typeof artifact.content === 'string' ? artifact.content : ''} />
  }
}

export default function ArtifactViewer({ artifact, onClose }: Props) {
  const { colors } = useTheme()

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {artifact.title}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Content */}
        <ViewerBody artifact={artifact} />
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  closeBtn: { padding: 4 },
})
