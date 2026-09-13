import { describe, expect, it } from 'vitest'
import { toolResultFailed } from '@/lib/tool-outcome'
describe('tool outcome', () => {
  it.each([{ status: 'error' }, { success: false }, { content: [{ text: '{"isError":true}' }] }, '**Failed to download output file**', 'Python code execution failed'])('recognizes failure %j', result => expect(toolResultFailed(result)).toBe(true))
  it.each([{ success: true }, 'No errors found.', '{"error_count":0}', 'A report about failed businesses'])('does not invent failure %j', result => expect(toolResultFailed(result)).toBe(false))
})
