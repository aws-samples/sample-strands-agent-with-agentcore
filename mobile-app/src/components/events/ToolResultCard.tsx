import React, { useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'
import type { ImageData } from '../../types/events'
import type { TodoItem } from '../../types/events'

interface CodeMeta {
  files_changed: string[]
  todos: TodoItem[]
  steps: number
  status: 'completed' | 'failed'
}

interface Props {
  result: string
  images?: ImageData[]
  status?: string
  codeSteps?: Array<{ stepNumber: number; content: string }>
  codeTodos?: TodoItem[]
  codeResultMeta?: CodeMeta
}

const COLLAPSED_LINES = 12

/**
 * Extract human-readable text from a tool result string.
 * Handles MCP content arrays, nested JSON, and plain text.
 */
function extractReadableText(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()

  // Try to parse as JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Not JSON — return as-is
    return trimmed
  }

  // MCP content array: [{text: "..."}, {text: "..."}, ...]
  if (Array.isArray(parsed)) {
    const texts: string[] = []
    for (const block of parsed) {
      if (typeof block === 'string') {
        texts.push(block)
      } else if (block && typeof block === 'object') {
        const obj = block as Record<string, unknown>
        if (typeof obj.text === 'string') {
          texts.push(extractNestedText(obj.text))
        }
      }
    }
    if (texts.length > 0) return texts.join('\n\n')
  }

  // Single object with a 'text' field
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    if (typeof obj.text === 'string') return extractNestedText(obj.text)
    if (typeof obj.result === 'string') return extractNestedText(obj.result)
    if (typeof obj.content === 'string') return extractNestedText(obj.content)
    // Object with key-value pairs — format as readable lines
    return formatObject(obj)
  }

  return trimmed
}

/** Try to parse a string that might itself be JSON, otherwise return as-is. */
function extractNestedText(text: string): string {
  const t = text.trim()
  try {
    const inner = JSON.parse(t)
    if (typeof inner === 'string') return inner
    if (Array.isArray(inner)) return extractReadableText(t)
    if (inner && typeof inner === 'object') return formatObject(inner as Record<string, unknown>)
  } catch { /* not JSON */ }
  return t
}

/** Format a plain object as human-readable key-value lines. */
function formatObject(obj: Record<string, unknown>, depth = 0): string {
  if (depth > 2) return JSON.stringify(obj)
  const lines: string[] = []
  for (const [key, val] of Object.entries(obj)) {
    // Skip image/binary data
    if (key === 'image' || key === '__bytes_encoded__' || key === 'bytes') continue
    const label = key.replace(/_/g, ' ')
    if (val === null || val === undefined) continue
    if (typeof val === 'string') {
      if (val.length > 500) {
        lines.push(`${label}: ${val.slice(0, 500)}...`)
      } else {
        lines.push(`${label}: ${val}`)
      }
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      lines.push(`${label}: ${val}`)
    } else if (Array.isArray(val)) {
      if (val.length === 0) continue
      if (val.every(v => typeof v === 'string')) {
        lines.push(`${label}: ${val.join(', ')}`)
      } else {
        lines.push(`${label}: ${val.length} items`)
      }
    } else if (typeof val === 'object') {
      lines.push(`${label}:`)
      lines.push(formatObject(val as Record<string, unknown>, depth + 1))
    }
  }
  return lines.join('\n')
}

export default function ToolResultCard({
  result,
  images,
  status,
  codeSteps,
  codeTodos,
  codeResultMeta,
}: Props) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const isError = status === 'error'
  const hasImages = (images?.length ?? 0) > 0
  const hasCode = (codeSteps?.length ?? 0) > 0 || (codeTodos?.length ?? 0) > 0

  const readableResult = useMemo(() => extractReadableText(result), [result])
  const lines = readableResult.split('\n')
  const needsCollapse = lines.length > COLLAPSED_LINES || readableResult.length > 800

  if (!readableResult && !hasImages && !hasCode && !codeResultMeta) return null

  return (
    <View style={[styles.card, { backgroundColor: colors.bgTertiary, borderColor: isError ? colors.errorBorder : colors.border }]}>
      {isError && (
        <View style={[styles.statusBadge, { backgroundColor: colors.errorBg }]}>
          <Text style={[styles.statusText, { color: colors.error }]}>Error</Text>
        </View>
      )}

      {readableResult ? (
        <View>
          <Text
            style={[styles.resultText, { color: colors.textSecondary }]}
            numberOfLines={expanded ? undefined : COLLAPSED_LINES}
          >
            {readableResult}
          </Text>
          {needsCollapse && (
            <Pressable onPress={() => setExpanded(v => !v)} style={styles.toggleBtn}>
              <Text style={[styles.toggleText, { color: colors.primary }]}>{expanded ? 'Show less' : 'Show more'}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {hasImages && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
          {images!.map((img, i) => {
            const uri =
              img.type === 'url' && img.url
                ? img.url
                : img.data && img.format
                ? `data:image/${img.format};base64,${img.data}`
                : null
            return uri ? (
              <Image
                key={i}
                source={{ uri }}
                style={[styles.thumb, { backgroundColor: colors.border }]}
                resizeMode="cover"
                accessibilityLabel={img.title ?? `Tool result image ${i + 1}`}
              />
            ) : null
          })}
        </ScrollView>
      )}

      {hasCode && (
        <View style={styles.codeSection}>
          {codeSteps && codeSteps.length > 0 && (
            <Text style={[styles.codeMeta, { color: colors.textMuted }]}>
              {codeSteps.length} execution step{codeSteps.length !== 1 ? 's' : ''}
            </Text>
          )}
          {codeTodos && codeTodos.length > 0 && (
            <Text style={[styles.codeMeta, { color: colors.textMuted }]}>
              {codeTodos.filter(t => t.status === 'completed').length}/{codeTodos.length} tasks
            </Text>
          )}
        </View>
      )}

      {codeResultMeta && (
        <View style={[
          styles.metaBadge,
          { backgroundColor: codeResultMeta.status === 'completed' ? colors.successBg : colors.errorBg },
        ]}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {codeResultMeta.status === 'completed' ? 'Completed' : 'Failed'}{' · '}
            {codeResultMeta.steps} steps · {codeResultMeta.files_changed.length} files
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
    marginBottom: 4,
    gap: 10,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  resultText: { fontSize: 13, lineHeight: 20 },
  toggleBtn: { marginTop: 6 },
  toggleText: { fontSize: 12, fontWeight: '600' },
  imageRow: { marginTop: 4 },
  thumb: {
    width: 90,
    height: 90,
    borderRadius: 6,
    marginRight: 8,
  },
  codeSection: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  codeMeta: { fontSize: 12 },
  metaBadge: { borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  metaText: { fontSize: 12, fontWeight: '600' },
})
