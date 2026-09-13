import { describe, expect, it } from 'vitest'
import { markTurnStopped, STOPPED_TEXT } from '@/lib/stopped-turn'
import { createToolExecution } from '@/utils/messageParser'
import type { Message } from '@/types/chat'
const msg = (id: string, sender: 'user' | 'bot', text: string, extra = {}): Message => ({ id, sender, text, timestamp: '', ...extra })

describe('stopped turn', () => {
  it('keeps partial text, settles the active tool, and adds one durable-style notice', () => {
    const previous = msg('old', 'bot', 'Earlier reply')
    const messages = [previous, msg('user', 'user', 'Help me'), msg('partial', 'bot', 'First step', { isStreaming: true }), msg('tool', 'bot', '', { isToolMessage: true, toolExecutions: [{ id: 't', isComplete: false }] })]
    const stopped = markTurnStopped(messages)
    expect(stopped[0]).toBe(previous)
    expect(stopped[2]).toMatchObject({ text: 'First step', isStreaming: false })
    expect(stopped[3].toolExecutions?.[0]).toMatchObject({ isComplete: true, isCancelled: true })
    expect(stopped[stopped.length - 1]?.text.trim()).toBe(STOPPED_TEXT)
    expect(markTurnStopped(stopped)).toEqual(stopped)
  })
  it('shows a notice even when stopped before first output', () => {
    expect(markTurnStopped([msg('u', 'user', 'Hello')])[1]?.text.trim()).toBe(STOPPED_TEXT)
  })
  it('restores a cancelled tool inside a successful transport envelope as cancelled', () => {
    const restored = createToolExecution({ toolUseId: 't', name: 'skill_executor', input: { tool_name: 'code_agent' } }, { status: 'success', content: [{ text: '{"status":"cancelled","message":"A2A task stopped by user"}' }] }, {})
    expect(restored).toMatchObject({ toolName: 'code_agent', isComplete: true, isCancelled: true })
  })
})

import { vi } from 'vitest'
import { rememberStoppedTurn, restoreStoppedTurn } from '@/lib/stopped-turn'
it('keeps an immediately cancelled turn visible until server history catches up', () => {
  let stored: string | null = null
  vi.mocked(sessionStorage.setItem).mockImplementation((_key, value) => { stored = value })
  vi.mocked(sessionStorage.getItem).mockImplementation(() => stored)
  vi.mocked(sessionStorage.removeItem).mockImplementation(() => { stored = null })
  rememberStoppedTurn('s', 'run', [msg('user', 'user', 'Start'), msg('partial', 'bot', 'Partial')])
  const pending = restoreStoppedTurn('s', [])
  expect(pending.map(message => message.text.trim())).toEqual(['Start', 'Partial', STOPPED_TEXT])
  const durable = [msg('server-user', 'user', 'Start', { originEventId: 'foreground:run' }), msg('server-bot', 'bot', `Partial with final buffered words\n\n${STOPPED_TEXT}`, { originEventId: 'foreground:run' })]
  expect(restoreStoppedTurn('s', durable)).toBe(durable)
  expect(stored).toBeNull()
})
