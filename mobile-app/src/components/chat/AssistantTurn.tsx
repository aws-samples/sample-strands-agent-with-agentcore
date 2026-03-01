import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native'
import ImageLightbox from './ImageLightbox'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import { useSessionContext } from '../../context/SessionContext'
import type { Message } from '../../types/chat'
import type { ImageData } from '../../types/events'
import StreamingText from '../events/StreamingText'
import ReasoningBlock from '../events/ReasoningBlock'
import ToolIconRow from '../events/ToolIconRow'
import BrowserProgressList from '../events/BrowserProgressList'
import ResearchProgressSteps from '../events/ResearchProgressSteps'
import CodeAgentTerminal, { isCodeAgentExecution } from '../events/CodeAgentTerminal'
import MapCard from '../events/MapCard'
import ChartCard from '../events/ChartCard'
import { parseVisualizationResult } from '../../lib/visualization-utils'
import { shareCodeAgentFiles } from '../../lib/code-agent-share'

const INLINE_IMAGE_TOOLS = new Set([
  'create_visual_design', 'generate_chart',
  'browser_act', 'browser_automation',
])

interface Props {
  message: Message
}

function SwarmChips({ message }: { message: Message }) {
  const { colors } = useTheme()
  if (message.swarmAgentSteps.length === 0) return null
  return (
    <View style={styles.swarmRow}>
      {message.swarmAgentSteps.map((step, i) => (
        <React.Fragment key={step.nodeId}>
          <View style={[styles.swarmChip, { backgroundColor: colors.primaryBg }, step.status === 'failed' && { backgroundColor: colors.errorBg }]}>
            <Text style={styles.swarmChipIcon}>
              {step.status === 'running' ? '◉' : step.status === 'completed' ? '✓' : '✕'}
            </Text>
            <Text style={[styles.swarmChipText, { color: colors.primaryDark }]} numberOfLines={1}>{step.description}</Text>
          </View>
          {step.handoffTo != null && i < message.swarmAgentSteps.length - 1 && (
            <Text style={[styles.swarmArrow, { color: colors.textMuted }]}>→</Text>
          )}
        </React.Fragment>
      ))}
      {message.swarmCompleted && (
        <View style={[styles.swarmCompletedChip, { backgroundColor: colors.successBg }]}>
          <Text style={[styles.swarmCompletedText, { color: colors.successText }]}>
            ✓ {message.swarmAgentSteps.length} agents
          </Text>
        </View>
      )}
    </View>
  )
}

function ImageStrip({ images }: { images: ImageData[] }) {
  const [selectedUri, setSelectedUri] = useState<string | null>(null)
  if (images.length === 0) return null
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.imageStrip}
      >
        {images.map((img, i) => {
          const uri = img.url ?? (img.data ? `data:${img.format ?? 'image/png'};base64,${img.data}` : null)
          if (!uri) return null
          return (
            <TouchableOpacity key={i} onPress={() => setSelectedUri(uri)} activeOpacity={0.85}>
              <Image
                source={{ uri }}
                style={styles.inlineImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )
        })}
      </ScrollView>
      <ImageLightbox uri={selectedUri} onClose={() => setSelectedUri(null)} />
    </>
  )
}

export default function AssistantTurn({ message }: Props) {
  const { colors, isDetailed } = useTheme()
  const { activeSessionId } = useSessionContext()
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)

  // Check for completed code agent executions (with files info from streaming, or just completed from history)
  const completedCodeAgent = useMemo(() => {
    return message.toolExecutions.find(
      t => isCodeAgentExecution(t) && t.isComplete,
    )
  }, [message.toolExecutions])

  const handleShare = useCallback(async () => {
    if (sharing) return
    setSharing(true)
    try {
      await shareCodeAgentFiles(activeSessionId)
    } catch (e: any) {
      Alert.alert('Share Failed', e.message || 'Could not share files')
    } finally {
      setSharing(false)
    }
  }, [activeSessionId, sharing])

  // Parse visualization data from completed tool results
  const visualizations = useMemo(() => {
    const results: Array<{ id: string; mapData?: any; chartData?: any }> = []
    for (const t of message.toolExecutions) {
      if (!t.isComplete || !t.toolResult) continue
      const viz = parseVisualizationResult(t.toolResult)
      if (viz) results.push({ id: t.id, ...viz })
    }
    return results
  }, [message.toolExecutions])

  // Collect images from visual-design tool executions
  const toolImages = useMemo(() => {
    const imgs: ImageData[] = []
    for (const t of message.toolExecutions) {
      if (!t.images || t.images.length === 0) continue
      // skill_executor wraps inner tools — check toolInput for actual tool_name
      let innerName = t.toolName
      try {
        const parsed = JSON.parse(t.toolInput)
        if (parsed.tool_name) innerName = parsed.tool_name
      } catch { /* ignore */ }
      if (INLINE_IMAGE_TOOLS.has(innerName)) {
        imgs.push(...t.images)
      }
    }
    return imgs
  }, [message.toolExecutions])

  const handleCopy = useCallback(async () => {
    if (!message.text) return
    await Clipboard.setStringAsync(message.text)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [message.text])

  const hasCodeAgent = message.toolExecutions.some(t => isCodeAgentExecution(t) && !t.isComplete)
  const hasContent =
    message.text ||
    (message.images && message.images.length > 0) ||
    message.swarmAgentSteps.length > 0 ||
    hasCodeAgent ||
    (isDetailed && (
      message.toolExecutions.length > 0 ||
      !!message.reasoningText ||
      message.browserProgress.length > 0 ||
      message.researchProgress.length > 0
    ))

  if (!hasContent && !message.isStreaming) return null

  const showActions = !!message.text && !message.isStreaming

  return (
    <View style={styles.wrapper}>
      <SwarmChips message={message} />

      {isDetailed && message.reasoningText ? (
        <ReasoningBlock text={message.reasoningText} />
      ) : null}

      {message.text ? (
        <StreamingText text={message.text} isStreaming={message.isStreaming} />
      ) : null}

      {message.isStreaming && !message.text && (
        <Text style={[styles.cursor, { color: colors.primary }]}>▌</Text>
      )}

      {message.images && message.images.length > 0 && (
        <ImageStrip images={message.images} />
      )}

      {/* Visual design tool images (rendered outside tool containers) */}
      {toolImages.length > 0 && <ImageStrip images={toolImages} />}

      {/* Code agent terminal — shown only while running */}
      {message.toolExecutions.filter(t => isCodeAgentExecution(t) && !t.isComplete).map(t => (
        <CodeAgentTerminal key={t.id} toolExecution={t} />
      ))}

      {/* (Code agent share button rendered in actionRow below) */}

      {/* Inline visualization cards (always shown when data is available) */}
      {visualizations.map(viz => (
        <React.Fragment key={viz.id}>
          {viz.mapData && <MapCard mapData={viz.mapData} />}
          {viz.chartData && <ChartCard chartData={viz.chartData} />}
        </React.Fragment>
      ))}

      {/* Detailed mode: tappable icon row (tap → result modal). Minimal: nothing. */}
      {isDetailed && message.toolExecutions.length > 0 && (
        <ToolIconRow toolExecutions={message.toolExecutions} />
      )}

      {isDetailed && message.browserProgress.length > 0 && (
        <BrowserProgressList steps={message.browserProgress} />
      )}

      {isDetailed && message.researchProgress.length > 0 && (
        <ResearchProgressSteps steps={message.researchProgress} />
      )}

      {(showActions || completedCodeAgent) && (
        <View style={styles.actionRow}>
          {showActions && (
            <Pressable
              onPress={handleCopy}
              hitSlop={8}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: pressed ? colors.border : 'transparent' },
              ]}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={15}
                color={copied ? colors.successText : colors.textMuted}
              />
            </Pressable>
          )}
          {completedCodeAgent && (
            <Pressable
              onPress={handleShare}
              disabled={sharing}
              hitSlop={8}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: pressed ? colors.border : 'transparent' },
              ]}
            >
              {sharing ? (
                <ActivityIndicator size={14} color={colors.textMuted} />
              ) : (
                <Ionicons name="share-outline" size={15} color={colors.textMuted} />
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 6,
    paddingHorizontal: 16,
    gap: 6,
  },
  cursor: { fontSize: 14 },
  imageStrip: { gap: 8, paddingVertical: 4 },
  inlineImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
  },
  swarmRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  swarmChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
    maxWidth: 160,
  },
  swarmChipIcon: { fontSize: 10 },
  swarmChipText: { fontSize: 11, fontWeight: '500' },
  swarmArrow: { fontSize: 12 },
  swarmCompletedChip: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  swarmCompletedText: { fontSize: 11, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    borderRadius: 6,
    padding: 4,
  },
})
