'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { Artifact } from '@/types/artifact'
import { ExcalidrawRenderer } from './ExcalidrawRenderer'

export function DiagramEditor({ artifact, sessionId, onUpdate }: {
  artifact: Artifact
  sessionId?: string
  onUpdate?: (id: string, updates: Partial<Artifact>) => void
}) {
  const [status, setStatus] = useState(artifact.metadata?.saveError ? 'error' : artifact.metadata?.pendingSave ? 'saving' : 'saved')
  const [error, setError] = useState<string | null>(artifact.metadata?.saveError || null)
  const pending = useRef<any>(null)
  const saving = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(artifact.metadata?.editVersion || null)
  useEffect(() => {
    if (!saving.current) version.current = artifact.metadata?.editVersion || null
  }, [artifact.metadata?.editVersion])
  useEffect(() => {
    if (!saving.current && !pending.current) {
      setStatus(artifact.metadata?.saveError ? 'error' : artifact.metadata?.pendingSave ? 'saving' : 'saved')
      setError(artifact.metadata?.saveError || null)
    }
  }, [artifact.metadata?.pendingSave, artifact.metadata?.saveError])
  const latest = useRef(artifact.content)
  const draftKey = `diagram-draft:${sessionId}:${artifact.id}`

  const persist = useCallback(async () => {
    if (saving.current || !pending.current || !sessionId) return
    saving.current = true
    setStatus('saving')
    while (pending.current) {
      const content = pending.current
      pending.current = null
      try {
        const response = await apiFetch('artifacts/edit', {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
          body: JSON.stringify({ id: artifact.id, baseTimestamp: artifact.timestamp, version: version.current, content }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Changes could not be saved.')
        version.current = result.version
        if (!pending.current) {
          localStorage.removeItem(draftKey)
          onUpdate?.(artifact.id, { content, metadata: { ...artifact.metadata, editVersion: result.version, manuallyEdited: true, pendingSave: false, saveError: undefined } })
          setStatus('saved')
          setError(null)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Changes could not be saved.'
        pending.current = pending.current || content
        onUpdate?.(artifact.id, { content: latest.current, metadata: { ...artifact.metadata, editVersion: version.current, manuallyEdited: true, pendingSave: false, saveError: message } })
        try { localStorage.setItem(draftKey, JSON.stringify({ content: latest.current, baseTimestamp: artifact.timestamp, version: version.current })) } catch { /* recovery storage unavailable */ }
        setError(message)
        setStatus('error')
        break
      }
    }
    saving.current = false
  }, [artifact.id, artifact.timestamp, artifact.metadata, draftKey, onUpdate, sessionId])

  const persistRef = useRef(persist)
  persistRef.current = persist
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void persistRef.current()
  }, [])

  const change = useCallback((content: any) => {
    latest.current = content
    pending.current = content
    // Retain a local recovery copy until the server acknowledges the latest scene.
    try { localStorage.setItem(draftKey, JSON.stringify({ content, baseTimestamp: artifact.timestamp, version: version.current })) } catch { /* server save still proceeds */ }
    onUpdate?.(artifact.id, { content, metadata: { ...artifact.metadata, manuallyEdited: true, pendingSave: true, editVersion: version.current } })
    setStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persistRef.current() }, 350)
  }, [artifact.id, artifact.timestamp, artifact.metadata, draftKey, onUpdate, persist])

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground" role="status">
      <span>{status === 'saving' ? 'Saving changes…' : status === 'error' ? error : 'All changes saved'}</span>
      {status === 'error' && <button className="text-primary underline" onClick={() => { pending.current = latest.current; void persist() }}>Retry save</button>}
    </div>
    <div className="min-h-0 flex-1"><ExcalidrawRenderer data={artifact.content} onChange={change} /></div>
  </div>
}
