import { useRef, useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStreamEvents } from '@/hooks/useStreamEvents'
import type { Message, ToolExecution } from '@/types/chat'

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}))

function setup(callbacks: Partial<Parameters<typeof useStreamEvents>[0]> = {}) {
  return renderHook(() => {
    const [messages, setMessages] = useState<Message[]>([])
    const [sessionState, setSessionState] = useState<any>({
      toolExecutions: [],
      interrupt: null,
      pendingOAuth: null,
    })
    const [uiState, setUIState] = useState<any>({
      agentStatus: 'thinking',
      isTyping: true,
      turnPhase: 'waiting_for_model',
      latencyMetrics: {},
    })
    const currentToolExecutionsRef = useRef<ToolExecution[]>([])
    const currentTurnIdRef = useRef<string | null>('turn-1')
    const startPollingRef = useRef<((sessionId: string) => void) | null>(null)
    const stopPollingRef = useRef<(() => void) | null>(null)

    const stream = useStreamEvents({
      sessionState,
      setSessionState,
      setMessages,
      setUIState,
      uiState,
      currentToolExecutionsRef,
      currentTurnIdRef,
      startPollingRef,
      stopPollingRef,
      sessionId: 'session-1',
      ...callbacks,
    })

    return {
      ...stream,
      messages,
      setMessages,
      sessionState,
      uiState,
      setUIState,
      currentToolExecutionsRef,
    }
  })
}

describe('useStreamEvents tool input streaming', () => {
  it.each(['code_agent', 'skill_executor'])('updates a history-restored %s tool through completion', toolName => {
    const hook = setup()
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_START', toolCallId: 'restored-1', toolCallName: toolName } as any)
    })
    // A history refresh reconstructs tools on an assistant message without the live-only flag.
    act(() => {
      hook.result.current.setMessages(messages => messages.map(({ isToolMessage, ...message }) => message))
    })
    expect(hook.result.current.messages[0].isToolMessage).toBeUndefined()
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'restored-1', delta: '{"task":"Verify file"}' } as any)
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_END', toolCallId: 'restored-1' } as any)
    })
    expect(hook.result.current.messages[0].toolExecutions?.[0].toolInput).toEqual({ task: 'Verify file' })
    if (toolName === 'code_agent') {
      act(() => {
        hook.result.current.handleStreamEvent({ type: 'CUSTOM', name: 'code_step', value: { stepNumber: 1, content: 'Verified bytes' } } as any)
        hook.result.current.handleStreamEvent({ type: 'CUSTOM', name: 'code_todo_update', value: { todos: [{ content: 'Verify file', status: 'completed' }] } } as any)
        hook.result.current.handleStreamEvent({ type: 'CUSTOM', name: 'code_result_meta', value: { files_changed: ['ready.txt'], steps: 1 } } as any)
      })
      expect(hook.result.current.messages[0].toolExecutions?.[0]).toMatchObject({
        codeSteps: [{ stepNumber: 1, content: 'Verified bytes' }],
        codeTodos: [{ content: 'Verify file', status: 'completed' }],
        codeResultMeta: { files_changed: ['ready.txt'], steps: 1 },
      })
    }
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 'restored-1', content: JSON.stringify({ status: 'success', result: 'File verified' }) } as any)
    })
    expect(hook.result.current.messages[0].toolExecutions?.[0]).toMatchObject({ isComplete: true, toolResult: expect.anything() })
    expect(hook.result.current.currentToolExecutionsRef.current[0].isComplete).toBe(true)
  })

  it('publishes an image when the tool finishes, before the model finishes replying', () => {
    const onDiagramCreated = vi.fn()
    const hook = setup({ onDiagramCreated })
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_START', toolCallId: 'chart-1', toolCallName: 'skill_executor' } as any)
    })
    act(() => {
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_RESULT', toolCallId: 'chart-1',
        content: JSON.stringify({ status: 'success', metadata: { tool_type: 'generate_chart', s3_key: 'documents/session/image/chart.png', filename: 'chart.png' } }),
      } as any)
    })
    expect(onDiagramCreated).toHaveBeenCalledExactlyOnceWith('documents/session/image/chart.png', 'chart.png')
  })

  it.each(['error', 'success'])('preserves the explicit %s outcome in the visible tool message', status => {
    const hook = setup()
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_START', toolCallId: 'preview-1', toolCallName: 'preview_excel_sheets' } as any)
    })
    act(() => {
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_RESULT', toolCallId: 'preview-1',
        content: JSON.stringify({ status, result: status === 'error' ? '**PDF file not created**' : 'Preview ready' }),
      } as any)
    })
    expect(hook.result.current.messages[0].toolExecutions?.[0]).toMatchObject({
      isComplete: true, isCancelled: status === 'error',
    })
    expect(hook.result.current.currentToolExecutionsRef.current[0].isCancelled).toBe(status === 'error')
  })

  it('renders the tool at start and fills its input as deltas arrive', () => {
    const hook = setup()

    act(() => {
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_START',
        toolCallId: 'tool-1',
        toolCallName: 'skill_executor',
      } as any)
    })

    expect(hook.result.current.messages[0].toolExecutions?.[0]).toMatchObject({
      id: 'tool-1',
      toolName: 'skill_executor',
      toolInputRaw: '',
      toolInputState: 'streaming',
    })
    expect(hook.result.current.uiState).toMatchObject({
      turnPhase: 'preparing_tool',
    })

    act(() => {
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'tool-1',
        delta: '{"query":',
      } as any)
    })

    expect(hook.result.current.messages[0].toolExecutions?.[0]).toMatchObject({
      toolInputRaw: '{"query":',
      toolInputState: 'streaming',
    })

    act(() => {
      hook.result.current.handleStreamEvent({
        type: 'CUSTOM',
        name: 'tool_call_name_update',
        value: {
          toolCallId: 'tool-1',
          toolCallName: 'tavily_search',
        },
      } as any)
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'tool-1',
        delta: '"mailbox"}',
      } as any)
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_END',
        toolCallId: 'tool-1',
      } as any)
    })

    expect(hook.result.current.messages[0].toolExecutions?.[0]).toMatchObject({
      toolName: 'tavily_search',
      toolInput: { query: 'mailbox' },
      toolInputRaw: '{"query":"mailbox"}',
      toolInputState: 'complete',
    })
    expect(hook.result.current.currentToolExecutionsRef.current[0]).toMatchObject({
      toolName: 'tavily_search',
      toolInput: { query: 'mailbox' },
      toolInputState: 'complete',
    })
    expect(hook.result.current.uiState).toMatchObject({
      turnPhase: 'running_tool',
    })

    act(() => {
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'tool-1',
        content: JSON.stringify({ result: 'done' }),
      } as any)
    })

    expect(hook.result.current.uiState).toMatchObject({
      agentStatus: 'thinking',
      turnPhase: 'processing_tool_result',
    })
  })
})

describe('useStreamEvents replay deduplication', () => {
  it('consumes each buffered text event once for the same execution', () => {
    const hook = setup()
    const executionId = 'session-1:run-1'
    const events = [
      {
        type: 'RUN_STARTED',
        threadId: 'session-1',
        runId: 'run-1',
        _eventId: 1,
        _executionId: executionId,
      },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: 'message-1',
        role: 'assistant',
        _eventId: 2,
        _executionId: executionId,
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'message-1',
        delta: 'Hello',
        _eventId: 3,
        _executionId: executionId,
      },
      {
        type: 'TEXT_MESSAGE_END',
        messageId: 'message-1',
        _eventId: 4,
        _executionId: executionId,
      },
    ]

    act(() => {
      for (const event of events) {
        hook.result.current.handleStreamEvent(event as any)
      }
      for (const replayedEvent of events) {
        hook.result.current.handleStreamEvent(replayedEvent as any)
      }
    })

    expect(hook.result.current.messages).toHaveLength(1)
    expect(hook.result.current.messages[0]).toMatchObject({
      id: 'message-1',
      text: 'Hello',
      isStreaming: false,
    })
  })
})


describe('Office result delivery', () => {
  it('publishes a saved PowerPoint before RUN_FINISHED, including skill executor results', () => {
    const onPptDocumentsCreated = vi.fn()
    const hook = setup({ onPptDocumentsCreated })
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_START', toolCallId: 'ppt-1', toolCallName: 'skill_executor' } as any)
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_RESULT', toolCallId: 'ppt-1',
        content: JSON.stringify({ status: 'success', result: 'Saved', metadata: {
          tool_type: 'powerpoint_presentation', filename: 'plan.pptx', s3_url: 's3://bucket/plan.pptx', size_kb: '12 KB',
        } }),
      } as any)
    })
    expect(onPptDocumentsCreated).toHaveBeenCalledWith([expect.objectContaining({ filename: 'plan.pptx', s3_key: 's3://bucket/plan.pptx' })])
    expect(hook.result.current.uiState.agentStatus).not.toBe('idle')
  })

  it.each(['error', 'inspection'])('does not publish a %s result as a newly saved file', (kind) => {
    const onPptDocumentsCreated = vi.fn()
    const hook = setup({ onPptDocumentsCreated })
    act(() => {
      hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_START', toolCallId: 'ppt-2', toolCallName: 'inspect_presentation' } as any)
      hook.result.current.handleStreamEvent({
        type: 'TOOL_CALL_RESULT', toolCallId: 'ppt-2',
        content: JSON.stringify({ status: kind === 'error' ? 'error' : 'success', metadata: {
          tool_type: 'powerpoint_presentation', filename: 'plan.pptx', ...(kind === 'error' ? { s3_url: 's3://bucket/plan.pptx' } : {}),
        } }),
      } as any)
    })
    expect(onPptDocumentsCreated).not.toHaveBeenCalled()
  })
})

it('does not register a viewed Office document as a generated result at turn completion', async () => {
  const onPptDocumentsCreated = vi.fn()
  const hook = setup({ onPptDocumentsCreated })
  vi.mocked(sessionStorage.getItem).mockReturnValue('session-1')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: [{ filename: 'source.pptx', s3_key: 's3://bucket/source.pptx' }] }) }))
  try {
    await act(async () => {
      await hook.result.current.handleStreamEvent({ type: 'TEXT_MESSAGE_START', messageId: 'view-answer', role: 'assistant' } as any)
      await hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_START', toolCallId: 'view-1', toolCallName: 'inspect_presentation' } as any)
      await hook.result.current.handleStreamEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 'view-1', content: JSON.stringify({ status: 'success', metadata: { filename: 'source.pptx', tool_type: 'powerpoint_presentation' } }) } as any)
      await hook.result.current.handleStreamEvent({ type: 'RUN_FINISHED', threadId: 'session-1', runId: 'view-run' } as any)
    })
    expect(onPptDocumentsCreated).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals(); vi.mocked(sessionStorage.getItem).mockReset() }
})


it('shows runtime startup only before actual model or tool progress', () => {
  const hook = setup()
  act(() => hook.result.current.setUIState((prev: any) => ({ ...prev, turnPhase: 'submitting' })))
  const event = { type: 'CUSTOM', name: 'request_progress', value: { phase: 'starting_runtime' } } as any
  act(() => hook.result.current.handleStreamEvent(event))
  expect(hook.result.current.uiState.turnPhase).toBe('starting_runtime')
  act(() => hook.result.current.setUIState((prev: any) => ({ ...prev, turnPhase: 'streaming_response' })))
  act(() => hook.result.current.handleStreamEvent(event))
  expect(hook.result.current.uiState.turnPhase).toBe('streaming_response')
})
