"use client"

import React, { useState, useEffect } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

interface OfficeViewerProps {
  s3Url: string  // s3://bucket/path/file.docx
  filename: string
}

/**
 * Office document viewer using Microsoft Office Online
 * Embeds documents via Office Online viewer iframe
 */
export function OfficeViewer({ s3Url, filename }: OfficeViewerProps) {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadDocument = async () => {
      setLoading(true)
      setError(null)

      try {
        console.log('[OfficeViewer] Loading document:', s3Url)

        // Validate S3 URL format
        if (!s3Url || !s3Url.startsWith('s3://')) {
          throw new Error(`Invalid S3 URL format: ${s3Url}`)
        }

        // Check if running locally
        const isLocal = typeof window !== 'undefined' &&
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

        let documentUrl: string

        if (isLocal) {
          // Local: Use presigned URL directly (S3 URL is publicly accessible)
          const response = await fetch('/api/s3/presigned-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ s3Key: s3Url })
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to generate presigned URL')
          }

          const { url } = await response.json()
          documentUrl = url
        } else {
          // Cloud: Use proxy URL (our app URL is publicly accessible)
          const proxyPath = `/api/s3/proxy?key=${encodeURIComponent(s3Url)}`
          documentUrl = `${window.location.origin}${proxyPath}`
        }

        // Build Office Online viewer URL
        const encodedUrl = encodeURIComponent(documentUrl)
        const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`
        setViewerUrl(officeViewerUrl)

        console.log('[OfficeViewer] Viewer URL ready, isLocal:', isLocal)
      } catch (err) {
        console.error('[OfficeViewer] Error:', err)
        setError(err instanceof Error ? err.message : 'Failed to load document')
      } finally {
        setLoading(false)
      }
    }

    if (s3Url) {
      loadDocument()
    }
  }, [s3Url])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-sidebar-foreground/60">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-label">Loading document...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-sidebar-foreground/60">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-label">{error}</p>
      </div>
    )
  }

  return (
    <div className="h-full">
      {viewerUrl && (
        <iframe
          src={viewerUrl}
          className="w-full h-full border-0"
          title={`Preview: ${filename}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
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
