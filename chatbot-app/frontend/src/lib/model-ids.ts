export const DEFAULT_MODEL_ID = 'openai.gpt-6-sol'

const MODEL_ID_ALIASES: Record<string, string> = {
  'anthropic.claude-opus-5': 'anthropic.claude-opus-5-5',
  'us.anthropic.claude-opus-5': 'anthropic.claude-opus-5-5',
  'openai.gpt-5.6-sol': 'openai.gpt-6-sol',
  'us.openai.gpt-5.6-sol': 'openai.gpt-6-sol',
  'openai.gpt-5.6-terra': 'openai.gpt-6-sol',
  'us.openai.gpt-5.6-terra': 'openai.gpt-6-sol',
  'openai.gpt-5.6-luna': 'openai.gpt-6-luna',
  'us.openai.gpt-5.6-luna': 'openai.gpt-6-luna',
  'openai.gpt-6-astra': 'us.openai.gpt-6-astra',
  'xai.grok-4.3': 'us.xai.grok-4.6',
  'xai.grok-4.6': 'us.xai.grok-4.6',
  'us.openai.gpt-6-sol': 'openai.gpt-6-sol',
  'us.openai.gpt-6-luna': 'openai.gpt-6-luna',
  'us.anthropic.claude-opus-5-5': 'anthropic.claude-opus-5-5',
}

export function normalizeModelId(modelId: string): string {
  return MODEL_ID_ALIASES[modelId] ?? modelId
}
