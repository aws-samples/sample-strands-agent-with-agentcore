/** Preserve explicit failure outcomes, including tools returning JSON inside text. */
export function toolResultFailed(value: unknown, depth = 0): boolean {
  if (depth > 5 || value == null) return false
  if (typeof value === 'string') {
    try { return toolResultFailed(JSON.parse(value), depth + 1) } catch {
      return /^\s*(?:\*\*)?(?:Error[:*]|Failed to |Python code execution failed|Draft failed structural validation|Validation failed)/i.test(value)
    }
  }
  if (typeof value !== 'object') return false
  const result = value as any
  if (result.isError === true || result.success === false || ['error', 'failed'].includes(result.status)) return true
  if (result.result && toolResultFailed(result.result, depth + 1)) return true
  return Array.isArray(result.content) && result.content.some((block: any) => toolResultFailed(block.text, depth + 1))
}

/** Cancellation is distinct from success, even inside a successful transport envelope. */
export function toolResultCancelled(value: unknown, depth = 0): boolean {
  if (depth > 5 || value == null) return false
  if (typeof value === 'string') {
    try { return toolResultCancelled(JSON.parse(value), depth + 1) } catch {
      return /^(?:Tool execution cancelled|A2A task stopped by user|Cancelled by user)$/.test(value.trim())
    }
  }
  if (typeof value !== 'object') return false
  const result = value as any
  if (['cancelled', 'canceled', 'stopped'].includes(result.status)) return true
  if (result.result && toolResultCancelled(result.result, depth + 1)) return true
  return Array.isArray(result.content) && result.content.some((block: any) => toolResultCancelled(block.text, depth + 1))
}

/** The legacy isCancelled flag also marks failures; prefer explicit result evidence. */
export function toolExecutionOutcome(tool: { toolResult?: unknown; isCancelled?: boolean }): 'failed' | 'stopped' | 'success' {
  if (toolResultCancelled(tool.toolResult)) return 'stopped'
  if (toolResultFailed(tool.toolResult)) return 'failed'
  return tool.isCancelled ? 'stopped' : 'success'
}
