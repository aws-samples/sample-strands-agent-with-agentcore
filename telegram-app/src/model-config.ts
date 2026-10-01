export const MODELS = [
  {
    "id": "global.anthropic.claude-sonnet-5-5",
    "label": "Claude Sonnet 5.5"
  },
  {
    "id": "anthropic.claude-opus-5-5",
    "label": "Claude Opus 5.5"
  },
  {
    "id": "openai.gpt-6.1-sol",
    "label": "GPT-6.1 Sol"
  },
  {
    "id": "openai.gpt-6-luna",
    "label": "GPT-6 Luna"
  },
  {
    "id": "us.openai.gpt-6-astra",
    "label": "GPT-6 Astra"
  }
] as const;

export const DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-5-5";

export function resolveModelId(modelId: string): string {
  return MODELS.some((model) => model.id === modelId) ? modelId : DEFAULT_MODEL_ID;
}
