import React, { useCallback, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as FileSystem from 'expo-file-system/legacy'
import { shareAsync } from 'expo-sharing'
import { useTheme } from '@/context/ThemeContext'
import { apiGet, apiPost } from '@/lib/api-client'
import { ENDPOINTS } from '@/lib/constants'
import type { Artifact } from '@/types/artifact'

interface Props {
  artifact: Artifact
}

const TYPE_LABELS: Record<string, string> = {
  word_document: 'Word Document',
  excel_spreadsheet: 'Excel Spreadsheet',
  powerpoint_presentation: 'PowerPoint Presentation',
}

const TYPE_ICONS: Record<string, string> = {
  word_document: 'document-text-outline',
  excel_spreadsheet: 'grid-outline',
  powerpoint_presentation: 'easel-outline',
}

const ARTIFACT_TYPE_TO_DOC_TYPE: Record<string, string> = {
  word_document: 'word',
  excel_spreadsheet: 'excel',
  powerpoint_presentation: 'powerpoint',
}

/** Resolve an s3_key → presigned HTTPS URL */
async function toPresignedUrl(s3Key: string): Promise<string> {
  const res = await apiPost<{ url?: string; error?: string }>(ENDPOINTS.s3PresignedUrl, { s3Key })
  if (!res.url?.startsWith('https://')) {
    throw new Error(`Invalid presigned URL: ${res.url ?? '(empty)'}`)
  }
  return res.url
}

/** Lookup s3_key from the workspace files API using session + filename */
async function lookupS3Key(artifact: Artifact): Promise<string | undefined> {
  const docType = ARTIFACT_TYPE_TO_DOC_TYPE[artifact.type]
  if (!docType) return undefined
  const filename = artifact.metadata?.filename as string | undefined
  const sessionId = artifact.sessionId

  const data = await apiGet<{
    files?: Array<{ filename: string; s3_key?: string }>
  }>(ENDPOINTS.workspaceFiles(docType), { 'X-Session-ID': sessionId })

  const files = data.files ?? []
  // Match by filename if we have one, otherwise take the first file
  const match = filename
    ? files.find(f => f.filename === filename)
    : files[0]
  return match?.s3_key
}

export default function OfficeViewer({ artifact }: Props) {
  const { colors } = useTheme()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // s3_key may come from live-streaming metadata OR be fetched on demand
  const storedS3Key = artifact.metadata?.s3_key as string | undefined
  const cachedUrl = typeof artifact.content === 'string' && artifact.content.startsWith('https://')
    ? artifact.content
    : undefined

  const handleOpen = useCallback(async () => {
    setOpening(true)
    setError(null)
    try {
      let url: string | undefined

      if (cachedUrl) {
        // Already have a valid https URL
        url = cachedUrl
      } else {
        // Resolve s3_key: use stored one or look it up from workspace files
        const s3Key = storedS3Key ?? await lookupS3Key(artifact)
        if (!s3Key) {
          setError('Could not find the file. The document may have been deleted or the session expired.')
          return
        }
        url = await toPresignedUrl(s3Key)
      }

      // Download to cache, then open native Share Sheet → Word / PowerPoint / Excel / Pages / Keynote
      const filename = (artifact.metadata?.filename as string | undefined)
        ?? url.split('/').find(s => /\.\w+/.test(s))?.split('?')[0]
        ?? 'document'
      const localUri = (FileSystem.cacheDirectory ?? '') + filename
      const { uri } = await FileSystem.downloadAsync(url.trim(), localUri)
      await shareAsync(uri, { dialogTitle: artifact.title })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }, [artifact, storedS3Key, cachedUrl])

  const iconName = TYPE_ICONS[artifact.type] ?? 'document-outline'
  const label = TYPE_LABELS[artifact.type] ?? 'Document'

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Ionicons name={iconName as any} size={64} color={colors.primary} />
      <Text style={[styles.title, { color: colors.text }]}>{artifact.title}</Text>
      {artifact.metadata?.filename && (
        <Text style={[styles.filename, { color: colors.textMuted }]}>
          {artifact.metadata.filename as string}
        </Text>
      )}
      <Text style={[styles.typeLabel, { color: colors.textSecondary }]}>{label}</Text>

      <Pressable
        style={[styles.btn, { backgroundColor: colors.primary, opacity: opening ? 0.7 : 1 }]}
        onPress={handleOpen}
        disabled={opening}
      >
        {opening
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="eye-outline" size={16} color="#fff" />
        }
        <Text style={styles.btnText}>{opening ? 'Loading…' : 'Preview'}</Text>
      </Pressable>

      {error && (
        <Text selectable style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  filename: { fontSize: 13, textAlign: 'center' },
  typeLabel: { fontSize: 14 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  errorText: { fontSize: 12, textAlign: 'center', marginTop: 4 },
})
