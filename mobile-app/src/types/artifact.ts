export type ArtifactType =
  | 'markdown'
  | 'code'
  | 'research'
  | 'compose'
  | 'image'
  | 'word_document'
  | 'excel_spreadsheet'
  | 'powerpoint_presentation'
  | 'excalidraw'
  | 'extracted_data'

export interface ExcalidrawElement {
  [key: string]: unknown
}

export interface ExcalidrawData {
  title?: string
  elements?: ExcalidrawElement[]
  appState?: Record<string, unknown>
  [key: string]: unknown
}

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  /** string for all types except excalidraw */
  content: string | ExcalidrawData
  description?: string
  timestamp: string
  sessionId: string
  metadata?: {
    filename?: string
    s3_key?: string
    source_url?: string
    [k: string]: unknown
  }
}

// ─── Artifact signals emitted by useStreamEvents ─────────────────────────────

export interface CompletedToolSnapshot {
  toolCallId: string
  toolName: string
  toolInputParsed: unknown
  toolResult: string
  metadata: Record<string, unknown>
}

export type ArtifactSignal =
  | { kind: 'excalidraw'; data: ExcalidrawData; toolCallId: string }
  | {
      kind: 'browser_extract'
      artifactId: string
      toolOutput: string
      metadata: Record<string, unknown>
    }
  | { kind: 'run_finished'; completedTools: CompletedToolSnapshot[] }
