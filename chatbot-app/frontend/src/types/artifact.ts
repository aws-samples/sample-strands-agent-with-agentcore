/**
 * Artifact types for the Artifact Studio
 */

export type ArtifactType =
  | 'markdown'        // Markdown content (research, general text)
  | 'research'        // Research Agent results
  | 'browser'         // Browser automation results
  | 'document'        // Word/Excel/PowerPoint (compose workflow)
  | 'word_document'   // Word documents from Word tools
  | 'image'           // Images and charts
  | 'code'            // Code snippets
  | 'compose'         // Interactive composer workflow

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  content: string | any
  description?: string
  toolName?: string
  timestamp: string
  sessionId?: string
  metadata?: {
    filename?: string
    s3_key?: string
    size_kb?: string
    user_id?: string
    session_id?: string
    [key: string]: any
  }
}

export interface CanvasState {
  isOpen: boolean
  artifacts: Artifact[]
  selectedArtifactId: string | null
}
