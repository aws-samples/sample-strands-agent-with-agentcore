export const API_BASE_URL = (
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? 'http://localhost:3000'
).replace(/\/$/, '')

export const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-6'
export const DEFAULT_TEMPERATURE = 0.7
export const TEXT_BUFFER_FLUSH_MS = 50

export const ENDPOINTS = {
  chat: '/api/stream/chat',
  stop: '/api/stream/stop',
  elicitationComplete: '/api/stream/elicitation-complete',
  sessionNew: '/api/session/new',
  sessionList: '/api/session/list',
  sessionDelete: '/api/session/delete',
  sessionById: (id: string) => `/api/session/${encodeURIComponent(id)}`,
  conversationHistory: (id: string) => `/api/conversation/history?session_id=${encodeURIComponent(id)}`,
  streamResume: (executionId: string) => `/api/stream/resume?executionId=${encodeURIComponent(executionId)}&cursor=0`,
  health: '/api/health',
  workspaceFiles: (docType: string) => `/api/workspace/files?docType=${encodeURIComponent(docType)}`,
  s3PresignedUrl: '/api/s3/presigned-url',
  codeAgentDownload: (sessionId: string) =>
    `/api/code-agent/workspace-download?sessionId=${encodeURIComponent(sessionId)}`,
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  description: string
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: 'us.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6', provider: 'Anthropic', description: 'Most intelligent model' },
  { id: 'us.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Anthropic', description: 'Balanced performance' },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Claude Haiku 4.5', provider: 'Anthropic', description: 'Fast and efficient' },
  { id: 'us.amazon.nova-2-pro-preview-20251202-v1:0', name: 'Nova 2 Pro', provider: 'Amazon', description: 'High-performance multimodal' },
  { id: 'us.amazon.nova-2-lite-v1:0', name: 'Nova 2 Lite', provider: 'Amazon', description: 'Lightweight and efficient' },
  { id: 'deepseek.v3.2', name: 'DeepSeek V3.2', provider: 'DeepSeek', description: 'Strong reasoning capabilities' },
  { id: 'qwen.qwen3-235b-a22b-2507-v1:0', name: 'Qwen 235B', provider: 'Qwen', description: 'Large-scale language model' },
  { id: 'qwen.qwen3-32b-v1:0', name: 'Qwen 32B', provider: 'Qwen', description: 'Efficient language model' },
  { id: 'google.gemma-3-27b-it', name: 'Gemma 3 27B', provider: 'Google', description: 'Text and image model' },
  { id: 'moonshot.kimi-k2-thinking', name: 'Kimi K2 Thinking', provider: 'Moonshot AI', description: 'Deep reasoning model' },
]

export const MODEL_STORAGE_KEY = 'selected_model_id'
