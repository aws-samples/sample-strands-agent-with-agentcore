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
  openArtifact: (id: string) => void
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
  handleExtractedDataCreated: (data: ExtractedDataInfo) => void

  // Handlers for opening artifacts from chat
  handleOpenResearchArtifact: (executionId: string) => void
  handleOpenWordArtifact: (filename: string) => void
  handleOpenExcelArtifact: (filename: string) => void
  handleOpenPptArtifact: (filename: string) => void
  handleOpenExtractedDataArtifact: (artifactId: string) => void

  // Connect artifact methods after useArtifacts is initialized
  setArtifactMethods: (methods: ArtifactMethods) => void
}

export const useCanvasHandlers = (): UseCanvasHandlersReturn => {
  // Refs for artifact methods (to avoid circular dependency with useChat)
  const artifactsRef = useRef<Artifact[]>([])
  const refreshArtifactsRef = useRef<(() => void) | null>(null)
  const addArtifactRef = useRef<((artifact: any) => void) | null>(null)
  const openArtifactRef = useRef<((id: string) => void) | null>(null)

  // Function to connect artifact methods after useArtifacts is initialized
  const setArtifactMethods = useCallback((methods: ArtifactMethods) => {
    artifactsRef.current = methods.artifacts
    refreshArtifactsRef.current = methods.refreshArtifacts
    addArtifactRef.current = methods.addArtifact
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

  // Handle "View in Canvas" from Word tool - find artifact by filename
  const handleOpenWordArtifact = useCallback((filename: string) => {
    // Find artifact with matching filename in title (type is 'word_document')
    const artifact = artifactsRef.current.find(a =>
      a.type === 'word_document' && a.title === filename
    )
    if (artifact && openArtifactRef.current) {
      openArtifactRef.current(artifact.id)
    }
  }, [])

  // Handle "View in Canvas" from Excel tool - find artifact by filename
  const handleOpenExcelArtifact = useCallback((filename: string) => {
    // Find artifact with matching filename in title (type is 'excel_spreadsheet')
    const artifact = artifactsRef.current.find(a =>
      a.type === 'excel_spreadsheet' && a.title === filename
    )
    if (artifact && openArtifactRef.current) {
      openArtifactRef.current(artifact.id)
    }
  }, [])

  // Handle "View in Canvas" from PowerPoint tool - find artifact by filename
  const handleOpenPptArtifact = useCallback((filename: string) => {
    // Find artifact with matching filename in title (type is 'powerpoint_presentation')
    const artifact = artifactsRef.current.find(a =>
      a.type === 'powerpoint_presentation' && a.title === filename
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

  return {
    // Callbacks for useChat
    handleArtifactUpdated,
    handleWordDocumentsCreated,
    handleExcelDocumentsCreated,
    handlePptDocumentsCreated,
    handleExtractedDataCreated,

    // Handlers for opening artifacts
    handleOpenResearchArtifact,
    handleOpenWordArtifact,
    handleOpenExcelArtifact,
    handleOpenPptArtifact,
    handleOpenExtractedDataArtifact,

    // Connect artifact methods
    setArtifactMethods,
  }
}
