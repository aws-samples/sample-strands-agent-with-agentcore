/**
 * BFF-side in-memory execution event buffer.
 *
 * Stores SSE events per executionId so that a client can reconnect
 * (e.g. after page refresh) and replay all events from the beginning.
 * Works identically in local and cloud modes because the buffer lives
 * inside the BFF (Next.js) process — no direct access to AgentCore needed.
 */

interface BufferedExecution {
  events: string[]                       // raw SSE event strings ("id: N\ndata: {...}\n\n")
  completed: boolean
  completedAt: number | null
  listeners: Set<(event: string) => void>  // live-tail subscribers
}

const executions = new Map<string, BufferedExecution>()

/** TTL for completed executions (5 minutes). */
const COMPLETED_TTL_MS = 5 * 60 * 1000

/** Cleanup interval (30 seconds). */
const CLEANUP_INTERVAL_MS = 30 * 1000

// --- Singleton cleanup timer ---
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanupTimer() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, exec] of executions) {
      if (exec.completed && exec.completedAt && now - exec.completedAt > COMPLETED_TTL_MS) {
        executions.delete(id)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  // Allow the Node.js process to exit even if the timer is still running
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref()
  }
}

// --- Public API ---

export function create(executionId: string): void {
  if (executions.has(executionId)) return
  executions.set(executionId, {
    events: [],
    completed: false,
    completedAt: null,
    listeners: new Set(),
  })
  ensureCleanupTimer()
}

export function append(executionId: string, sseChunk: string): void {
  const exec = executions.get(executionId)
  if (!exec) return
  exec.events.push(sseChunk)
  // Notify live-tail listeners
  for (const listener of exec.listeners) {
    try { listener(sseChunk) } catch { /* ignore */ }
  }
}

export function complete(executionId: string): void {
  const exec = executions.get(executionId)
  if (!exec) return
  exec.completed = true
  exec.completedAt = Date.now()
  // Wake all listeners so they can see the completed flag and exit
  for (const listener of exec.listeners) {
    try { listener('') } catch { /* ignore */ }
  }
}

export function getStatus(executionId: string): 'running' | 'completed' | 'not_found' {
  const exec = executions.get(executionId)
  if (!exec) return 'not_found'
  return exec.completed ? 'completed' : 'running'
}

/**
 * Subscribe to an execution's event stream starting from `cursor`.
 * Yields buffered events from index `cursor`, then live-tails new events
 * until the execution completes.
 */
export async function* subscribe(
  executionId: string,
  cursor: number,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const exec = executions.get(executionId)
  if (!exec) return

  // 1. Replay buffered events from cursor
  let index = cursor
  while (index < exec.events.length) {
    yield exec.events[index]
    index++
  }

  // 2. If already completed, we're done
  if (exec.completed) return

  // 3. Live-tail: wait for new events
  while (!exec.completed) {
    if (signal?.aborted) return

    // Wait for next event via listener
    const event = await new Promise<string>((resolve) => {
      // Check abort signal
      if (signal?.aborted) { resolve(''); return }

      const onEvent = (evt: string) => {
        exec.listeners.delete(onEvent)
        signal?.removeEventListener('abort', onAbort)
        resolve(evt)
      }
      const onAbort = () => {
        exec.listeners.delete(onEvent)
        resolve('')
      }

      exec.listeners.add(onEvent)
      signal?.addEventListener('abort', onAbort, { once: true })

      // Check if new events appeared while we were setting up
      if (index < exec.events.length || exec.completed) {
        exec.listeners.delete(onEvent)
        signal?.removeEventListener('abort', onAbort)
        resolve('')
      }
    })

    if (signal?.aborted) return

    // Drain any new events that arrived (the listener just wakes us up;
    // actual data is read from the events array to avoid double-yield).
    while (index < exec.events.length) {
      yield exec.events[index]
      index++
    }
  }
}
