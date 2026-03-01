import React, { useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

interface Props {
  /** Whether the agent is currently streaming a response */
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
}

/**
 * Multi-line chat input with Send / Stop button.
 *
 * - Send is disabled while streaming.
 * - Stop replaces Send while streaming and calls onStop().
 * - Pressing the Return key on iOS (with the soft keyboard) submits.
 */
export default function ChatInput({ isStreaming, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<TextInput>(null)

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setText('')
  }

  function handleStop() {
    onStop()
  }

  const canSend = text.trim().length > 0 && !isStreaming

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={styles.container}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor="#9ca3af"
          multiline
          numberOfLines={1}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
          editable={!isStreaming}
          accessibilityLabel="Message input"
        />

        {isStreaming ? (
          <Pressable
            style={[styles.actionBtn, styles.stopBtn]}
            onPress={handleStop}
            accessibilityRole="button"
            accessibilityLabel="Stop generation"
          >
            <ActivityIndicator size="small" color="#fff" style={styles.stopSpinner} />
            <Text style={styles.stopText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.actionBtn, styles.sendBtn, !canSend && styles.btnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={[styles.sendText, !canSend && styles.sendTextDisabled]}>↑</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,  // ~5 lines at 22px line-height
    backgroundColor: '#f3f4f6',
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 11 : 10,
    paddingBottom: Platform.OS === 'ios' ? 11 : 10,
    fontSize: 15,
    color: '#111827',
    lineHeight: 22,
  },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtn: { backgroundColor: '#2563eb' },
  stopBtn: {
    backgroundColor: '#ef4444',
    flexDirection: 'row',
    width: 72,
    borderRadius: 21,
    paddingHorizontal: 10,
    gap: 4,
  },
  btnDisabled: { backgroundColor: '#e5e7eb' },
  sendText: { fontSize: 18, color: '#fff', fontWeight: '700', lineHeight: 22 },
  sendTextDisabled: { color: '#9ca3af' },
  stopSpinner: { transform: [{ scale: 0.8 }] },
  stopText: { fontSize: 13, fontWeight: '700', color: '#fff' },
})
