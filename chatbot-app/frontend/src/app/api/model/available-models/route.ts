import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const AVAILABLE_MODELS = [
  {
    "id": "global.anthropic.claude-sonnet-5-5",
    "name": "Claude Sonnet 5.5",
    "provider": "Anthropic",
    "noTemperature": true
  },
  {
    "id": "anthropic.claude-opus-5-5",
    "name": "Claude Opus 5.5",
    "provider": "Anthropic",
    "noTemperature": true
  },
  {
    "id": "openai.gpt-6.1-sol",
    "name": "GPT-6.1 Sol",
    "provider": "OpenAI",
    "noTemperature": true
  },
  {
    "id": "openai.gpt-6-luna",
    "name": "GPT-6 Luna",
    "provider": "OpenAI",
    "noTemperature": true
  },
  {
    "id": "us.openai.gpt-6-astra",
    "name": "GPT-6 Astra",
    "provider": "OpenAI",
    "noTemperature": true
  },
  {
    "id": "us.xai.grok-4.7",
    "name": "Grok 4.7",
    "provider": "xAI",
    "noTemperature": true
  },
  {
    "id": "deepseek.v3.2",
    "name": "DeepSeek V3.2",
    "provider": "DeepSeek"
  },
  {
    "id": "google.gemma-4-31b",
    "name": "Gemma 4 31B",
    "provider": "Google"
  },
  {
    "id": "google.gemma-4-26b-a4b",
    "name": "Gemma 4 26B",
    "provider": "Google"
  },
  {
    "id": "zai.glm-5",
    "name": "GLM-5",
    "provider": "Z.AI"
  },
  {
    "id": "us.moonshotai.kimi-k3",
    "name": "Kimi K3",
    "provider": "Moonshot AI",
    "noTemperature": true
  },
  {
    "id": "minimax.minimax-m2.5",
    "name": "MiniMax M2.5",
    "provider": "MiniMax AI"
  },
  {
    "id": "qwen.qwen3-235b-a22b-2507-v1:0",
    "name": "Qwen 235B",
    "provider": "Qwen"
  },
  {
    "id": "mistral.mistral-large-3-675b-instruct",
    "name": "Mistral Large 3",
    "provider": "Mistral AI"
  },
  {
    "id": "nvidia.nemotron-super-3-120b",
    "name": "Nemotron Super 3 120B",
    "provider": "NVIDIA"
  }
]

export async function GET() {
  return NextResponse.json({ models: AVAILABLE_MODELS })
}
