import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { TodoItem } from '../../types/events'

interface Props {
  steps: Array<{ stepNumber: number; content: string }>
  todos: TodoItem[]
}

function TodoRow({ item }: { item: TodoItem }) {
  const done = item.status === 'completed'
  const inProgress = item.status === 'in_progress'
  return (
    <View style={styles.todoRow}>
      <Text style={[styles.check, done && styles.checkDone, inProgress && styles.checkProgress]}>
        {done ? '✓' : inProgress ? '◉' : '○'}
      </Text>
      <Text style={[styles.todoText, done && styles.todoTextDone]} numberOfLines={2}>
        {item.content}
      </Text>
      {item.priority ? (
        <View style={styles.priorityBadge}>
          <Text style={styles.priorityText}>{item.priority}</Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Checklist UI for code_step and code_todo_update events.
 */
export default function CodeStepList({ steps, todos }: Props) {
  if (steps.length === 0 && todos.length === 0) return null

  return (
    <View style={styles.container}>
      {steps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Execution steps</Text>
          <ScrollView style={styles.stepScroll} nestedScrollEnabled>
            {steps.map((s, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={styles.stepDot}>·</Text>
                <Text style={styles.stepText}>{`Step ${s.stepNumber}: ${s.content}`}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {todos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            📋 Tasks ({todos.filter(t => t.status === 'completed').length}/{todos.length})
          </Text>
          {todos.map(t => (
            <TodoRow key={t.id} item={t} />
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 4 },
  section: { gap: 4 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stepScroll: { maxHeight: 100 },
  stepRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingVertical: 1 },
  stepDot: { color: '#9ca3af', fontSize: 14, lineHeight: 18 },
  stepText: { fontSize: 12, color: '#374151', lineHeight: 18, flex: 1 },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 3,
  },
  check: { fontSize: 13, color: '#9ca3af', width: 14 },
  checkDone: { color: '#22c55e' },
  checkProgress: { color: '#f59e0b' },
  todoText: { fontSize: 12, color: '#374151', flex: 1 },
  todoTextDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  priorityBadge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  priorityText: { fontSize: 10, color: '#6b7280' },
})
