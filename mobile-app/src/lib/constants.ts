export const API_BASE_URL = (
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? 'http://localhost:3000'
).replace(/\/$/, '')

export const DEFAULT_MODEL_ID = 'global.anthropic.claude-sonnet-5-5'
export const DEFAULT_TEMPERATURE = 0.7
export const TEXT_BUFFER_FLUSH_MS = 120

export const ENDPOINTS = {
  chat: '/api/stream/chat',
  stop: '/api/stream/stop',
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
  { id: 'anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'Anthropic', description: 'Most intelligent model' },
  { id: 'global.anthropic.claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', description: 'Balanced performance' },
  { id: 'openai.gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'OpenAI', description: 'Flagship frontier model' },
  { id: 'openai.gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI', description: 'Fast and cost-efficient model' },
  { id: 'us.xai.grok-4.7', name: 'Grok 4.7', provider: 'xAI', description: 'Advanced reasoning model' },
  { id: 'google.gemma-4-31b', name: 'Gemma 4 31B', provider: 'Google', description: 'Latest multimodal model' },
  { id: 'deepseek.v3.2', name: 'DeepSeek V3.2', provider: 'DeepSeek', description: 'Strong reasoning capabilities' },
  { id: 'zai.glm-5', name: 'GLM-5', provider: 'Z.AI', description: 'Flagship reasoning model' },
  { id: 'us.moonshotai.kimi-k3', name: 'Kimi K3', provider: 'Moonshot AI', description: 'Deep reasoning model' },
]

export const MODEL_STORAGE_KEY = 'selected_model_id'

const MODEL_ID_ALIASES: Record<string, string> = {
  'us.xai.grok-4.6': 'us.xai.grok-4.7',
  'xai.grok-4.7': 'us.xai.grok-4.7',
  'moonshotai.kimi-k2.5': 'us.moonshotai.kimi-k3',
  'moonshotai.kimi-k3': 'us.moonshotai.kimi-k3',
  'zai.glm-4.7': 'zai.glm-5',
  'us.anthropic.claude-sonnet-5': 'global.anthropic.claude-sonnet-5-5',
  'anthropic.claude-sonnet-5': 'global.anthropic.claude-sonnet-5-5',
  'openai.gpt-6-sol': 'openai.gpt-6.1-sol',
  'us.openai.gpt-6.1-sol': 'openai.gpt-6.1-sol',

  'anthropic.claude-opus-5': 'anthropic.claude-opus-5-5',
  'us.anthropic.claude-opus-5': 'anthropic.claude-opus-5-5',
  'openai.gpt-5.6-sol': 'openai.gpt-6.1-sol',
  'us.openai.gpt-5.6-sol': 'openai.gpt-6.1-sol',
  'openai.gpt-5.6-terra': 'openai.gpt-6.1-sol',
  'us.openai.gpt-5.6-terra': 'openai.gpt-6.1-sol',
  'openai.gpt-5.6-luna': 'openai.gpt-6-luna',
  'us.openai.gpt-5.6-luna': 'openai.gpt-6-luna',
  'openai.gpt-6-astra': 'us.openai.gpt-6-astra',
  'xai.grok-4.3': 'us.xai.grok-4.7',
  'xai.grok-4.6': 'us.xai.grok-4.7',
  'us.openai.gpt-6-sol': 'openai.gpt-6.1-sol',
  'us.openai.gpt-6-luna': 'openai.gpt-6-luna',
  'us.anthropic.claude-opus-5-5': 'anthropic.claude-opus-5-5',
}

const SELECTABLE_MODEL_IDS = new Set(AVAILABLE_MODELS.map(model => model.id))

export function normalizeModelId(modelId: string): string {
  const normalized = MODEL_ID_ALIASES[modelId] ?? modelId
  return SELECTABLE_MODEL_IDS.has(normalized) ? normalized : DEFAULT_MODEL_ID
}
