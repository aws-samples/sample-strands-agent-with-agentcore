import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SlowTurnNotice } from '@/components/chat/SlowTurnNotice'

afterEach(() => vi.useRealTimers())
it('offers a safe stop after no progress and clears the notice on progress or approval', () => {
  vi.useFakeTimers()
  const onStop = vi.fn()
  const props = { active: true, progress: 1, phase: 'waiting_for_model', sessionId: 'one', onStop }
  const view = render(<SlowTurnNotice {...props} />)
  act(() => vi.advanceTimersByTime(89_999))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('status')).toHaveTextContent('The assistant has not produced a new response')
  fireEvent.click(screen.getByRole('button', { name: 'Stop this run' }))
  expect(onStop).toHaveBeenCalledOnce()
  view.rerender(<SlowTurnNotice {...props} progress={2} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  view.rerender(<SlowTurnNotice {...props} active={false} phase="waiting_for_user" />)
  act(() => vi.advanceTimersByTime(180_000))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})


it.each([
  ['submitting', 'The request is still connecting'],
  ['starting_runtime', 'The request was sent'],
  ['running_tool', 'No new progress'],
])('explains the actual delayed phase: %s', (phase, text) => {
  vi.useFakeTimers()
  render(<SlowTurnNotice active progress={0} phase={phase} />)
  act(() => vi.advanceTimersByTime(90_000))
  expect(screen.getByRole('status')).toHaveTextContent(text)
})
