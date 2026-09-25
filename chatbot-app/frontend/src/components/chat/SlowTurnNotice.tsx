import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'

interface SlowTurnNoticeProps {
  active: boolean
  progress: unknown
  reasoning?: unknown
  toolProgress?: unknown
  phase: string
  sessionId?: string
  onStop?: () => void
}

/** A lack of visible progress is not proof that a remote execution failed. */
export function SlowTurnNotice({ active, progress, reasoning, toolProgress, phase, sessionId, onStop }: SlowTurnNoticeProps) {
  const [delayed, setDelayed] = useState(false)
  useEffect(() => {
    setDelayed(false)
    if (!active) return
    const timer = window.setTimeout(() => setDelayed(true), 90_000)
    return () => window.clearTimeout(timer)
  }, [active, progress, reasoning, toolProgress, phase, sessionId])

  if (!active || !delayed) return null
  const detail = phase === 'submitting'
    ? "The request is still connecting. It may not have reached the assistant yet."
    : phase === 'starting_runtime'
      ? "The request was sent, but the assistant has not started responding yet."
    : phase === 'waiting_for_model' || phase === 'reasoning'
      ? "The assistant has not produced a new response for 90 seconds."
      : "No new progress has appeared for 90 seconds."
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-3">
      <div role="status" className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">This is taking longer than usual</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail} You can keep waiting or stop this run. Check Results and Files before trying again; some work may already be saved.</p>
          {onStop && <button className="mt-3 rounded text-xs font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onStop}>Stop this run</button>}
        </div>
      </div>
    </div>
  )
}
