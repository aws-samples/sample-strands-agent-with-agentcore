export const DEFAULT_MODEL_ID = 'global.anthropic.claude-sonnet-5-5'

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

const SELECTABLE_MODEL_IDS = new Set(["global.anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5", "openai.gpt-6.1-sol", "openai.gpt-6-luna", "us.openai.gpt-6-astra", "us.xai.grok-4.7", "deepseek.v3.2", "google.gemma-4-31b", "google.gemma-4-26b-a4b", "zai.glm-5", "us.moonshotai.kimi-k3", "minimax.minimax-m2.5", "qwen.qwen3-235b-a22b-2507-v1:0", "mistral.mistral-large-3-675b-instruct", "nvidia.nemotron-super-3-120b"])

export function normalizeModelId(modelId: string): string {
  const normalized = MODEL_ID_ALIASES[modelId] ?? modelId
  return SELECTABLE_MODEL_IDS.has(normalized) ? normalized : DEFAULT_MODEL_ID
}
