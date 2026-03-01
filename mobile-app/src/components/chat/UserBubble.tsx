import React, { useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { Message } from '../../types/chat'
import ImageLightbox from './ImageLightbox'

const MAX_LINES = 5

interface Props {
  message: Message
}

function fileIcon(mimeType: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (mimeType.startsWith('image/')) return 'image-outline'
  if (mimeType.includes('pdf')) return 'document-text-outline'
  if (mimeType.includes('word') || mimeType.includes('docx')) return 'document-outline'
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'grid-outline'
  if (mimeType.includes('text')) return 'document-text-outline'
  return 'attach-outline'
}

function CollapsibleText({ text, colors }: { text: string; colors: any }) {
  const [expanded, setExpanded] = useState(false)

  const { isLong, truncated, extraLines } = useMemo(() => {
    const lines = text.split('\n')
    const isLong = lines.length > MAX_LINES
    return {
      isLong,
      truncated: isLong ? lines.slice(0, MAX_LINES).join('\n') : text,
      extraLines: lines.length - MAX_LINES,
    }
  }, [text])

  return (
    <>
      <Text style={[styles.text, { color: colors.userBubbleText }]}>
        {isLong && !expanded ? truncated + '…' : text}
      </Text>
      {isLong && (
        <Pressable onPress={() => setExpanded(e => !e)} style={styles.toggleBtn}>
          <Ionicons
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={11} color={colors.userBubbleText} style={{ opacity: 0.6 }}
          />
          <Text style={[styles.toggleText, { color: colors.userBubbleText }]}>
            {expanded ? 'Show less' : `Show more (${extraLines} lines)`}
          </Text>
        </Pressable>
      )}
    </>
  )
}

export default function UserBubble({ message }: Props) {
  const { colors } = useTheme()
  const images = message.images ?? []
  const uploadedFiles = message.uploadedFiles ?? []
  const [selectedUri, setSelectedUri] = useState<string | null>(null)

  return (
    <View style={styles.wrapper}>
      {uploadedFiles.length > 0 && (
        <View style={styles.fileRow}>
          {uploadedFiles.map((f, i) => (
            <View key={i} style={[styles.fileBadge, { backgroundColor: colors.toolChipBg, borderColor: colors.border }]}>
              <Ionicons name={fileIcon(f.type)} size={13} color={colors.textMuted} />
              <Text style={[styles.fileName, { color: colors.textMuted }]} numberOfLines={1}>{f.name}</Text>
            </View>
          ))}
        </View>
      )}
      {images.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.imageRow}
          style={styles.imageScroll}
        >
          {images.map((img, i) => {
            const uri = img.url ?? (img.data ? `data:${img.format ?? 'image/png'};base64,${img.data}` : null)
            if (!uri) return null
            return (
              <TouchableOpacity key={i} onPress={() => setSelectedUri(uri)} activeOpacity={0.85}>
                <Image
                  source={{ uri }}
                  style={[styles.thumbnail, { borderColor: colors.border }]}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}
      {message.text.trim() ? (
        <View style={[styles.bubble, { backgroundColor: colors.userBubbleBg }]}>
          <CollapsibleText text={message.text} colors={colors} />
        </View>
      ) : null}
      <ImageLightbox uri={selectedUri} onClose={() => setSelectedUri(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-end',
    marginVertical: 4,
    paddingHorizontal: 12,
    gap: 4,
  },
  fileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    maxWidth: '80%',
  },
  fileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 180,
  },
  fileName: { fontSize: 11, flexShrink: 1 },
  imageScroll: { maxWidth: '80%' },
  imageRow: { gap: 6 },
  thumbnail: {
    width: 120,
    height: 90,
    borderRadius: 10,
    borderWidth: 1,
  },
  bubble: {
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '80%',
  },
  text: { fontSize: 15, lineHeight: 21 },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    opacity: 0.7,
  },
  toggleText: { fontSize: 11 },
})
