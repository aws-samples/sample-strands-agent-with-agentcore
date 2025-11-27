export interface ToolExecution {
  id: string
  toolName: string
  toolInput?: any
  reasoning: string[]
  reasoningText?: string
  toolResult?: string
  images?: Array<{
    format: string
    data: string
  }>
  isComplete: boolean
  isExpanded: boolean
  streamingResponse?: string
}

export interface Message {
  id: number | string
  text: string
  sender: 'user' | 'bot'
  timestamp: string
  isStreaming?: boolean
  toolExecutions?: ToolExecution[]
  images?: Array<{
    format: string
    data: string
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
}

export interface Tool {
  id: string
  name: string
  description: string
  icon: string
  enabled: boolean
  import_path: string
  category: string
  tool_type?: "built-in" | "custom" | "mcp" | "agent"
  connection_status?: "connected" | "disconnected" | "invalid" | "unknown"
}
