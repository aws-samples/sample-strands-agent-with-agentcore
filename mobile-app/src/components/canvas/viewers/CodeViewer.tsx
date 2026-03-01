import React, { useCallback } from 'react'
import { ScrollView, Text, View, Pressable, StyleSheet, Share } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/context/ThemeContext'

interface Props {
  content: string
  title?: string
}

export default function CodeViewer({ content, title }: Props) {
  const { colors } = useTheme()

  const handleShare = useCallback(async () => {
    await Share.share({ message: content, title: title ?? 'Code' })
  }, [content, title])

  return (
    <View style={[styles.container, { backgroundColor: colors.codeBg }]}>
      <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
        <Text style={[styles.toolbarTitle, { color: colors.codeText }]} numberOfLines={1}>
          {title ?? 'Code'}
        </Text>
        <Pressable onPress={handleShare} style={styles.copyBtn} hitSlop={8}>
          <Ionicons name="share-outline" size={18} color={colors.codeText} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.code, { color: colors.codeText }]}>{content}</Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarTitle: { flex: 1, fontSize: 13, fontFamily: 'monospace' },
  copyBtn: { padding: 4 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
})
