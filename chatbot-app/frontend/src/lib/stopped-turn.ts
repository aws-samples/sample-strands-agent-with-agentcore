import type { Message } from '@/types/chat'

export const STOPPED_TEXT = '*Stopped by you.*'

/** Preserve partial output and settle just the current user turn. */
export function markTurnStopped(messages: Message[]): Message[] {
  let userIndex = messages.length - 1
  while (userIndex >= 0 && messages[userIndex].sender !== 'user') userIndex--
  if (userIndex < 0) return messages
  const result = messages.map((message, index) => index <= userIndex ? message : ({
    ...message,
    isStreaming: false,
    toolExecutions: message.toolExecutions?.map(tool => !tool.isComplete
      ? { ...tool, isComplete: true, isCancelled: true }
      : tool),
  }))
  if (!result.slice(userIndex + 1).some(message => message.text.endsWith(STOPPED_TEXT))) {
    result.push({
      id: `stopped:${messages[userIndex].id}`,
      sender: 'bot',
      isStreaming: false,
      text: `\n\n${STOPPED_TEXT}`,
      timestamp: new Date().toISOString(),
    })
  }
  return result
}

const snapshotKey = (sessionId: string) => `stopped-turn:${sessionId}`

/** Bridge the short gap between stop acceptance and server history persistence. */
export function rememberStoppedTurn(sessionId: string, runId: string, messages: Message[]): void {
  let start = messages.length - 1
  while (start >= 0 && messages[start].sender !== 'user') start--
  if (start < 0) return
  const stopped = markTurnStopped(messages.slice(start)).map(message => ({
    id: message.id, sender: message.sender, text: message.text,
    timestamp: message.timestamp, rawTimestamp: message.rawTimestamp,
    originEventId: `foreground:${runId}`,
    isStreaming: false,
    uploadedFiles: message.uploadedFiles,
  })).filter(message => message.sender === 'user' || message.text)
  try {
    sessionStorage.setItem(snapshotKey(sessionId), JSON.stringify({ runId, savedAt: Date.now(), messages: stopped }))
  } catch { /* History remains the durable source if storage is unavailable. */ }
}

export function restoreStoppedTurn(sessionId: string, history: Message[]): Message[] {
  try {
    const raw = sessionStorage.getItem(snapshotKey(sessionId))
    if (!raw) return history
    const snapshot = JSON.parse(raw)
    if (!Array.isArray(snapshot.messages) || typeof snapshot.runId !== 'string') return history
    const origin = `foreground:${snapshot.runId}`
    const indices = history.map((message, index) => message.originEventId === origin ? index : -1).filter(index => index >= 0)
    const saved = history.some(message => message.originEventId === origin && message.text.endsWith(STOPPED_TEXT))
    const newerTurn = history.some(message => message.sender === 'user' && message.originEventId !== origin && (message.rawTimestamp || 0) > snapshot.savedAt)
    if (saved || newerTurn || Date.now() - snapshot.savedAt > 60 * 60 * 1000) {
      sessionStorage.removeItem(snapshotKey(sessionId))
      return history
    }
    if (indices.length) {
      return [...history.slice(0, indices[0]), ...snapshot.messages, ...history.slice(indices[indices.length - 1] + 1)]
    }
    return [...history, ...snapshot.messages]
  } catch { return history }
}
