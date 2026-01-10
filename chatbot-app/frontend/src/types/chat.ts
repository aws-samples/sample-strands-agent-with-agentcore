export interface ToolExecution {
  id: string
  toolName: string
  toolInput?: any
  reasoning: string[]
  reasoningText?: string
  toolResult?: string
  images?: Array<
    | { format: string; data: string }
    | { type: 'url'; url: string; thumbnail?: string }
  >
  isComplete: boolean
  isCancelled?: boolean
  isExpanded: boolean
  streamingResponse?: string
}

export interface Message {
  id: string
  text: string
  sender: 'user' | 'bot'
  timestamp: string
  isStreaming?: boolean
  toolExecutions?: ToolExecution[]
  images?: Array<
    | { format: string; data: string }
    | { type: 'url'; url: string; thumbnail?: string }
  >
  documents?: Array<{
    filename: string
    tool_type: string  // 'word_document', 'powerpoint', etc.
  }>
  isToolMessage?: boolean // Mark messages that are purely for tool execution display
  turnId?: string // Turn ID for grouping messages by conversation turn
  toolUseId?: string // Tool use ID for session-based image paths
  uploadedFiles?: Array<{
    name: string
    type: string
    size: number
  }>
  latencyMetrics?: {
    timeToFirstToken?: number  // ms from request to first response
    endToEndLatency?: number   // ms from request to completion
  }
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadInputTokens?: number
    cacheWriteInputTokens?: number
  }
  feedback?: 'up' | 'down' | null
  // Autopilot message markers (from Mission Control)
  isDirective?: boolean
  directiveStep?: number
  // Autopilot type: 'directive' (step N), 'summary', or 'direct' (no tools needed)
  autopilotType?: 'directive' | 'summary' | 'direct'
}

export interface Tool {
  id: string
  name: string
  description: string
  icon: string
  enabled: boolean
  import_path: string
  category: string
  tool_type?: "local" | "builtin" | "gateway" | "runtime-a2a"
  connection_status?: "connected" | "disconnected" | "invalid" | "unknown"
}
