import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ToolExecution } from '../../types/chat'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Detect if a tool execution is a code-agent call. */
export function isCodeAgentExecution(t: ToolExecution): boolean {
  if (t.toolName === 'code_agent' || t.toolName === 'agentcore_code-agent') return true
  if (t.toolName === 'skill_executor') {
    try {
      const p = JSON.parse(t.toolInput) as Record<string, unknown>
      if (p.tool_name === 'code_agent') return true
    } catch { /* ignore */ }
  }
  return false
}

/** Strip workspace prefix from paths. */
function cleanContent(s: string): string {
  return s.replace(
    /\/(?:tmp\/)?workspaces\/[^\s/]+\/[^\s/]+(?:\/(\S+))?/g,
    (_m, rest) => rest || '.',
  )
}

function shortenPath(p: string): string {
  const m = p.match(/\/workspaces\/[^/]+\/[^/]+\/(.+)$/)
  if (m) return m[1]
  return p.split('/').pop() || p
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  toolExecution: ToolExecution
}

/**
 * Terminal-style live log for code agent execution.
 * Shows steps as they stream in, auto-scrolls, and collapses when complete.
 */
export default function CodeAgentTerminal({ toolExecution }: Props) {
  const { codeSteps, codeTodos, codeResultMeta, isComplete } = toolExecution
  const scrollRef = useRef<ScrollView>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Pulse animation for the live indicator
  const pulseAnim = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    if (isComplete) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [isComplete, pulseAnim])

  // Auto-scroll on new steps
  useEffect(() => {
    if (!collapsed) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 30)
    }
  }, [codeSteps.length, collapsed])

  // Auto-collapse when done
  useEffect(() => {
    if (isComplete) setCollapsed(true)
  }, [isComplete])

  const toggleCollapse = useCallback(() => setCollapsed(v => !v), [])

  if (codeSteps.length === 0 && !codeResultMeta) return null

  const completedTodos = codeTodos?.filter(t => t.status === 'completed').length ?? 0
  const totalTodos = codeTodos?.length ?? 0

  return (
    <View style={styles.container}>
      {/* Title bar */}
      <Pressable style={styles.titleBar} onPress={isComplete ? toggleCollapse : undefined}>
        <Ionicons name="terminal-outline" size={12} color="#4ade80" />
        <Text style={styles.titleText}>code-agent</Text>
        {isComplete && (
          <Text style={styles.stepCount}>({codeSteps.length} steps)</Text>
        )}
        <View style={styles.titleRight}>
          {isComplete ? (
            <Ionicons
              name={collapsed ? 'chevron-down' : 'chevron-up'}
              size={12}
              color="#6b7280"
            />
          ) : (
            <View style={styles.dotRow}>
              <Animated.View key="d1" style={[styles.dot, { opacity: pulseAnim }]} />
              <Animated.View key="d2" style={[styles.dot, { opacity: pulseAnim }]} />
              <Animated.View key="d3" style={[styles.dot, { opacity: pulseAnim }]} />
            </View>
          )}
        </View>
      </Pressable>

      {/* Log area */}
      {!collapsed && (
        <ScrollView
          ref={scrollRef}
          style={styles.logArea}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {codeSteps.map((step) => {
            const isHeartbeat =
              step.content.startsWith('Working...') ||
              step.content.startsWith('Code agent started')
            return (
              <View key={step.stepNumber} style={styles.logRow}>
                <Text style={[styles.prefix, isHeartbeat ? styles.prefixHeartbeat : styles.prefixCmd]}>
                  {isHeartbeat ? '●' : '$'}
                </Text>
                <Text style={[styles.logText, isHeartbeat ? styles.logTextHeartbeat : undefined]}>
                  {cleanContent(step.content)}
                </Text>
              </View>
            )
          })}
        </ScrollView>
      )}

      {/* Todo checklist (shown when there are todos) */}
      {!collapsed && totalTodos > 0 && (
        <View style={styles.todoSection}>
          <Text style={styles.todoHeader}>
            Tasks ({completedTodos}/{totalTodos})
          </Text>
          {codeTodos!.map(todo => (
            <View key={todo.id} style={styles.todoRow}>
              <Text style={[
                styles.todoIcon,
                todo.status === 'completed' && styles.todoIconDone,
                todo.status === 'in_progress' && styles.todoIconProgress,
              ]}>
                {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}
              </Text>
              <Text
                style={[
                  styles.todoText,
                  todo.status === 'completed' && styles.todoTextDone,
                ]}
                numberOfLines={2}
              >
                {todo.content}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Completion summary */}
      {isComplete && codeResultMeta && (
        <View style={[
          styles.summary,
          codeResultMeta.status === 'completed' ? styles.summaryOk : styles.summaryFail,
        ]}>
          <Text style={styles.summaryText}>
            {codeResultMeta.status === 'completed' ? '✓' : '✕'}{' '}
            {codeResultMeta.steps} steps · {codeResultMeta.files_changed.length} file
            {codeResultMeta.files_changed.length !== 1 ? 's' : ''} changed
          </Text>
          {codeResultMeta.files_changed.length > 0 && !collapsed && (
            <View style={styles.filesBox}>
              {codeResultMeta.files_changed.map(f => (
                <View key={f} style={styles.fileRow}>
                  <Ionicons name="document-outline" size={10} color="#6b7280" />
                  <Text style={styles.fileText} numberOfLines={1}>{shortenPath(f)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  titleText: {
    fontSize: 11,
    color: '#9ca3af',
    fontFamily: 'Courier',
    fontWeight: '500',
  },
  stepCount: {
    fontSize: 10,
    color: '#6b7280',
    fontFamily: 'Courier',
  },
  titleRight: { marginLeft: 'auto' },
  dotRow: { flexDirection: 'row', gap: 3 },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4ade80',
  },
  logArea: {
    maxHeight: 160,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  logRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 2,
  },
  prefix: {
    fontSize: 11,
    fontFamily: 'Courier',
    width: 12,
    flexShrink: 0,
  },
  prefixCmd: { color: 'rgba(74,222,128,0.7)' },
  prefixHeartbeat: { color: '#60a5fa' },
  logText: {
    fontSize: 11,
    fontFamily: 'Courier',
    color: '#d1d5db',
    flex: 1,
    lineHeight: 16,
  },
  logTextHeartbeat: {
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  todoSection: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 6,
  },
  todoHeader: {
    fontSize: 10,
    color: '#6b7280',
    fontFamily: 'Courier',
    marginBottom: 4,
    fontWeight: '600',
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 2,
  },
  todoIcon: { fontSize: 11, color: '#6b7280', width: 14 },
  todoIconDone: { color: '#4ade80' },
  todoIconProgress: { color: '#60a5fa' },
  todoText: { fontSize: 11, color: '#d1d5db', flex: 1, lineHeight: 16 },
  todoTextDone: { color: '#6b7280', textDecorationLine: 'line-through' },
  summary: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  summaryOk: { backgroundColor: 'rgba(74,222,128,0.08)' },
  summaryFail: { backgroundColor: 'rgba(239,68,68,0.08)' },
  summaryText: {
    fontSize: 11,
    color: '#9ca3af',
    fontFamily: 'Courier',
    fontWeight: '600',
  },
  filesBox: { marginTop: 4, gap: 2 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fileText: {
    fontSize: 10,
    color: '#6b7280',
    fontFamily: 'Courier',
    flex: 1,
  },
})
