/**
 * Artifact types for the Artifact Studio
 */

export type ArtifactType =
  | 'markdown'           // Markdown content (research, general text)
  | 'research'           // Research Agent results
  | 'browser'            // Browser automation results
  | 'extracted_data'     // Extracted data from browser (JSON)
  | 'document'           // Word/Excel/PowerPoint (compose workflow)
  | 'word_document'      // Word documents from Word tools
  | 'excel_spreadsheet'  // Excel spreadsheets from Excel tools
  | 'powerpoint_presentation' // PowerPoint presentations from PPT tools
  | 'image'              // Images and charts
  | 'code'               // Code snippets
  | 'compose'            // Interactive composer workflow
  | 'excalidraw'         // Excalidraw hand-drawn diagrams

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
    browserSessionId?: string  // For browser artifacts
    browserId?: string         // For browser artifacts
    [key: string]: any
  }
}

export interface CanvasState {
  isOpen: boolean
  artifacts: Artifact[]
  selectedArtifactId: string | null
}
