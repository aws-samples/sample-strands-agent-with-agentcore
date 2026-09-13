'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import { normalizeDiagram } from '@/lib/diagram-scene'

interface ExcalidrawData { elements: any[]; appState?: any; files?: any; title?: string; sceneVersion?: number }
interface ExcalidrawRendererProps { data: ExcalidrawData; onChange?: (data: ExcalidrawData) => void }

export function ExcalidrawRenderer({ data, onChange }: ExcalidrawRendererProps) {
  const [mod, setMod] = useState<any>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const api = useRef<any>(null)
  const container = useRef<HTMLDivElement>(null)
  const lastSignature = useRef('')
  const applying = useRef(true)
  const latestData = useRef(data)
  latestData.current = data
  const callback = useRef(onChange)
  callback.current = onChange
  const moduleRef = useRef(mod)
  moduleRef.current = mod
  const fit = useCallback(() => api.current?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.85 }), [])
  const signature = (elements: any[], appState: any, files: any) => JSON.stringify([elements, appState?.viewBackgroundColor, files])
  // Excalidraw consumes initialData only on mount. Do not rebuild the entire
  // scene for every selection, keystroke, or save-status update.
  const initialData = useMemo(() => {
    if (!mod) return undefined
    const current = latestData.current
    return { elements: normalizeDiagram(current, mod), files: current.files, appState: { viewBackgroundColor: current.appState?.viewBackgroundColor || '#ffffff', currentItemFontFamily: 1 } }
  }, [mod])

  const refreshTextLayout = useCallback(() => {
    const instance = api.current
    const library = moduleRef.current
    if (!instance || !library || instance.getAppState().editingTextElement) return
    applying.current = true
    // Font loading invalidates Excalidraw's glyph cache, but does not resize
    // text boxes measured with fallback fonts. Re-measure after fonts arrive.
    instance.updateScene({
      elements: library.restoreElements(instance.getSceneElementsIncludingDeleted(), null, { repairBindings: true, refreshDimensions: true }),
      captureUpdate: library.CaptureUpdateAction.NEVER,
    })
    lastSignature.current = signature(instance.getSceneElementsIncludingDeleted(), instance.getAppState(), instance.getFiles())
    requestAnimationFrame(() => { fit(); applying.current = false })
  }, [fit])

  const bindApi = useCallback((instance: any) => {
    api.current = instance
    requestAnimationFrame(() => {
      lastSignature.current = signature(instance.getSceneElementsIncludingDeleted(), instance.getAppState(), instance.getFiles())
      fit(); applying.current = false
    })
  }, [fit])

  useEffect(() => { import('@excalidraw/excalidraw').then(setMod).catch(() => setLoadError('The diagram could not be loaded. Please reload to try again.')) }, [])
  useEffect(() => {
    if (!mod || !document.fonts) return
    let cancelled = false
    let frame = 0
    const refresh = () => {
      if (cancelled) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(refreshTextLayout)
    }
    document.fonts.addEventListener('loadingdone', refresh)
    void document.fonts.ready.then(refresh)
    return () => { cancelled = true; cancelAnimationFrame(frame); document.fonts.removeEventListener('loadingdone', refresh) }
  }, [mod, refreshTextLayout])
  useEffect(() => {
    if (!mod || !api.current) return
    const sig = signature(data.elements, data.appState, data.files || {})
    if (sig === lastSignature.current) return
    applying.current = true
    const elements = normalizeDiagram(data, mod)
    api.current.updateScene({ elements, appState: { viewBackgroundColor: data.appState?.viewBackgroundColor || '#ffffff' } })
    if (data.files) api.current.addFiles(Object.values(data.files))
    lastSignature.current = signature(api.current.getSceneElementsIncludingDeleted(), api.current.getAppState(), api.current.getFiles())
    requestAnimationFrame(() => { fit(); applying.current = false })
  }, [data, mod, fit])

  useEffect(() => {
    if (!container.current || !mod) return
    let timer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(fit, 120) })
    observer.observe(container.current)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [mod, fit])

  if (loadError) return <div role="alert" className="p-4 text-sm">{loadError}</div>
  if (!mod) return <div className="p-4 text-sm text-muted-foreground">Loading diagram…</div>
  const Excalidraw = mod.Excalidraw
  return <div ref={container} className="relative h-full w-full min-h-[240px]">
    <Excalidraw
      excalidrawAPI={bindApi}
      initialData={initialData}
      onChange={(elements: any[], appState: any, files: any) => {
        if (applying.current) return
        const sig = signature(elements, appState, files)
        if (sig === lastSignature.current) return
        lastSignature.current = sig
        callback.current?.({ ...latestData.current, sceneVersion: 1, elements, files, appState: { viewBackgroundColor: appState.viewBackgroundColor } })
      }}
      UIOptions={{ canvasActions: { export: { saveFileToDisk: true }, loadScene: false, saveAsImage: true, saveToActiveFile: false } }}
    />
    <button onClick={fit} className="absolute bottom-16 right-3 rounded-md border bg-background px-3 py-1.5 text-xs text-foreground shadow-sm" aria-label="Fit diagram to view">Fit</button>
  </div>
}
