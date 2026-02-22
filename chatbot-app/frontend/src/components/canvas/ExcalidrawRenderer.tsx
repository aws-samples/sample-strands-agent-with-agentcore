"use client"

import React, { useEffect, useRef, useState } from 'react'

interface ExcalidrawData {
  elements: any[]
  appState?: any
  title?: string
}

interface ExcalidrawRendererProps {
  data: ExcalidrawData
}

interface ExcalidrawModule {
  Excalidraw: any
  convertToExcalidrawElements: (elements: any[]) => any[]
}

export function ExcalidrawRenderer({ data }: ExcalidrawRendererProps) {
  const [excalidrawMod, setExcalidrawMod] = useState<ExcalidrawModule | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const excalidrawAPIRef = useRef<any>(null)

  // Cache converted elements keyed by data reference.
  // convertToExcalidrawElements generates random IDs each call, so we must
  // call it exactly once per data update and reuse the result for both
  // initialData and updateScene — otherwise duplicate unbound text elements appear.
  const convertCacheRef = useRef<{ data: ExcalidrawData | null; elements: any[] }>({
    data: null,
    elements: [],
  })

  const getConverted = (mod: ExcalidrawModule, d: ExcalidrawData): any[] => {
    if (convertCacheRef.current.data !== d) {
      convertCacheRef.current = {
        data: d,
        elements: mod.convertToExcalidrawElements(d.elements || []),
      }
    }
    return convertCacheRef.current.elements
  }

  useEffect(() => {
    import('@excalidraw/excalidraw')
      .then((mod) => {
        setExcalidrawMod({
          Excalidraw: mod.Excalidraw,
          convertToExcalidrawElements: mod.convertToExcalidrawElements,
        })
      })
      .catch((err) => {
        setLoadError(`Failed to load Excalidraw: ${err.message}`)
      })
  }, [])

  // Track previous data to skip the initial mount (initialData handles first render).
  // Only call updateScene for agent-driven data changes.
  const prevDataRef = useRef<ExcalidrawData>(data)

  useEffect(() => {
    if (!excalidrawAPIRef.current || !excalidrawMod) return
    // Skip when data hasn't changed — covers the initial excalidrawMod-load fire
    if (prevDataRef.current === data) return
    prevDataRef.current = data

    const converted = getConverted(excalidrawMod, data)
    excalidrawAPIRef.current.updateScene({
      elements: converted,
      appState: {
        viewBackgroundColor: data.appState?.viewBackgroundColor ?? '#ffffff',
      },
    })

    // Apply cameraUpdate viewport if provided
    const cam = data.appState?.cameraUpdate
    if (cam?.width && cam?.height) {
      excalidrawAPIRef.current.updateScene({
        appState: {
          scrollX: -(cam.x ?? 0),
          scrollY: -(cam.y ?? 0),
          zoom: { value: 700 / cam.width },
        },
      })
    }
  }, [data, excalidrawMod])

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">
        {loadError}
      </div>
    )
  }

  if (!excalidrawMod) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading diagram...
      </div>
    )
  }

  const { Excalidraw } = excalidrawMod

  const initialData = {
    elements: getConverted(excalidrawMod, data),
    appState: {
      viewBackgroundColor: data.appState?.viewBackgroundColor ?? '#ffffff',
      currentItemFontFamily: data.appState?.currentItemFontFamily ?? 1,
      zenModeEnabled: false,
      gridSize: null,
    },
  }

  return (
    <div className="w-full h-full" style={{ minHeight: '400px' }}>
      <Excalidraw
        excalidrawAPI={(api: any) => { excalidrawAPIRef.current = api }}
        initialData={initialData}
        UIOptions={{
          canvasActions: {
            export: { saveFileToDisk: true },
            loadScene: false,
            saveAsImage: true,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  )
}
