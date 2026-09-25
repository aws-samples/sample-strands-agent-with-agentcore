'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

export function GeneratedFilePreview({ source, filename, s3Key, revision, sessionId }: {
  source: string; filename: string; s3Key?: string; revision?: string; sessionId?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false)
    const load = async () => {
      try {
        let next = source
        if (s3Key || source.startsWith('s3://')) {
          const fullSource = source.startsWith('s3://') ? source : s3Key?.startsWith('s3://') ? s3Key : null
          if (!fullSource && !sessionId) throw new Error('Session unavailable')
          const response = await apiFetch(fullSource ? 's3/presigned-url' : 'workspace/download', {
            method: 'POST', body: JSON.stringify(fullSource
              ? { s3Key: fullSource, filename }
              : { path: `documents/image/${filename}`, sessionId }),
          })
          if (!response.ok) throw new Error('Preview unavailable')
          next = (await response.json()).url
        }
        if (!next) throw new Error('Preview unavailable')
        if (active) setUrl(next)
      } catch { if (active) setFailed(true) }
    }
    void load()
    return () => { active = false }
  }, [source, filename, s3Key, revision, sessionId, attempt])
  if (failed) return <div role="alert" className="p-4 text-center text-sm text-muted-foreground">
    <p>The preview could not be loaded.</p>
    <button onClick={() => setAttempt(n => n + 1)} className="mt-2 text-primary">Retry</button>
  </div>
  if (!url) return <p className="p-4 text-center text-sm text-muted-foreground">Loading preview…</p>
  return <div className="space-y-3">
    <div className="text-right"><a href={url} download={filename} target="_blank" rel="noopener" className="text-xs text-primary">Download</a></div>
    {filename.toLowerCase().endsWith('.pdf')
      ? <iframe src={url} title={filename} className="h-[70vh] w-full border-0" />
      : <img src={url} alt={filename} onError={() => setFailed(true)} className="mx-auto max-w-full h-auto rounded-lg" />}
  </div>
}
