/**
 * useCanvasHandlers - Canvas-related handlers for document artifacts
 *
 * This hook centralizes all Canvas-related callbacks and handlers,
 * making it easier to add new document types (Word, Excel, PowerPoint, etc.)
 *
 * Note: Uses refs to avoid circular dependency with useChat/useArtifacts
 */

import { useCallback, useRef, useEffect } from 'react'
import { ArtifactType, Artifact } from '@/types/artifact'

// Document info from workspace API
export interface WorkspaceDocument {
  filename: string
  size_kb: string
  last_modified: string
  s3_key: string
  tool_type: string
}

interface ArtifactMethods {
  artifacts: Artifact[]
  refreshArtifacts: () => void
  addArtifact: (artifact: Artifact) => void
  updateArtifact: (artifactId: string, updates: Partial<Artifact>) => void
  openArtifact: (id: string) => void
}

// Excalidraw diagram data from create_excalidraw_diagram
export interface ExcalidrawDiagramData {
  elements: any[]
  appState: any
  title: string
}

// Extracted data info from browser_extract
export interface ExtractedDataInfo {
  artifactId: string
  title: string
  content: string  // JSON string
  sourceUrl: string
  sourceTitle: string
}

interface UseCanvasHandlersReturn {
  // Callbacks for useChat (can be used before useArtifacts is initialized)
  handleArtifactUpdated: () => void
  handleWordDocumentsCreated: (documents: WorkspaceDocument[]) => void
  handleExcelDocumentsCreated: (documents: WorkspaceDocument[]) => void
  handlePptDocumentsCreated: (documents: WorkspaceDocument[]) => void
  handleDiagramCreated: (s3Key: string, filename: string) => void
  handleExtractedDataCreated: (data: ExtractedDataInfo) => void
  handleExcalidrawCreated: (data: ExcalidrawDiagramData, toolUseId: string) => void

  // Handlers for opening artifacts from chat
  handleOpenResearchArtifact: (executionId: string) => void
  handleOpenWordArtifact: (filename: string) => void
  handleOpenExcelArtifact: (filename: string) => void
  handleOpenPptArtifact: (filename: string) => void
  handleOpenDiagramArtifact: (filename: string) => void
  handleOpenExtractedDataArtifact: (artifactId: string) => void
  handleOpenExcalidrawArtifact: (artifactId: string) => void

  // Connect artifact methods after useArtifacts is initialized
  setArtifactMethods: (methods: ArtifactMethods) => void
}

export const useCanvasHandlers = (): UseCanvasHandlersReturn => {
  // Refs for artifact methods (to avoid circular dependency with useChat)
  const artifactsRef = useRef<Artifact[]>([])
  const refreshArtifactsRef = useRef<(() => void) | null>(null)
  const addArtifactRef = useRef<((artifact: any) => void) | null>(null)
  const updateArtifactRef = useRef<((artifactId: string, updates: Partial<Artifact>) => void) | null>(null)
  const openArtifactRef = useRef<((id: string) => void) | null>(null)

  // Function to connect artifact methods after useArtifacts is initialized
  const setArtifactMethods = useCallback((methods: ArtifactMethods) => {
    artifactsRef.current = methods.artifacts
    refreshArtifactsRef.current = methods.refreshArtifacts
    addArtifactRef.current = methods.addArtifact
    updateArtifactRef.current = methods.updateArtifact
    openArtifactRef.current = methods.openArtifact
  }, [])

  // ==================== CALLBACKS FOR useChat ====================

  // Callback when artifact is updated via update_artifact tool
  const handleArtifactUpdated = useCallback(() => {
    if (refreshArtifactsRef.current) {
      refreshArtifactsRef.current()
    }
  }, [])

  // Callback for Word document creation - creates artifacts and opens Canvas
  const handleWordDocumentsCreated = useCallback((documents: WorkspaceDocument[]) => {
    if (!addArtifactRef.current || !openArtifactRef.current || documents.length === 0) return

    // Generate artifact IDs first (for consistency)
    const timestamp = Date.now()
    const artifactIds = documents.map((doc, index) => `word-${doc.filename}-${timestamp}-${index}`)

    // Create artifacts for each Word document
    documents.forEach((doc, index) => {
      addArtifactRef.current!({
        id: artifactIds[index],
        type: 'word_document' as ArtifactType,
        title: doc.filename,
        content: doc.s3_key,  // S3 URL for OfficeViewer
        description: doc.size_kb,
        timestamp: doc.last_modified || new Date().toISOString(),
      })
    })

    // Open Canvas and select the most recent document
    setTimeout(() => {
      openArtifactRef.current!(artifactIds[0])
    }, 100)
  }, [])

  // Callback for Excel document creation - creates artifacts and opens Canvas
  const handleExcelDocumentsCreated = useCallback((documents: WorkspaceDocument[]) => {
    if (!addArtifactRef.current || !openArtifactRef.current || documents.length === 0) return

    // Generate artifact IDs first (for consistency)
    const timestamp = Date.now()
    const artifactIds = documents.map((doc, index) => `excel-${doc.filename}-${timestamp}-${index}`)

    // Create artifacts for each Excel document
    documents.forEach((doc, index) => {
      addArtifactRef.current!({
        id: artifactIds[index],
        type: 'excel_spreadsheet' as ArtifactType,
        title: doc.filename,
        content: doc.s3_key,  // S3 URL for OfficeViewer
        description: doc.size_kb,
        timestamp: doc.last_modified || new Date().toISOString(),
      })
    })

    // Open Canvas and select the most recent document
    setTimeout(() => {
      openArtifactRef.current!(artifactIds[0])
    }, 100)
  }, [])

  // Callback for PowerPoint document creation - creates artifacts and opens Canvas
  const handlePptDocumentsCreated = useCallback((documents: WorkspaceDocument[]) => {
    if (!addArtifactRef.current || !openArtifactRef.current || documents.length === 0) return

    // Generate artifact IDs first (for consistency)
    const timestamp = Date.now()
    const artifactIds = documents.map((doc, index) => `ppt-${doc.filename}-${timestamp}-${index}`)

    // Create artifacts for each PowerPoint document
    documents.forEach((doc, index) => {
      addArtifactRef.current!({
        id: artifactIds[index],
        type: 'powerpoint_presentation' as ArtifactType,
        title: doc.filename,
        content: doc.s3_key,  // S3 URL for OfficeViewer
        description: doc.size_kb,
        timestamp: doc.last_modified || new Date().toISOString(),
      })
    })

    // Open Canvas and select the most recent document
    setTimeout(() => {
      openArtifactRef.current!(artifactIds[0])
    }, 100)
  }, [])

  // Callback for diagram creation - fetches presigned URL and opens in Canvas
  const handleDiagramCreated = useCallback(async (s3Key: string, filename: string) => {
    if (!addArtifactRef.current || !openArtifactRef.current) return

    try {
      // Get presigned URL for the S3 image
      const response = await fetch('/api/s3/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key }),
      })

      if (!response.ok) return
      const { url } = await response.json()

      const artifactId = `diagram-${filename}-${Date.now()}`
      addArtifactRef.current({
        id: artifactId,
        type: 'image' as ArtifactType,
        title: filename,
        content: url,
        description: 'Diagram',
        timestamp: new Date().toISOString(),
        metadata: { filename, s3_key: s3Key },
      })

      setTimeout(() => {
        openArtifactRef.current!(artifactId)
      }, 100)
    } catch (error) {
      // Failed to create diagram artifact - non-critical
    }
  }, [])

  // Callback for extracted data creation - creates artifact and opens Canvas
  const handleExtractedDataCreated = useCallback((data: ExtractedDataInfo) => {
    if (!addArtifactRef.current || !openArtifactRef.current) return

    // Create artifact for extracted data
    addArtifactRef.current({
      id: data.artifactId,
      type: 'extracted_data' as ArtifactType,
      title: data.title,
      content: data.content,
      description: `Extracted from ${data.sourceTitle}`,
      timestamp: new Date().toISOString(),
      metadata: {
        source_url: data.sourceUrl,
        source_title: data.sourceTitle,
      },
    })

    // Open Canvas and select the artifact
    setTimeout(() => {
      openArtifactRef.current!(data.artifactId)
    }, 100)
  }, [])

  // ==================== HANDLERS FOR OPENING ARTIFACTS ====================

  // Handle "View in Canvas" from chat - open Canvas with the research artifact
  const handleOpenResearchArtifact = useCallback((executionId: string) => {
    // Artifact ID matches backend: research-{toolUseId} where toolUseId = executionId
    const artifactId = `research-${executionId}`
    // Open artifact directly - Canvas will find it from current state
    if (openArtifactRef.current) {
      openArtifactRef.current(artifactId)
    }
  }, [])

  // Handle "View in Canvas" from Word tool - find artifact by filename (case-insensitive, with retry)
  const handleOpenWordArtifact = useCallback((filename: string) => {
    const find = () => artifactsRef.current.find(a =>
      a.type === 'word_document' && a.title.toLowerCase() === filename.toLowerCase()
    )
    const artifact = find()
    if (artifact && openArtifactRef.current) {
      openArtifactRef.current(artifact.id)
    } else {
      // Retry once after a short delay to handle async artifact creation
      setTimeout(() => {
        const retried = find()
        if (retried && openArtifactRef.current) openArtifactRef.current(retried.id)
      }, 500)
    }
  }, [])

  // Handle "View in Canvas" from Excel tool - find artifact by filename (case-insensitive, with retry)
  const handleOpenExcelArtifact = useCallback((filename: string) => {
    const find = () => artifactsRef.current.find(a =>
      a.type === 'excel_spreadsheet' && a.title.toLowerCase() === filename.toLowerCase()
    )
    const artifact = find()
    if (artifact && openArtifactRef.current) {
      openArtifactRef.current(artifact.id)
    } else {
      setTimeout(() => {
        const retried = find()
        if (retried && openArtifactRef.current) openArtifactRef.current(retried.id)
      }, 500)
    }
  }, [])

  // Handle "View in Canvas" from PowerPoint tool - find artifact by filename (case-insensitive, with retry)
  const handleOpenPptArtifact = useCallback((filename: string) => {
    const find = () => artifactsRef.current.find(a =>
      a.type === 'powerpoint_presentation' && a.title.toLowerCase() === filename.toLowerCase()
    )
    const artifact = find()
    if (artifact && openArtifactRef.current) {
      openArtifactRef.current(artifact.id)
    } else {
      setTimeout(() => {
        const retried = find()
        if (retried && openArtifactRef.current) openArtifactRef.current(retried.id)
      }, 500)
    }
  }, [])

  // Handle "View in Canvas" from diagram tool - find artifact by filename
  const handleOpenDiagramArtifact = useCallback((filename: string) => {
    const artifact = artifactsRef.current.find(a =>
      a.type === 'image' && a.title === filename
    )
    if (artifact && openArtifactRef.current) {
      openArtifactRef.current(artifact.id)
    }
  }, [])

  // Handle "View in Canvas" from browser_extract - open artifact by ID
  const handleOpenExtractedDataArtifact = useCallback((artifactId: string) => {
    if (openArtifactRef.current) {
      openArtifactRef.current(artifactId)
    }
  }, [])

  // Callback for Excalidraw diagram creation - updates existing artifact or creates new
  const handleExcalidrawCreated = useCallback((data: ExcalidrawDiagramData, toolUseId: string) => {
    if (!openArtifactRef.current) return

    // If an excalidraw artifact already exists, update it in place (single canvas model)
    const existing = artifactsRef.current.find(a => a.type === 'excalidraw')
    if (existing && updateArtifactRef.current) {
      updateArtifactRef.current(existing.id, {
        content: data,
        title: data.title || existing.title,
        timestamp: new Date().toISOString(),
      })
      setTimeout(() => {
        openArtifactRef.current!(existing.id)
      }, 100)
      return
    }

    // No existing excalidraw artifact — create new
    if (!addArtifactRef.current) return
    const artifactId = `excalidraw-${toolUseId}`
    addArtifactRef.current({
      id: artifactId,
      type: 'excalidraw' as ArtifactType,
      title: data.title || 'Diagram',
      content: data,
      timestamp: new Date().toISOString(),
    })
    setTimeout(() => {
      openArtifactRef.current!(artifactId)
    }, 100)
  }, [])

  // Handle "View in Canvas" from excalidraw tool - open artifact by ID
  const handleOpenExcalidrawArtifact = useCallback((artifactId: string) => {
    if (openArtifactRef.current) {
      openArtifactRef.current(artifactId)
    }
  }, [])

  return {
    // Callbacks for useChat
    handleArtifactUpdated,
    handleWordDocumentsCreated,
    handleExcelDocumentsCreated,
    handlePptDocumentsCreated,
    handleDiagramCreated,
    handleExtractedDataCreated,
    handleExcalidrawCreated,

    // Handlers for opening artifacts
    handleOpenResearchArtifact,
    handleOpenWordArtifact,
    handleOpenExcelArtifact,
    handleOpenPptArtifact,
    handleOpenDiagramArtifact,
    handleOpenExtractedDataArtifact,
    handleOpenExcalidrawArtifact,

    // Connect artifact methods
    setArtifactMethods,
  }
}
