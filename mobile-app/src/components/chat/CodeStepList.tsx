import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { TodoItem } from '../../types/events'

interface Props {
  steps: Array<{ stepNumber: number; content: string }>
  todos: TodoItem[]
  resultMeta?: { files_changed: string[]; steps: number; status: 'completed' | 'failed' }
}

function TodoRow({ item }: { item: TodoItem }) {
  const done = item.status === 'completed'
  return (
    <View style={styles.todoRow}>
      <Text style={[styles.todoCheck, done && styles.todoDone]}>{done ? '✓' : '○'}</Text>
      <Text style={[styles.todoText, done && styles.todoTextDone]}>{item.content}</Text>
      {item.priority ? <Text style={styles.priority}>{item.priority}</Text> : null}
    </View>
  )
}

export default function CodeStepList({ steps, todos, resultMeta }: Props) {
  if (steps.length === 0 && todos.length === 0 && !resultMeta) return null

  return (
    <View style={styles.container}>
      {steps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Steps</Text>
          <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
            {steps.map((s, i) => (
              <Text key={i} style={styles.stepText}>
                {`Step ${s.stepNumber}: ${s.content}`}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {todos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 Tasks</Text>
          {todos.map(t => (
            <TodoRow key={t.id} item={t} />
          ))}
        </View>
      )}

      {resultMeta && (
        <View style={[styles.resultRow, resultMeta.status === 'completed' ? styles.success : styles.failure]}>
          <Text style={styles.resultText}>
            {resultMeta.status === 'completed' ? '✅' : '❌'}{' '}
            {resultMeta.steps} steps · {resultMeta.files_changed.length} files changed ·{' '}
            {resultMeta.status}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: 8, gap: 6 },
  section: { gap: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase' },
  stepText: { fontSize: 12, color: '#374151', paddingVertical: 1 },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  todoCheck: { fontSize: 12, color: '#9ca3af', width: 14 },
  todoDone: { color: '#22c55e' },
  todoText: { fontSize: 12, color: '#374151', flex: 1 },
  todoTextDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  priority: { fontSize: 10, color: '#6b7280', backgroundColor: '#f3f4f6', borderRadius: 4, paddingHorizontal: 4 },
  resultRow: {
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
  },
  success: { backgroundColor: '#f0fdf4' },
  failure: { backgroundColor: '#fef2f2' },
  resultText: { fontSize: 12, fontWeight: '600' },
})
