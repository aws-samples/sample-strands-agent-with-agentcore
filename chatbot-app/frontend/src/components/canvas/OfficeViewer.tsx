"use client"

import React, { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Download, Loader2, AlertCircle } from 'lucide-react'

interface OfficeViewerProps {
  s3Url?: string  // s3://bucket/path/file.docx
  previewUrl?: string
  filename: string
  revision?: string
}

/**
 * Office document viewer using Microsoft Office Online.
 */
export function OfficeViewer({ s3Url, previewUrl, filename, revision }: OfficeViewerProps) {
  const [retry, setRetry] = useState(0)
  const hasFileLink = !!previewUrl || !!s3Url?.startsWith('s3://')
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const download = async () => {
    try {
      setDownloadError(null)
      let url = previewUrl
      if (s3Url) {
        const response = await apiFetch('s3/presigned-url', { method: 'POST', body: JSON.stringify({ s3Key: s3Url, filename }) })
        if (!response.ok) throw new Error('Download unavailable. Please try again.')
        url = (await response.json()).url
      }
      if (!url) throw new Error('Download unavailable. Please try again.')
      const link = document.createElement('a'); link.href = url; link.download = filename; link.target = '_blank'; link.rel = 'noopener'; link.click()
    } catch (e) { setDownloadError(e instanceof Error ? e.message : 'Download failed.') }
  }


  useEffect(() => {
    let active = true
    const loadDocument = async () => {
      setLoading(true)
      setError(null)
      setViewerUrl(null)
      setDownloadError(null)

      try {
        if (previewUrl) {
          const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`
          setViewerUrl(officeViewerUrl)
          return
        }

        if (!s3Url?.startsWith('s3://')) {
          throw new Error(`Invalid S3 URL format: ${s3Url}`)
        }

        const ext = s3Url.split('.').pop()?.toLowerCase()
        let docUrl: string

        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

        if (ext === 'xlsx' || isLocal) {
          // Excel or local dev: presigned URL (Office Online can't reach localhost)
          const response = await apiFetch('s3/presigned-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ s3Key: s3Url })
          })
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to generate presigned URL')
          }
          const { url } = await response.json()
          docUrl = url
        } else {
          // Word/PPT in production: proxy avoids X-Amz-* param issues
          docUrl = `${window.location.origin}/api/s3/proxy?key=${encodeURIComponent(s3Url)}&v=${encodeURIComponent(revision || "current")}`
        }

        // Build Office Online viewer URL
        const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(docUrl)}`
        if (active) setViewerUrl(officeViewerUrl)
      } catch (err) {
        console.error('[OfficeViewer] Error:', err)
        if (active) setError(err instanceof Error ? err.message : 'Failed to load document')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadDocument()
    return () => { active = false }
  }, [previewUrl, s3Url, revision, retry])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-3 border-b px-3 py-2 text-xs">
        {downloadError && <span role="alert" className="text-destructive">{downloadError}</span>}
        <button disabled={!hasFileLink} className="flex items-center gap-1.5 text-primary disabled:opacity-50" onClick={download}><Download className="h-4 w-4" />Download</button>
      </div>
      {loading ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading preview…</div>
        : error ? <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><AlertCircle className="h-6 w-6" /><p>{hasFileLink ? 'The preview is unavailable. Try downloading the file, or retry the preview.' : 'The file link is unavailable. Reopen this result from the conversation.'}</p>{hasFileLink && <button className="mt-2 text-primary underline underline-offset-4" onClick={() => setRetry(value => value + 1)}>Retry preview</button>}</div>
        : viewerUrl && <iframe src={viewerUrl} className="min-h-0 w-full flex-1 border-0" title={`Preview: ${filename}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" />}
    </div>
  )
}

/**
 * Check if content is an Office file S3 URL
 */
export function isOfficeFileUrl(content: string): boolean {
  if (!content || typeof content !== 'string') return false
  return content.startsWith('s3://') && /\.(docx|xlsx|pptx)$/i.test(content)
}

/**
 * Check if content is specifically a Word document S3 URL
 */
export function isWordFileUrl(content: string): boolean {
  if (!content || typeof content !== 'string') return false
  return content.startsWith('s3://') && /\.docx$/i.test(content)
}

/**
 * Extract filename from S3 URL
 */
export function getFilenameFromS3Url(s3Url: string): string {
  if (!s3Url) return 'document'
  const parts = s3Url.split('/')
  return parts[parts.length - 1] || 'document'
}
